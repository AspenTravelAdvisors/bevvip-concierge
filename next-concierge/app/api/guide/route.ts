// app/api/guide/route.ts — Base Camp "The Guide" (Claude tool-use, streaming)
//
// Next.js port of api/guide.js. The Guide runs a Claude tool-use loop: the
// model calls search_offerings, we execute it against the live Atlas data
// layer, feed the real results back, and stream the grounded reply plus map
// metadata to the client as SSE frames ({status|delta|meta|done|error}).
//
// The hand-rolled Anthropic SSE parser from the original is replaced by the
// official SDK's messages.stream() + finalMessage().
//
// Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL (optional). Atlas inventory is
//      served in-process from lib/atlas (no external atlas API base needed).

import Anthropic from "@anthropic-ai/sdk";
import { GUIDE_PROMPT } from "@/lib/guide-prompt.js";
import {
  SEARCH_OFFERINGS_TOOL,
  luxuryCruiseAdvisorIntent,
  prioritizeMentionedPlace,
  searchOfferings,
} from "@/lib/search-offerings.js";
import { SEARCH_EXPERIENCES_TOOL, searchExperiences } from "@/lib/experiences.js";
import type {
  ChatMessage,
  ExperiencesMeta,
  GuideFrame,
  GuideMeta,
  GuideToolMeta,
} from "@/lib/types";
import { corsHeaders } from "@/lib/guide-cors";
import { leadTool } from "@/lib/guide-meta";
import { isRateLimited } from "@/lib/rate-limit";
import {
  addRound,
  logGuideTurn,
  newUsage,
  requestShape,
  type GuideUsage,
} from "@/lib/guide-telemetry";
import { checkDailyBudget, recordGuideSpend } from "@/lib/guide-budget";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
// A full answer now carries a scene-setting open, a fit read, three to five
// products with real dates, a cross-channel aside, hand-off framing and the
// trailing [[BRIEF]] tag — and a cross-atlas reply carries that per pillar. At
// 1500 the tail was the part that got cut, and the tail is where the brief
// lives: stripControlTags hides an unterminated "[[", so a truncated reply lost
// the advisor brief silently. Headroom is cheaper than a lost lead.
const MAX_TOKENS = 2400;
// A cross-atlas "ways to visit X" answer is instructed to call search_offerings
// once per pillar (hotel, cruise, jet, worldcruise, train). Batched into one
// assistant turn that is a single round, but the model routinely serialises
// them, and at 4 the loop ran out of budget mid-sweep and returned no final
// text at all. 6 covers the five-category sweep plus a refining call.
const MAX_TOOL_ROUNDS = 6;
// Claude occasionally returns a transient overloaded_error (HTTP 529) or a
// 429 / 5xx, especially at peak. Those are not real failures — Anthropic asks
// callers to back off and retry — so we do, rather than dumping the raw error
// JSON into the chat (which is what travelers were seeing).
const MAX_MODEL_ATTEMPTS = Number(process.env.GUIDE_MODEL_ATTEMPTS) || 4;
// Requests per minute across ALL callers. The per-IP limit cannot see a flood
// spread over a proxy pool — on 19 September 1,359 requests arrived in two
// hours from twenty-odd countries without one IP reaching 10/min — so the route
// carries its own ceiling. Blunt by design: see lib/rate-limit.ts.
const RATE_GLOBAL_MAX = Number(process.env.GUIDE_RATE_GLOBAL_MAX) || 30;
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

type Send = (frame: GuideFrame) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// True for the transient upstream conditions worth retrying: an overloaded or
// rate-limited model, or a gateway/5xx blip. Recognizes both the SDK's typed
// APIError (status / error.type) and a raw mid-stream error event surfaced as a
// message string (e.g. {"type":"error","error":{"type":"overloaded_error"...}}).
function isRetryableModelError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; error?: { type?: string }; message?: string };
  if (typeof e.status === "number" && RETRYABLE_STATUS.has(e.status)) return true;
  if (/overloaded_error|rate_limit_error|api_error|overloaded/i.test(e.error?.type || "")) return true;
  return /overloaded|rate[\s_-]?limit|\b(429|500|502|503|504|529)\b/i.test(String(e.message || ""));
}

// Never surface raw provider JSON to the traveler. Transient capacity issues get
// a calm "try again" line; anything else passes through its plain message.
function friendlyModelError(err: unknown): string {
  if (isRetryableModelError(err)) {
    return "The Guide is in unusually high demand right now and could not complete that reply. Please try again in a moment.";
  }
  return err instanceof Error ? err.message : String(err);
}

// CORS preflight. Allowed origins get a 204 carrying the headers; disallowed
// cross-origin preflights get 403 with none, so the browser refuses the real
// request. (Legitimate callers are same-origin; see lib/guide-cors.ts.)
export async function OPTIONS(req: Request) {
  const cors = corsHeaders(req);
  const allowed = Object.keys(cors).length > 0;
  return new Response(null, { status: allowed ? 204 : 403, headers: cors });
}

export async function POST(req: Request) {
  const cors = corsHeaders(req);
  // Read off the request before the stream starts: once we hand the response
  // back, the turn runs inside the ReadableStream and `req` is out of scope of
  // anything that should still be touching it.
  const shape = requestShape(req);
  const startedAt = Date.now();
  const usage = newUsage();

  const limited = await isRateLimited(req, cors, { globalMax: RATE_GLOBAL_MAX });
  if (limited) return limited;

  let messages: ChatMessage[];
  try {
    ({ messages } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: cors });
  }
  if (!messages || !Array.isArray(messages)) {
    return Response.json({ error: "Invalid messages format" }, { status: 400, headers: cors });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Claude API key not configured. Set ANTHROPIC_API_KEY." },
      { status: 500, headers: cors },
    );
  }

  // The day's money is already spent. Refuse before opening a stream: there is
  // nothing to say that is worth another model round, and 503 + Retry-After is
  // what tells a well-behaved caller to stop rather than retry in a loop.
  const budget = await checkDailyBudget();
  if (budget.over) {
    console.warn(
      JSON.stringify({
        evt: "guide_budget_exhausted",
        spentUsd: Number(budget.spentUsd.toFixed(4)),
        budgetUsd: budget.budgetUsd,
        store: budget.store,
        ref: shape.ref,
      }),
    );
    return Response.json(
      {
        error:
          "The Guide has reached its daily limit. It will be available again shortly — " +
          "an advisor can help you in the meantime.",
      },
      {
        status: 503,
        headers: { ...cors, "Retry-After": String(secondsUntilUtcMidnight()) },
      },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Send = (frame) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      let stopReason = "error";
      let ok = false;
      try {
        const turn = await runGuideTurnStream({ messages, send, usage });
        stopReason = turn.stopReason;
        ok = true;
        send({
          type: "meta",
          ...summarizeMeta(turn.toolMeta, turn.experiences),
          stopReason,
        });
        send({ type: "done" });
      } catch (err) {
        console.error("Guide error:", err);
        send({ type: "error", error: friendlyModelError(err) });
      } finally {
        // Charge the day's ledger before anything else: a turn that threw still
        // spent tokens on the rounds it completed, and those are exactly the
        // ones that must not go uncounted. Bounded by the store timeout, and
        // never allowed to fail the response.
        let usd = 0;
        try {
          usd = await recordGuideSpend(usage, MODEL);
        } catch (e) {
          console.error("Guide spend not recorded:", e);
        }
        // One line per turn, whatever happened. A turn that fails expensively
        // is exactly the one worth seeing in the logs.
        logGuideTurn({ shape, usage, startedAt, stopReason, ok, usd, store: budget.store });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...cors,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function runGuideTurnStream({
  messages,
  send,
  usage,
}: {
  messages: ChatMessage[];
  send: Send;
  // Mutated in place rather than returned, so a turn that throws mid-sweep
  // still reports the rounds it already paid for.
  usage: GuideUsage;
}): Promise<{
  text: string;
  toolMeta: GuideToolMeta[];
  experiences: ExperiencesMeta | null;
  stopReason: string;
}> {
  const client = new Anthropic();
  const convo: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const toolMeta: GuideToolMeta[] = [];
  // The experiences summary rides beside the tool list rather than in it —
  // prose-only records must not reach the card / map / hand-off pipeline. It is
  // what tells the funnel the call happened and the chat not to re-offer a
  // question it just answered.
  let experiences: ExperiencesMeta | null = null;
  const latestUserText = latestUserContent(messages);
  let text = "";

  // Today's date lets the model resolve relative timing ("spring break week",
  // "the week after Christmas") into real checkIn/checkOut dates. Resolve it
  // once for the whole turn: recomputing per round would change the system text
  // mid-conversation if a turn straddles midnight UTC, and a changed prefix is a
  // missed cache on every remaining round.
  const today = new Date().toISOString().slice(0, 10);
  // The two tool schemas (~22k tokens) and GUIDE_PROMPT (~14k) are byte-identical
  // on every request and every round, and both sit ahead of `messages` in the
  // cache prefix (tools, then system, then messages) — so one breakpoint on the
  // last system block covers the whole ~36k. Without it we re-billed that prefix
  // at full input rate on each of up to MAX_TOOL_ROUNDS requests per question,
  // which was ~88% of this endpoint's token spend.
  //
  // The default five-minute TTL covers the tool-use rounds inside a turn and
  // back-to-back travelers. The prefix only actually changes when `today` rolls
  // over, so `ttl: "1h"` is the next lever if traffic stays bursty — it bills the
  // write at 2x base instead of 1.25x, which one extra hit repays.
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: `${GUIDE_PROMPT}\n\nToday's date is ${today}.`,
      cache_control: { type: "ephemeral" },
    },
  ];

  send({ type: "status", text: "Reading your trip style..." });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await streamRoundWithRetry(
      client,
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: convo,
        tools: [
          SEARCH_OFFERINGS_TOOL as Anthropic.Tool,
          SEARCH_EXPERIENCES_TOOL as Anthropic.Tool,
        ],
      },
      (delta) => {
        text += delta;
        send({ type: "delta", text: delta });
      },
      () => send({ type: "status", text: "The Guide is in high demand — retrying..." }),
    );
    addRound(usage, data.usage);

    if (data.stop_reason === "tool_use") {
      const toolUses = data.content.filter(
        (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
      );
      convo.push({ role: "assistant", content: data.content });

      if (toolUses.length) {
        send({ type: "status", text: statusForToolUses(toolUses) });
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        let result: unknown;
        try {
          const input =
            tu.name === "search_offerings"
              ? prioritizeMentionedPlace(tu.input || {}, latestUserText)
              : tu.input || {};
          if (tu.name === "search_offerings") {
            result = await searchOfferings(input);
          } else if (tu.name === "search_experiences") {
            result = await searchExperiences(input);
          } else {
            result = { error: `unknown tool ${tu.name}` };
          }
          tu.input = input;
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        // The result-card / map pipeline (toolMeta -> summarizeMeta -> ResultCards
        // / AtlasShell + advisor CTA) is fed by hotel/cruise inventory only.
        // Experiences themselves stay prose-only, but a search_experiences call
        // also returns a few area hotels (result.hotels) that DO anchor the map,
        // render as cards, and unlock the advisor hand-off — so push those.
        if (tu.name === "search_offerings") {
          toolMeta.push({
            ...(result as object),
            input: tu.input as Record<string, unknown>,
            results: (result as GuideToolMeta)?.results || [],
          } as GuideToolMeta);
        } else if (tu.name === "search_experiences") {
          const r = (result || {}) as {
            hotels?: GuideToolMeta;
            total?: number;
            preferredCount?: number;
            unavailable?: boolean;
            error?: unknown;
          };
          const hotels = r.hotels;
          if (hotels && (hotels.results?.length ?? 0) > 0) {
            toolMeta.push({
              ...hotels,
              input: tu.input as Record<string, unknown>,
              results: hotels.results || [],
            } as GuideToolMeta);
          }
          // Summarize the experiences half for the client. Last call wins: a
          // turn that searched twice was refining, and the refinement is the
          // one the reply is built on.
          experiences = {
            total: Number(r.total) || 0,
            preferredCount: Number(r.preferredCount) || 0,
            // A thrown call lands here as { error } — that is the catalogue
            // being unreachable, not the catalogue being empty, and the two
            // must not read the same in the numbers.
            unavailable: !!r.unavailable || !!r.error,
            place: String((tu.input as Record<string, unknown>)?.place || "") || null,
          };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }

      send({ type: "status", text: "Narrowing the strongest fit..." });
      convo.push({ role: "user", content: toolResults });
      continue;
    }

    return {
      text: text.trim(),
      toolMeta,
      experiences,
      stopReason: data.stop_reason || "end_turn",
    };
  }

  return { text: text.trim(), toolMeta, experiences, stopReason: "max_tool_rounds" };
}

// One model round, with backoff on transient overload. We only retry when the
// failure landed before any text was streamed for this attempt — once deltas
// have reached the client, restarting would duplicate the reply, so we surface
// the error instead. Overloaded errors arrive at request time (no text yet), so
// in practice they retry cleanly.
async function streamRoundWithRetry(
  client: Anthropic,
  params: Anthropic.MessageStreamParams,
  onText: (delta: string) => void,
  onRetry: () => void,
): Promise<Anthropic.Message> {
  for (let attempt = 1; ; attempt++) {
    let emitted = false;
    try {
      const stream = client.messages.stream(params);
      stream.on("text", (delta) => {
        emitted = true;
        onText(delta);
      });
      return await stream.finalMessage();
    } catch (err) {
      if (attempt >= MAX_MODEL_ATTEMPTS || emitted || !isRetryableModelError(err)) throw err;
      onRetry();
      // Exponential backoff with jitter: ~0.6s, 1.2s, 2.4s (capped at 8s).
      const backoff = Math.min(8000, 600 * 2 ** (attempt - 1)) + Math.random() * 300;
      await sleep(backoff);
    }
  }
}

// Retry-After for a tripped daily ceiling. The budget key is a UTC day, so the
// honest answer is "when that day rolls over", not a flat guess.
function secondsUntilUtcMidnight(now: number = Date.now()): number {
  const next = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - now) / 1000));
}

function statusForToolUses(toolUses: Anthropic.ToolUseBlock[]): string {
  // Experiences lookups can run alongside or instead of an inventory search.
  const exp = toolUses.find((tu) => tu.name === "search_experiences");
  if (exp && !toolUses.some((tu) => tu.name === "search_offerings")) {
    const where = String((exp.input as Record<string, unknown>)?.place || "").trim();
    return where ? `Looking at things to do in ${where}...` : "Looking at things to do nearby...";
  }

  const input =
    (toolUses.find((tu) => tu.name === "search_offerings")?.input as
      | Record<string, unknown>
      | undefined) || {};
  const type = String(input.type || "any").toLowerCase();
  if (
    (type === "cruise" || type === "yacht" || type === "any") &&
    luxuryCruiseAdvisorIntent(input, type)
  ) {
    return "Routing the Luxury Cruise request to an advisor...";
  }
  if (type === "cruise") return "Checking approved Expedition Cruise and yacht inventory...";
  if (type === "jet") return "Checking private jet journey inventory...";
  if (type === "yacht") return "Checking luxury hotel yacht sailings...";
  if (type === "villa") return "Checking private villa inventory...";
  return "Checking approved hotel inventory...";
}

function latestUserContent(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

// Bubble up the most relevant Atlas handoff for the client (map plot + button).
function summarizeMeta(
  toolMeta: GuideToolMeta[],
  experiences: ExperiencesMeta | null = null,
): GuideMeta {
  const tools: GuideToolMeta[] = toolMeta.map((t) => ({
    input: t.input,
    type: t.type,
    total: t.total,
    count: t.count,
    deepLink: t.deepLink ?? null,
    chartRegion: t.chartRegion ?? null,
    unavailable: !!t.unavailable,
    // Carried so the hand-off can tell "no live inventory by design" (an
    // advisor-sourced Luxury Cruise) apart from "expedition sailings", which
    // share the type "cruise" and otherwise look identical downstream.
    advisorOnly: !!t.advisorOnly,
    sources: t.sources ?? null,
    results: t.results || [],
    related: t.related ?? null,
    ...(t.trip ? { trip: t.trip } : {}),
  }));
  const lead = leadTool(tools);
  return {
    deepLink: lead ? (lead.deepLink ?? null) : null,
    chartRegion: lead ? (lead.chartRegion ?? null) : null,
    tools,
    experiences,
  };
}

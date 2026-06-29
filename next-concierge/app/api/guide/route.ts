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
import type { ChatMessage, GuideFrame, GuideMeta, GuideToolMeta } from "@/lib/types";
import { corsHeaders } from "@/lib/guide-cors";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = 1500;
const MAX_TOOL_ROUNDS = 4;
// Claude occasionally returns a transient overloaded_error (HTTP 529) or a
// 429 / 5xx, especially at peak. Those are not real failures — Anthropic asks
// callers to back off and retry — so we do, rather than dumping the raw error
// JSON into the chat (which is what travelers were seeing).
const MAX_MODEL_ATTEMPTS = Number(process.env.GUIDE_MODEL_ATTEMPTS) || 4;
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

  const limited = isRateLimited(req, cors);
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Send = (frame) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      try {
        const { toolMeta, stopReason } = await runGuideTurnStream({ messages, send });
        send({ type: "meta", ...summarizeMeta(toolMeta), stopReason });
        send({ type: "done" });
      } catch (err) {
        console.error("Guide error:", err);
        send({ type: "error", error: friendlyModelError(err) });
      } finally {
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
}: {
  messages: ChatMessage[];
  send: Send;
}): Promise<{ text: string; toolMeta: GuideToolMeta[]; stopReason: string }> {
  const client = new Anthropic();
  const convo: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const toolMeta: GuideToolMeta[] = [];
  const latestUserText = latestUserContent(messages);
  let text = "";

  send({ type: "status", text: "Reading your trip style..." });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await streamRoundWithRetry(
      client,
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: GUIDE_PROMPT,
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
          const hotels = (result as { hotels?: GuideToolMeta })?.hotels;
          if (hotels && (hotels.results?.length ?? 0) > 0) {
            toolMeta.push({
              ...hotels,
              input: tu.input as Record<string, unknown>,
              results: hotels.results || [],
            } as GuideToolMeta);
          }
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

    return { text: text.trim(), toolMeta, stopReason: data.stop_reason || "end_turn" };
  }

  return { text: text.trim(), toolMeta, stopReason: "max_tool_rounds" };
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
function summarizeMeta(toolMeta: GuideToolMeta[]): GuideMeta {
  const tools: GuideToolMeta[] = toolMeta.map((t) => ({
    input: t.input,
    type: t.type,
    total: t.total,
    count: t.count,
    deepLink: t.deepLink ?? null,
    chartRegion: t.chartRegion ?? null,
    unavailable: !!t.unavailable,
    sources: t.sources ?? null,
    results: t.results || [],
    related: t.related ?? null,
  }));
  // Prefer the last tool call that actually returned inventory.
  const lead =
    [...tools].reverse().find((t) => (t.count ?? 0) > 0) || tools[tools.length - 1] || null;
  return {
    deepLink: lead ? (lead.deepLink ?? null) : null,
    chartRegion: lead ? (lead.chartRegion ?? null) : null,
    tools,
  };
}

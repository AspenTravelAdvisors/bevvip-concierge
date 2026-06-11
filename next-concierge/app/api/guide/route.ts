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
// Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL (optional),
//      HOTEL_ATLAS_API_BASE etc. (optional; see lib/search-offerings.js).

import Anthropic from "@anthropic-ai/sdk";
import { GUIDE_PROMPT } from "@/lib/guide-prompt.js";
import {
  SEARCH_OFFERINGS_TOOL,
  luxuryCruiseAdvisorIntent,
  prioritizeMentionedPlace,
  searchOfferings,
} from "@/lib/search-offerings.js";
import type { ChatMessage, GuideFrame, GuideMeta, GuideToolMeta } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = 1500;
const MAX_TOOL_ROUNDS = 4;

type Send = (frame: GuideFrame) => void;

export async function POST(req: Request) {
  let messages: ChatMessage[];
  try {
    ({ messages } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!messages || !Array.isArray(messages)) {
    return Response.json({ error: "Invalid messages format" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Claude API key not configured. Set ANTHROPIC_API_KEY." },
      { status: 500 },
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
        send({ type: "error", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
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
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: GUIDE_PROMPT,
      messages: convo,
      tools: [SEARCH_OFFERINGS_TOOL as Anthropic.Tool],
    });
    stream.on("text", (delta) => {
      text += delta;
      send({ type: "delta", text: delta });
    });
    const data = await stream.finalMessage();

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
          result =
            tu.name === "search_offerings"
              ? await searchOfferings(input)
              : { error: `unknown tool ${tu.name}` };
          tu.input = input;
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        toolMeta.push({
          ...(result as object),
          input: tu.input as Record<string, unknown>,
          results: (result as GuideToolMeta)?.results || [],
        } as GuideToolMeta);
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

function statusForToolUses(toolUses: Anthropic.ToolUseBlock[]): string {
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
  if (type === "yacht") return "Checking hotel-brand yacht sailings...";
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

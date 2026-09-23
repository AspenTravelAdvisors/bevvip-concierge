// next-concierge/lib/guide-tokens.ts — what the Guide sends to the model, kept
// to what the model needs.
//
// The daily ceiling (lib/guide-budget.ts) and BotID (lib/guide-botid.ts) decide
// WHETHER a turn runs. This file decides how much each turn that does run costs,
// and it is aimed at three places the input bill grew without anyone asking:
//
//  1. The request body. /api/guide took whatever `messages` array it was sent —
//     any length, any size — and re-billed all of it on every one of up to six
//     tool rounds. Our own client never sends more than a short chat, so a cap
//     costs a traveler nothing and costs a scripted caller its leverage.
//
//  2. Tool results. search_offerings returns card-ready records: photo URLs,
//     coordinates, eighteen scoring sub-fields, booking links and a booking
//     password per hotel. The cards need those; the model writes prose from
//     names, places, dates, fit and benefits. Measured on live inventory the
//     card-only fields were a third to a half of every result, and a result is
//     re-sent on every later round of the same turn.
//
//  3. Rounds 2..n. The system prompt is cached, but the conversation and the
//     tool results after it were billed at full input rate on every round. A
//     second breakpoint on the newest message makes each round a cache read of
//     everything the previous round already sent.

import type Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./types";

// ── 1. Request bounds ───────────────────────────────────────────────────────

/** Longest single message a traveler may send. The composer enforces the same. */
export const MAX_USER_CHARS = 4000;
/** Messages of history kept — six exchanges plus the new question. */
export const MAX_HISTORY_MESSAGES = 13;
/** Characters of history kept in total, newest first. ~12k tokens. */
export const MAX_HISTORY_CHARS = 48_000;

export type BoundedHistory =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Validate the client's transcript and trim it to what a turn may bill.
 *
 * Rejects anything our client would never send (non-string content, unknown
 * roles, a transcript not ending on the traveler) and an over-long question.
 * Older history is dropped from the front rather than refused: a long, real
 * conversation should keep working, it just stops dragging its whole past into
 * every round.
 */
export function boundHistory(raw: unknown): BoundedHistory {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, status: 400, error: "Invalid messages format" };
  }
  const valid = raw.every(
    (m) =>
      m &&
      typeof m === "object" &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string",
  );
  if (!valid) return { ok: false, status: 400, error: "Invalid messages format" };

  // An empty assistant turn is what the client keeps after a reply that failed
  // before any text arrived. It carries nothing, and the API rejects it.
  const messages = (raw as ChatMessage[])
    .map(({ role, content }) => ({ role, content }))
    .filter((m) => m.content.trim() !== "");

  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== "user") {
    return { ok: false, status: 400, error: "Invalid messages format" };
  }
  if (latest.content.length > MAX_USER_CHARS) {
    return {
      ok: false,
      status: 413,
      error: `That message is too long for the Guide — please keep it under ${MAX_USER_CHARS.toLocaleString("en-US")} characters.`,
    };
  }

  // Walk back from the newest message, keeping whole messages while both
  // budgets allow. The latest question is always kept.
  let start = messages.length - 1;
  let chars = latest.content.length;
  while (start > 0 && messages.length - start < MAX_HISTORY_MESSAGES) {
    const next = chars + messages[start - 1].content.length;
    if (next > MAX_HISTORY_CHARS) break;
    chars = next;
    start--;
  }
  // The API requires the first message to be the traveler's.
  while (start < messages.length - 1 && messages[start].role !== "user") start++;

  return { ok: true, messages: messages.slice(start) };
}

// ── 2. Tool results, as the model sees them ─────────────────────────────────

// Card, map and booking fields. Removed at any depth, so `related` records and
// the hotels a search_experiences call returns are slimmed the same way.
// bookPassword in particular has no business in a model's context: anything
// the model can read, it can repeat to a traveler.
const CARD_ONLY_KEYS = new Set([
  "lat",
  "lng",
  "thumb",
  "photos",
  "images",
  "bookUrl",
  "bookPassword",
  "tw",
  "matchScores",
  "criteriaScores",
  "searchKeywords",
]);

function strip(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) return value.map((v) => strip(v, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (CARD_ONLY_KEYS.has(k)) continue;
    // A record's own deepLink is a map URL the prompt forbids writing inline;
    // only the top-level one is presented, as the "Open in Atlas" link.
    if (k === "deepLink" && depth > 0) continue;
    out[k] = strip(v, depth + 1);
  }
  return out;
}

/**
 * The tool result as the model should receive it. The full result still feeds
 * the cards, map and hand-off through toolMeta; this is only the copy that is
 * serialized into the conversation.
 */
export function toolResultForModel(result: unknown): string {
  return JSON.stringify(strip(result, 0));
}

// ── 3. A rolling cache breakpoint ───────────────────────────────────────────

/**
 * A copy of `convo` whose final block carries a cache breakpoint.
 *
 * Only the copy is marked, never `convo` itself: breakpoints left behind on
 * earlier messages would pile up past the API's limit of four across a
 * six-round turn. One on the system prompt plus this one is two.
 *
 * Round N writes everything up to its newest message; round N+1 re-sends the
 * same bytes plus one more message and reads all of it back at a tenth of the
 * input rate. The traveler's next question in the same chat hits it too, up to
 * the last question they asked.
 */
export function withRollingCache(convo: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (convo.length === 0) return convo;
  const last = convo[convo.length - 1];
  const blocks: Anthropic.ContentBlockParam[] =
    typeof last.content === "string"
      ? [{ type: "text", text: last.content }]
      : [...last.content];
  if (blocks.length === 0) return convo;
  const tail = blocks[blocks.length - 1];
  // Thinking blocks cannot carry cache_control; every other block the Guide
  // puts last (text, tool_result) can.
  if (tail.type === "thinking" || tail.type === "redacted_thinking") return convo;
  blocks[blocks.length - 1] = { ...tail, cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam;
  return [...convo.slice(0, -1), { ...last, content: blocks }];
}

// next-concierge/lib/guide-telemetry.ts — one structured line per Guide turn.
//
// /api/guide is the only endpoint on this site that spends money with a third
// party, and until now it logged nothing but errors. When the September bill
// spiked there was no way to tell a traveler from a scripted client: Vercel's
// runtime logs carry only method/path/status/cache, and Web Analytics (referrer,
// country, device) was not enabled on the project. So the one place where the
// spend actually happens is the one place worth instrumenting.
//
// WHAT THIS DELIBERATELY DOES NOT RECORD: no IP, no raw user-agent, no referrer
// path or query string, and nothing the traveler typed. A referrer HOSTNAME, a
// country code and a coarse client class answer "where did this come from"
// without turning the log into a store of personal data. Keep it that way — the
// value here is attribution, and attribution does not need identity.

/** Coarse client class. "browser" means only "did not announce itself as a bot". */
export type ClientClass = "bot" | "browser" | "unknown";

export interface GuideRequestShape {
  ref: string;
  country: string;
  client: ClientClass;
}

// Self-declared automation. A scripted client is free to lie, so this
// classifies rather than enforces — `lib/rate-limit.ts` is what actually
// constrains abuse. It is still the cheapest signal for "was that spike real".
const BOT_UA_RE =
  /bot|crawl|spider|slurp|curl|wget|python-requests|httpx|axios|node-fetch|go-http|headless|scrapy|postman/i;

/** Read the attribution-relevant shape of a request. Never throws. */
export function requestShape(req: Request): GuideRequestShape {
  const ua = req.headers.get("user-agent") || "";
  const referer = req.headers.get("referer") || "";

  // Hostname only. A full referrer URL routinely carries campaign parameters
  // and occasionally carries the previous page's query, which is exactly the
  // kind of thing that should not accumulate in a log.
  let ref = "none";
  if (referer) {
    try {
      ref = new URL(referer).hostname || "none";
    } catch {
      ref = "unparseable";
    }
  }

  return {
    ref,
    // Vercel sets this at the edge; absent in local dev.
    country: req.headers.get("x-vercel-ip-country") || "unknown",
    client: ua ? (BOT_UA_RE.test(ua) ? "bot" : "browser") : "unknown",
  };
}

/** Token counters accumulated across every model round in one turn. */
export interface GuideUsage {
  rounds: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const newUsage = (): GuideUsage => ({
  rounds: 0,
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
});

/** The subset of Anthropic's Usage this cares about. */
interface RoundUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Fold one round's usage in. Counts the round even when usage is missing. */
export function addRound(acc: GuideUsage, usage: RoundUsage | null | undefined): void {
  acc.rounds += 1;
  if (!usage) return;
  acc.input += usage.input_tokens || 0;
  acc.output += usage.output_tokens || 0;
  acc.cacheWrite += usage.cache_creation_input_tokens || 0;
  acc.cacheRead += usage.cache_read_input_tokens || 0;
}

/**
 * Emit the turn's line. One JSON object on one line so it is greppable in
 * Vercel's runtime logs — search `guide_turn` to get every turn, and the fields
 * answer both questions that mattered in September: who is calling this, and is
 * the prompt cache actually landing.
 */
export function logGuideTurn(args: {
  shape: GuideRequestShape;
  usage: GuideUsage;
  startedAt: number;
  stopReason: string;
  ok: boolean;
  /** What this turn cost, in dollars, as charged to the daily ceiling. */
  usd?: number;
  /** Which counter backs the spend ceiling — see BudgetState.store. */
  store?: string;
}): void {
  const { shape, usage, startedAt, stopReason, ok, usd, store } = args;
  console.log(
    JSON.stringify({
      evt: "guide_turn",
      ok,
      ms: Date.now() - startedAt,
      rounds: usage.rounds,
      stop: stopReason,
      ref: shape.ref,
      country: shape.country,
      client: shape.client,
      input: usage.input,
      output: usage.output,
      cacheWrite: usage.cacheWrite,
      cacheRead: usage.cacheRead,
      // `cached: false` on every line means the cache_control breakpoint is not
      // landing — the ~36k prefix is being re-billed at full input rate.
      cached: usage.cacheRead > 0,
      // Four decimals: a turn costs cents, and summing the column over a day is
      // the fastest answer to "what is this endpoint actually costing us".
      ...(usd === undefined ? {} : { usd: Number(usd.toFixed(4)) }),
      // On EVERY turn, not just on the one that trips the ceiling. Anything but
      // "shared" means the ceiling is per-instance and the real cap is some
      // multiple of the configured one — that is worth knowing on a quiet day,
      // not discovering from the line that fires once the money is gone.
      ...(store === undefined ? {} : { store }),
    }),
  );
}

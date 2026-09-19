// next-concierge/lib/guide-budget.ts — a hard daily ceiling on what the Guide
// may spend with Anthropic.
//
// WHY THIS EXISTS. On 19 September /api/guide went from its normal ~25 requests
// a day to 1,767, with 1,359 of them inside two hours, and drained the account's
// credit balance; every request after that returned "Your credit balance is too
// low to access the Anthropic API". Nothing in the stack had an opinion about
// total spend — the rate limiter counted requests per IP, and the traffic came
// from a proxy pool spread across twenty-odd countries where no single IP was
// anywhere near the limit.
//
// A request limiter answers "is this caller going too fast". It cannot answer
// "have we spent too much today", because the cost of a turn is not knowable
// until the turn is over: a one-round answer and a six-round cross-atlas sweep
// differ by an order of magnitude. So this counts DOLLARS, after the fact, and
// refuses new turns once the day's total is past the ceiling.
//
// The ceiling is a circuit breaker, not a budget manager. When it trips the
// Guide stops answering anyone, and it stays stopped until UTC midnight or
// until someone raises GUIDE_DAILY_BUDGET_USD. That is a deliberately harsh
// failure mode: an endpoint that has already spent the day's money is not one
// to leave running while the balance drains.
//
// ACCURACY. Spend is recorded from the usage Anthropic actually reports, so it
// is exact for the tokens it sees. What it cannot see is a turn killed
// mid-flight by the 60s function timeout — those tokens are billed and never
// counted. The ceiling therefore runs slightly UNDER real spend, which is the
// right direction for a safety limit but means it should not be read as a bill.

import { isStoreConfigured, kvPipeline } from "./kv";
import type { GuideUsage } from "./guide-telemetry";

/** Dollars per million tokens, at base (uncached) rates. */
interface ModelRate {
  input: number;
  output: number;
}

// Only the models this route is plausibly pointed at via CLAUDE_MODEL. Cache
// rates are derived rather than listed: a read is 0.1x base input and a
// five-minute write is 1.25x, and deriving them means a price change touches
// one number per model instead of four.
const RATES: Record<string, ModelRate> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
};

// An unrecognized model bills at the priciest rate we know. Guessing low on an
// unknown model would quietly raise the real ceiling, which defeats the point.
const FALLBACK_RATE: ModelRate = Object.values(RATES).reduce((a, b) =>
  b.input + b.output > a.input + a.output ? b : a,
);

function rateFor(model: string): ModelRate {
  return RATES[model] ?? FALLBACK_RATE;
}

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** What one turn's token usage cost, in dollars. */
export function turnCostUsd(usage: GuideUsage, model: string): number {
  const rate = rateFor(model);
  const perToken = (millions: number) => millions / 1_000_000;
  return (
    usage.input * perToken(rate.input) +
    usage.output * perToken(rate.output) +
    usage.cacheRead * perToken(rate.input * CACHE_READ_MULTIPLIER) +
    usage.cacheWrite * perToken(rate.input * CACHE_WRITE_MULTIPLIER)
  );
}

// The measured baseline is ~25 turns/day at ~$0.023 each — about $0.60. The
// default ceiling is therefore roughly forty times a normal day: high enough
// that a genuine surge of travelers is never the thing that trips it, low
// enough that a scripted flood is capped within the hour.
const DAILY_BUDGET_USD = Number(process.env.GUIDE_DAILY_BUDGET_USD) || 25;

// Stored as integer micro-dollars: Redis INCRBY is integer-only, and a float
// accumulated across thousands of turns drifts.
const MICROS_PER_USD = 1_000_000;
const BUDGET_MICROS = Math.round(DAILY_BUDGET_USD * MICROS_PER_USD);

// Two days, so a key written just before midnight is not reclaimed while it is
// still the current day anywhere in the pipeline.
const KEY_TTL_MS = 48 * 60 * 60 * 1000;

/** UTC day. The ceiling resets at 00:00 UTC, not at Aspen midnight. */
const dayKey = (now: number): string =>
  `spend:guide:${new Date(now).toISOString().slice(0, 10)}`;

// Per-instance fallback for when the shared store is unreachable. Far weaker
// than the shared counter — each lambda instance gets its own allowance — but a
// ceiling enforced per instance still bounds the blast radius, and failing open
// on a Redis blip is how you end up back where this started.
let local = { key: "", micros: 0 };

function bumpLocal(key: string, micros: number): number {
  if (local.key !== key) local = { key, micros: 0 };
  local.micros += micros;
  return local.micros;
}

/** Which counter answered, and therefore whether the ceiling is real. */
export type BudgetStore = "shared" | "local" | "unconfigured";

export interface BudgetState {
  /** True when the day's spend is already past the ceiling. */
  over: boolean;
  spentUsd: number;
  budgetUsd: number;
  /**
   * "shared" is the only value under which the ceiling actually holds: the
   * others mean the real ceiling is this budget times the number of live
   * lambdas. The two are split because they want different fixes —
   * "unconfigured" means UPSTASH_REDIS_REST_URL/_TOKEN (or the KV_REST_API_*
   * pair) are not set on the project, "local" means they are set but the store
   * did not answer in time on this request.
   */
  store: BudgetStore;
}

/**
 * Read the day's spend and say whether the Guide may run another turn.
 * Never throws; an unreachable store falls back to this instance's own total.
 */
export async function checkDailyBudget(now: number = Date.now()): Promise<BudgetState> {
  const key = dayKey(now);
  const configured = isStoreConfigured();
  const rows = await kvPipeline([["GET", key]]);

  // `null` INSIDE the rows means "no spend recorded today", which is a 0, not a
  // failure — distinguish that from kvPipeline returning null for the batch.
  const answered = rows !== null;
  const micros = answered ? Number(rows[0] ?? 0) || 0 : bumpLocal(key, 0);

  return {
    over: micros >= BUDGET_MICROS,
    spentUsd: micros / MICROS_PER_USD,
    budgetUsd: DAILY_BUDGET_USD,
    store: answered ? "shared" : configured ? "local" : "unconfigured",
  };
}

/**
 * Fold one finished turn's cost into the day's total. Call this for every turn
 * that reached the model, including one that threw part-way: a turn that failed
 * expensively still spent the money.
 *
 * Returns the dollars recorded, so the caller can log it.
 */
export async function recordGuideSpend(
  usage: GuideUsage,
  model: string,
  now: number = Date.now(),
): Promise<number> {
  const usd = turnCostUsd(usage, model);
  const micros = Math.round(usd * MICROS_PER_USD);
  if (micros <= 0) return usd;

  const key = dayKey(now);
  const rows = await kvPipeline([
    ["INCRBY", key, micros],
    ["PEXPIRE", key, KEY_TTL_MS, "NX"],
  ]);
  if (!rows) bumpLocal(key, micros);
  return usd;
}

export const __test = { turnCostUsd, rateFor, dayKey, FALLBACK_RATE, BUDGET_MICROS };

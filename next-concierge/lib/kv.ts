// next-concierge/lib/kv.ts — the one way this app talks to its shared counter
// store (Upstash Redis REST, or Vercel KV, which exposes the same shape).
//
// Two things need a counter that every serverless instance can see: the rate
// limiter (lib/rate-limit.ts) and the Guide's daily spend ceiling
// (lib/guide-budget.ts). Both were going to grow their own copy of the same
// fetch-with-timeout-and-swallow-errors block, and a divergence between them is
// the kind of bug that only shows up when the store is down — which is exactly
// when both of them matter. So the transport lives here once.
//
// Spoken over the REST API with plain fetch: no dependency, no cold-start cost.
//
// EVERY failure returns null rather than throwing. A caller that cannot reach
// the store must decide for itself how to degrade — the rate limiter falls back
// to a per-instance count, the budget falls back to a per-instance total — and
// neither decision belongs down here.

const STORE_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").replace(/\/+$/, "");
const STORE_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

const DEFAULT_TIMEOUT_MS = Number(process.env.RATE_STORE_TIMEOUT_MS) || 700;

/** True when a shared counter is configured; otherwise callers run per-instance. */
export const isStoreConfigured = (): boolean => !!(STORE_URL && STORE_TOKEN);

/**
 * Run one Redis pipeline. Returns the `result` of each command in order, or
 * null if the store is unconfigured, unreachable, slow, or reported an error on
 * any command in the batch.
 *
 * All-or-nothing on purpose: a partial read is worse than no read, because a
 * caller cannot tell a missing count from a zero one.
 */
export async function kvPipeline(
  commands: Array<Array<string | number>>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown[] | null> {
  if (!isStoreConfigured() || commands.length === 0) return null;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${STORE_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${STORE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands.map((c) => c.map(String))),
      signal: ctl.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    if (!Array.isArray(rows) || rows.length !== commands.length) return null;
    if (rows.some((r) => r?.error)) return null;
    return rows.map((r) => r?.result);
  } catch {
    return null; // network error, timeout, bad JSON
  } finally {
    clearTimeout(timer);
  }
}

// next-concierge/lib/rate-limit.ts — best-effort rate limiting for the Guide.
// Ported from the legacy lib/guide-rate-limit.js, adapted to the App Router's
// Web Request/Response.
//
// TWO BACKENDS, chosen by environment (see lib/kv.ts for the transport):
//
//   Distributed (preferred) — set UPSTASH_REDIS_REST_URL and
//     UPSTASH_REDIS_REST_TOKEN and every instance shares one counter, which is
//     the only way a limit actually holds on serverless. Vercel KV exposes the
//     same REST shape under KV_REST_API_URL / KV_REST_API_TOKEN; both are read.
//
//   In-memory (fallback) — a per-instance Map. Vercel functions are stateless
//     across instances, so this throttles a burst from one client on one warm
//     instance but is NOT a global guarantee: a flood spread across cold starts
//     slips past it. It is a backstop that raises the cost of casual abuse.
//
// The fallback also catches the distributed path failing: if the store errors
// or times out we fall back to the local counter rather than failing open, so a
// Redis outage degrades the limit instead of removing it.
//
// TWO LIMITS, and they answer different attacks:
//
//   Per-IP (`max`) — stops one client hammering the endpoint.
//
//   Global (`globalMax`) — stops the attack the per-IP limit structurally
//     cannot see. On 19 September the Guide took 1,359 requests in two hours
//     from a residential-proxy pool spread across twenty-odd countries; no
//     single IP came close to 10/min, so the per-IP counter never fired once
//     while the endpoint burned the whole Anthropic balance. A ceiling on the
//     ROUTE, not the caller, is the only limiter shape that sees that traffic.
//     It is deliberately blunt — during an attack it will turn away real
//     travelers too. That is the correct trade for an endpoint that spends
//     money per call, and it is why the Guide also carries a spend ceiling
//     (lib/guide-budget.ts) rather than relying on this alone.

import { isStoreConfigured, kvPipeline } from "./kv";

const WINDOW_MS = Number(process.env.GUIDE_RATE_WINDOW_MS) || 60_000;
const MAX_REQUESTS = Number(process.env.GUIDE_RATE_MAX) || 10;

// Optional per-route budget override. The Guide's 10/min default is right for
// a model-backed endpoint, but far too tight for a browsing surface like the
// villa search API (map pins + pagination legitimately burst past 10/min).
// `bucket` keeps each route's counter separate so browsing the villa atlas
// never eats the traveler's Guide budget.
export interface RateLimitOptions {
  max?: number;
  windowMs?: number;
  bucket?: string;
  /**
   * Ceiling on requests to this bucket from ALL callers combined, per window.
   * Omit to leave the route per-IP only.
   */
  globalMax?: number;
  /** What a caller refused by the per-IP limit is told. */
  message?: string;
}

// bucket:ip -> { count, resetAt }
const hits = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** True when a shared counter is configured; otherwise we run per-instance. */
export const isDistributed = (): boolean => isStoreConfigured();

interface Count { count: number; resetAt: number }

// INCR each window key, set its TTL on first write only, and read the TTL back
// so the caller can report an accurate Retry-After. One round trip for every
// key. Returns null on any failure, which sends the caller to the in-memory
// counter for ALL keys — a mix of shared and local counts is not a limit.
async function bumpShared(key: string, windowMs: number): Promise<Count | null> {
  const rows = await kvPipeline([
    ["INCR", key],
    ["PEXPIRE", key, String(windowMs), "NX"],
    ["PTTL", key],
  ]);
  if (!rows) return null;

  const count = Number(rows[0]);
  const pttl = Number(rows[2]);
  if (!Number.isFinite(count)) return null;
  // PTTL is -1 when the key somehow has no expiry: fall back to a full window
  // rather than reporting a nonsense reset time.
  const ttl = Number.isFinite(pttl) && pttl > 0 ? pttl : windowMs;
  return { count, resetAt: Date.now() + ttl };
}

/** Bump one window key, using the shared store when it answers and the local map otherwise. */
async function bump(key: string, windowMs: number, stamp: number, now: number): Promise<Count> {
  return (await bumpShared(`rl:${key}:${stamp}`, windowMs)) ?? bumpLocal(key, windowMs, now);
}

function bumpLocal(key: string, windowMs: number, now: number): Count {
  let rec = hits.get(key);
  if (!rec || now >= rec.resetAt) {
    rec = { count: 0, resetAt: now + windowMs };
    hits.set(key, rec);
  }
  rec.count++;
  // Opportunistic GC so the map can't grow unbounded on a long-lived instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
  }
  return rec;
}

function tooMany(
  rec: Count,
  max: number,
  now: number,
  message: string,
  extraHeaders: Record<string, string>,
): Response {
  const retryAfter = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));
  return Response.json(
    { error: message },
    {
      status: 429,
      headers: {
        ...extraHeaders,
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(max),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(rec.resetAt / 1000)),
      },
    },
  );
}

// Returns a 429 Response when the request is over either limit, or null when it
// is allowed to proceed. Any `extraHeaders` (e.g. CORS) are merged onto the 429.
export async function isRateLimited(
  req: Request,
  extraHeaders: Record<string, string> = {},
  opts: RateLimitOptions = {},
): Promise<Response | null> {
  const max = opts.max ?? MAX_REQUESTS;
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const globalMax = opts.globalMax;
  const now = Date.now();
  const bucket = opts.bucket ?? "guide";
  const ipKey = `${bucket}:${clientIp(req)}`;
  const globalKey = `${bucket}:__all__`;

  // The window key carries the window it belongs to, so a changed budget or a
  // rolled window can never inherit a stale count.
  const stamp = Math.floor(now / windowMs);

  // Per-IP first, and a caller refused here never reaches the global counter.
  // That ordering is load-bearing: if blocked requests still consumed the
  // global allowance, one spammer on a single IP could trip the route-wide
  // ceiling and take the Guide down for everybody — turning a limiter meant to
  // contain a cost attack into a cheap availability attack. It costs a second
  // round trip on the routes that opt into globalMax, which against a turn
  // that runs for ten to twenty seconds is not a real cost.
  const ipRec = await bump(ipKey, windowMs, stamp, now);
  if (ipRec.count > max) {
    return tooMany(
      ipRec,
      max,
      now,
      opts.message ?? "Too many requests. Please slow down and try again shortly.",
      extraHeaders,
    );
  }

  if (globalMax !== undefined) {
    const globalRec = await bump(globalKey, windowMs, stamp, now);
    if (globalRec.count > globalMax) {
      return tooMany(
        globalRec,
        globalMax,
        now,
        "The Guide is handling an unusual volume of requests right now. Please try again in a moment.",
        extraHeaders,
      );
    }
  }

  return null;
}

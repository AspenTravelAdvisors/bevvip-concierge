// next-concierge/lib/rate-limit.ts — best-effort per-IP rate limiting for the
// Guide. Ported from the legacy lib/guide-rate-limit.js, adapted to the App
// Router's Web Request/Response.
//
// TWO BACKENDS, chosen by environment:
//
//   Distributed (preferred) — set UPSTASH_REDIS_REST_URL and
//     UPSTASH_REDIS_REST_TOKEN and every instance shares one counter, which is
//     the only way a limit actually holds on serverless. Spoken over Upstash's
//     REST API with plain fetch, so it adds no dependency and no cold-start
//     weight. Vercel KV exposes the same REST shape under KV_REST_API_URL /
//     KV_REST_API_TOKEN; both names are read.
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
// This matters more than it did. A single Guide request can now cost six model
// rounds plus a fan-out of in-process atlas queries, so a request that slips
// through is a lot more expensive than when the 10/min budget was written.

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
}

// bucket:ip -> { count, resetAt }
const hits = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

const STORE_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").replace(/\/+$/, "");
const STORE_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
/** True when a shared counter is configured; otherwise we run per-instance. */
export const isDistributed = (): boolean => !!(STORE_URL && STORE_TOKEN);
const STORE_TIMEOUT_MS = Number(process.env.RATE_STORE_TIMEOUT_MS) || 700;

interface Count { count: number; resetAt: number }

// INCR the window key, set its TTL on first write only, and read the TTL back
// so the caller can report an accurate Retry-After. One round trip. Returns
// null on any failure, which sends the caller to the in-memory counter.
async function bumpShared(key: string, windowMs: number): Promise<Count | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), STORE_TIMEOUT_MS);
  try {
    const res = await fetch(`${STORE_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${STORE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["PEXPIRE", key, String(windowMs), "NX"],
        ["PTTL", key],
      ]),
      signal: ctl.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    if (!Array.isArray(rows) || rows.length < 3 || rows.some((r) => r?.error)) return null;
    const count = Number(rows[0]?.result);
    const pttl = Number(rows[2]?.result);
    if (!Number.isFinite(count)) return null;
    // PTTL is -1 when the key somehow has no expiry: fall back to a full window
    // rather than reporting a nonsense reset time.
    const ttl = Number.isFinite(pttl) && pttl > 0 ? pttl : windowMs;
    return { count, resetAt: Date.now() + ttl };
  } catch {
    return null; // network error, timeout, bad JSON: degrade to local
  } finally {
    clearTimeout(timer);
  }
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

// Returns a 429 Response when the request is over the limit, or null when it is
// allowed to proceed. Any `extraHeaders` (e.g. CORS) are merged onto the 429.
export async function isRateLimited(
  req: Request,
  extraHeaders: Record<string, string> = {},
  opts: RateLimitOptions = {},
): Promise<Response | null> {
  const max = opts.max ?? MAX_REQUESTS;
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const now = Date.now();
  const key = `${opts.bucket ?? "guide"}:${clientIp(req)}`;

  // The window key carries the window it belongs to, so a changed budget or a
  // rolled window can never inherit a stale count.
  const rec =
    (isDistributed() ? await bumpShared(`rl:${key}:${Math.floor(now / windowMs)}`, windowMs) : null)
    ?? bumpLocal(key, windowMs, now);

  if (rec.count > max) {
    const retryAfter = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));
    return Response.json(
      { error: "Too many requests. Please slow down and try again shortly." },
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
  return null;
}

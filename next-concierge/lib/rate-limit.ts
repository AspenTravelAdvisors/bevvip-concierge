// next-concierge/lib/rate-limit.ts — best-effort per-IP rate limiting for the
// Guide. Ported from the legacy lib/guide-rate-limit.js, adapted to the App
// Router's Web Request/Response.
//
// CAVEAT: Vercel serverless functions are stateless across instances. This
// in-memory limiter only sees traffic on the same warm instance, so it
// throttles bursts from one client but is NOT a global guarantee — a flood
// spread across cold starts can slip past it. For a true global limit, back it
// with Vercel KV / Upstash Redis. This is a zero-dependency backstop that
// meaningfully raises the cost of casual abuse on the Hobby tier.

const WINDOW_MS = Number(process.env.GUIDE_RATE_WINDOW_MS) || 60_000;
const MAX_REQUESTS = Number(process.env.GUIDE_RATE_MAX) || 10;

// ip -> { count, resetAt }
const hits = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// Returns a 429 Response when the request is over the limit, or null when it is
// allowed to proceed. Any `extraHeaders` (e.g. CORS) are merged onto the 429.
export function isRateLimited(
  req: Request,
  extraHeaders: Record<string, string> = {},
): Response | null {
  const now = Date.now();
  const ip = clientIp(req);

  let rec = hits.get(ip);
  if (!rec || now >= rec.resetAt) {
    rec = { count: 0, resetAt: now + WINDOW_MS };
    hits.set(ip, rec);
  }
  rec.count++;

  // Opportunistic GC so the map can't grow unbounded on a long-lived instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
  }

  if (rec.count > MAX_REQUESTS) {
    const retryAfter = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));
    return Response.json(
      { error: "Too many requests. Please slow down and try again shortly." },
      {
        status: 429,
        headers: {
          ...extraHeaders,
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(rec.resetAt / 1000)),
        },
      },
    );
  }
  return null;
}

// lib/guide-rate-limit.js — best-effort per-IP rate limiting for the Guide.
//
// CAVEAT (read before trusting this as a hard cap): Vercel serverless functions
// are stateless across instances. This in-memory limiter only sees the traffic
// that lands on the same warm instance, so it throttles bursts from one client
// but is NOT a global guarantee — a flood spread across cold starts can slip
// past it. For a true global limit, back it with Vercel KV / Upstash Redis.
// This is a zero-dependency backstop that meaningfully raises the cost of
// casual abuse while we run on the Hobby tier.

const WINDOW_MS = Number(process.env.GUIDE_RATE_WINDOW_MS) || 60_000;
const MAX_REQUESTS = Number(process.env.GUIDE_RATE_MAX) || 10;

// ip -> { count, resetAt }
const hits = new Map();

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Returns true when the request is over the limit (and a 429 has been sent);
// false when it is allowed to proceed.
export function isRateLimited(req, res) {
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

  const remaining = Math.max(0, MAX_REQUESTS - rec.count);
  res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(rec.resetAt / 1000)));

  if (rec.count > MAX_REQUESTS) {
    const retryAfter = Math.max(1, Math.ceil((rec.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res
      .status(429)
      .json({ error: 'Too many requests. Please slow down and try again shortly.' });
    return true;
  }
  return false;
}

// lib/guide-cors.js — origin allowlist for the Guide endpoint.
//
// Every legitimate caller of /api/guide is SAME-ORIGIN: the concierge frontend
// (public/index.html) calls it as a relative path, and that holds even when the
// frontend is embedded as an iframe on the marketing sites — the iframe
// document's origin is still bevvip-concierge.vercel.app. So cross-origin
// browser access is never actually needed. We reflect an Origin only when it is
// on the allowlist below, and emit no CORS headers otherwise, which makes the
// browser block the cross-site call.
//
// IMPORTANT: CORS is a *browser* protection only. It stops other websites from
// calling this API from a visitor's browser; it does NOT stop curl or scripts,
// which ignore CORS entirely. Protection against quota abuse comes from the
// rate limiter in ./guide-rate-limit.js — CORS just removes the easy
// "embed it on any page" path.

const ALLOWED_ORIGINS = new Set([
  'https://bevvip-concierge.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

// This project's Vercel preview/branch deploys look like:
//   https://bevvip-concierge-<hash>-aspentraveladvisors-projects.vercel.app
const PREVIEW_ORIGIN_RE =
  /^https:\/\/bevvip-concierge[a-z0-9-]*-aspentraveladvisors-projects\.vercel\.app$/;

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return PREVIEW_ORIGIN_RE.test(origin);
}

// Applies CORS for allowed origins and answers the OPTIONS preflight.
// Returns true when it has already ended the response (OPTIONS) and the caller
// should `return`; returns false for normal requests so the handler continues.
export function handleCors(req, res) {
  const origin = req.headers.origin;
  const allowed = isAllowedOrigin(origin);

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    // Allowed origins get a 204 carrying the headers above; disallowed
    // cross-origin preflights get 403 with no CORS headers, so the browser
    // refuses to make the real request.
    res.status(allowed ? 204 : 403).end();
    return true;
  }
  return false;
}

// next-concierge/lib/guide-cors.ts — origin allowlist for /api/guide. Ported
// from the legacy lib/guide-cors.js, adapted to the App Router's Web Request.
//
// Every legitimate caller is SAME-ORIGIN: the concierge frontend calls this as
// a relative path, and that holds even when the frontend is embedded as an
// iframe on the marketing sites — the iframe document's origin is whichever
// host served it, and that host is now guide.expeditionbucketlist.com (the
// alias domains 308 there before a document is ever parsed, so no page can be
// running on one of them). So cross-origin browser access is never actually
// needed. We reflect an Origin only when it is on the allowlist below, and emit
// no CORS headers otherwise, which makes the browser block the cross-site call.
//
// CORS is a *browser* protection only — it does NOT stop curl or scripts.
// Quota abuse is handled by the rate limiter in ./rate-limit.ts.

const ALLOWED_ORIGINS = new Set([
  // The canonical origin — see SITE_URL in lib/answers.js.
  "https://guide.expeditionbucketlist.com",
  // Kept because the *.vercel.app hosts deliberately still serve the app
  // rather than redirecting, so a preview can be opened and debugged.
  "https://bevvip-concierge.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

// This project's Vercel preview/branch deploys look like:
//   https://bevvip-concierge-<hash>-aspentraveladvisors-projects.vercel.app
const PREVIEW_ORIGIN_RE =
  /^https:\/\/bevvip-concierge[a-z0-9-]*-aspentraveladvisors-projects\.vercel\.app$/;

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return PREVIEW_ORIGIN_RE.test(origin);
}

// CORS headers for an allowed origin; an empty object otherwise (no reflection,
// so the browser blocks the cross-site call).
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin as string,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// next-concierge/lib/blocked-countries.ts — countries the site does not serve.
//
// Owner decision, 23 September 2026: China is not a market for this business,
// and it was the source of the sustained Guide traffic that BotID classified
// "human" (every sampled guide_turn that afternoon was CN, one question every
// one to eight minutes, ~5x the normal daily volume, no inquiries). Blocked for
// the whole site, not only /api/guide: the atlas and its data are the product
// being copied, not just the model spend.
//
// Enforced in middleware.ts for every page and in the Guide route itself, so
// the one endpoint that spends money stays covered if the middleware matcher is
// ever narrowed. Override with BLOCKED_COUNTRIES="CN,XX" (ISO 3166-1 alpha-2).

const BLOCKED = new Set(
  (process.env.BLOCKED_COUNTRIES ?? "CN")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean),
);

/** True when Vercel's edge geolocation places the request in a blocked country. */
export function isBlockedCountry(headers: Headers): boolean {
  const country = headers.get("x-vercel-ip-country")?.toUpperCase();
  return !!country && BLOCKED.has(country);
}

/** A plain refusal. No detail about why — nothing to tune an evasion against. */
export function blockedResponse(): Response {
  return new Response("Not available in your region.", {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

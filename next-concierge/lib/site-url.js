// next-concierge/lib/site-url.js — the app's own origin, and nothing else.
//
// It lived in lib/answers.js, which every consumer still imports it through.
// It moved here so a route that needs only the address (the advisor hand-off,
// the CORS allowlist) can have it without importing every answer page too.

/**
 * Canonical origin for absolute URLs in metadata, sitemap, robots and JSON-LD.
 *
 * THE one place the app's own address is written down. It used to be written
 * twice — in lib/answers.js and as `metadataBase` in app/layout.tsx — which is
 * how the header ended up advertising "TheTravelGuideAi.com" while the
 * canonical URLs pointed somewhere else entirely: three spellings of one
 * address, none of them checked against the others.
 *
 * It reads NEXT_PUBLIC_SITE_URL so the host is deployment configuration rather
 * than source. The literal that used to sit here was theaitravelguide.com, and
 * moving to guide.expeditionbucketlist.com meant editing a string that eleven
 * modules import — the exact shape of change that gets done in nine of them.
 * The fallback is the production host, so a build with no env set is correct
 * rather than merely non-crashing; the env var is what lets a preview or a
 * staging host emit its own absolute URLs instead of production's.
 *
 * Naming note: this is the ADDRESS, not the brand. The wordmark in the header
 * reads "Expedition Bucket List" and links to expeditionbucketlist.com — a
 * visitor who clicks a brand expects the brand. The line that used to sit
 * beneath it spelling out this app's own address is gone: the app is now a
 * subdomain of that same brand, so the line said the same name twice.
 */
const RAW_SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://guide.expeditionbucketlist.com";

/*
 * Trailing slashes are stripped here rather than trusted to whoever typed the
 * env var. Every consumer builds `${SITE_URL}/answers` — one trailing slash in
 * a Vercel dashboard field and the whole sitemap ships doubled slashes, which
 * is a different URL to a crawler and a self-inflicted duplicate of every page.
 * `new URL` also fails the build here, at import, if the value is not an
 * absolute origin — better than metadataBase throwing halfway through a render.
 */
export const SITE_URL = new URL(RAW_SITE_URL).origin;

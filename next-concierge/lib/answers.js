// Registry for the /answers question pages. Server-only: imported by the
// answers routes, sitemap and robots — never from a "use client" file.

import { expeditionAnswers } from "@/data/answers/expedition";
import { hotelAnswers } from "@/data/answers/hotels";
import { villaAnswers } from "@/data/answers/villas";
import { journeyAnswers } from "@/data/answers/journeys";
import { safariAnswers } from "@/data/answers/safari";

/**
 * Canonical origin for absolute URLs in metadata, sitemap, robots and JSON-LD.
 *
 * THE one place the app's own address is written down. It used to be written
 * twice — here and as `metadataBase` in app/layout.tsx — which is how the
 * header ended up advertising "TheTravelGuideAi.com" while the canonical URLs
 * pointed somewhere else entirely: three spellings of one address, none of
 * them checked against the others. layout.tsx now imports this.
 *
 * The app is served from guide.expeditionbucketlist.com, a subdomain of the
 * brand's own domain rather than the unrelated theaitravelguide.com this used
 * to name. That mattered most to the sitemap: every URL it emits is built from
 * this constant, so a sitemap generated against the old value listed all 8,532
 * of its URLs under a host that does not serve them — the one file whose whole
 * job is telling a crawler where the pages live, pointing at the wrong door.
 *
 * Naming note: this is the ADDRESS, not the brand. The wordmark above it still
 * reads "Expedition Bucket List" and still links to the apex
 * expeditionbucketlist.com — a visitor who clicks a brand expects the brand's
 * front page, not this app. The line underneath, which is this app's own front
 * door, is the subdomain.
 */
export const SITE_URL = "https://guide.expeditionbucketlist.com";

/**
 * The same address, cased for a human to read: "guide.ExpeditionBucketList.com".
 *
 * Domains are case-insensitive and an unbroken lowercase run is not —
 * "expeditionbucketlist" makes a reader do the segmenting for three words that
 * are already the brand they just read in the wordmark above. The capitals are
 * word boundaries, and they are the whole reason this is a separate constant
 * rather than `new URL(SITE_URL).host`. The subdomain stays lowercase because
 * that is how a host reads: "guide." is the part that distinguishes this
 * address from the brand's own site.
 *
 * The assertion below is what keeps it a display variant rather than a second
 * source of truth: change one and the build fails until you change the other.
 * That is not hypothetical here — the header used to read "TheTravelGuideAi",
 * the right words in the wrong order, and nothing anywhere noticed.
 */
export const SITE_LABEL = "guide.ExpeditionBucketList.com";

if (SITE_LABEL.toLowerCase() !== new URL(SITE_URL).host.toLowerCase()) {
  throw new Error(
    `SITE_LABEL (${SITE_LABEL}) and SITE_URL (${SITE_URL}) name different addresses`,
  );
}

export const ALL_ANSWERS = [
  ...expeditionAnswers,
  ...hotelAnswers,
  ...villaAnswers,
  ...journeyAnswers,
  ...safariAnswers,
];

const BY_SLUG = new Map(ALL_ANSWERS.map((a) => [a.slug, a]));

export function getAnswer(slug) {
  return BY_SLUG.get(slug) || null;
}

export function answerParams() {
  return ALL_ANSWERS.map((a) => ({ slug: a.slug }));
}

/**
 * Category display order for the index page — and, because of how
 * answersByCategory() uses it, the list of categories that can appear AT ALL.
 *
 * That second job is the dangerous one. The filter below drops any category not
 * named here, silently: an answer with `category: "Safari"` still built its own
 * page and still reached the sitemap, but never appeared on /answers, so nothing
 * linked to it. A hand-kept list that decides what exists is the same shape as
 * the bug that kept safari out of the sitemap's atlas list and out of
 * audit-listings' SHIPPED table. `verify:seo` now fails on a category that is
 * not in this array, so adding one is a build error rather than a silent
 * orphan.
 */
export const CATEGORY_ORDER = ["Expedition", "Safari", "Hotels", "Villas", "Voyages", "Rails", "Yachts", "Planning"];

export function answersByCategory() {
  const groups = new Map();
  for (const a of ALL_ANSWERS) {
    if (!groups.has(a.category)) groups.set(a.category, []);
    groups.get(a.category).push(a);
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => ({
    category: c,
    answers: groups.get(c),
  }));
}

// JSON-LD for these pages lives in lib/seo/answer-schema.js.
//
// It used to live here, and it described the publisher inline — a fourth
// spelling of "Aspen Travel Advisors" with no `@id` tying it to the three
// others. Schema that references the site's identity graph belongs beside that
// graph; this file is the registry, and robots.js and sitemap.js import it, so
// it stays free of the atlas and of the identity nodes.

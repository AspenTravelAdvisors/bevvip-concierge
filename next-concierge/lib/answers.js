// Registry for the /answers question pages. Server-only: imported by the
// answers routes, sitemap and robots — never from a "use client" file.

import { expeditionAnswers } from "@/data/answers/expedition";
import { hotelAnswers } from "@/data/answers/hotels";
import { villaAnswers } from "@/data/answers/villas";
import { journeyAnswers } from "@/data/answers/journeys";

/**
 * Canonical origin for absolute URLs in metadata, sitemap, robots and JSON-LD.
 *
 * THE one place the app's own address is written down. It used to be written
 * twice — here and as `metadataBase` in app/layout.tsx — which is how the
 * header ended up advertising "TheTravelGuideAi.com" while the canonical URLs
 * pointed somewhere else entirely: three spellings of one address, none of
 * them checked against the others. layout.tsx now imports this.
 *
 * Naming note: this is the ADDRESS, not the brand. The wordmark above it still
 * reads "Expedition Bucket List" and still links to expeditionbucketlist.com —
 * a visitor who clicks a brand expects the brand. Only the line underneath,
 * which is this app's own front door, changed.
 */
export const SITE_URL = "https://theaitravelguide.com";

/**
 * The same address, cased for a human to read: "TheAiTravelGuide.com".
 *
 * Domains are case-insensitive and an all-lowercase run of nineteen letters is
 * not — "theaitravelguide.com" makes a reader parse "thea", "itravel". The
 * capitals are word boundaries, and they are the whole reason this is a
 * separate constant rather than `new URL(SITE_URL).host`.
 *
 * The assertion below is what keeps it a display variant rather than a second
 * source of truth: change one and the build fails until you change the other.
 * That is not hypothetical here — the header used to read "TheTravelGuideAi",
 * the right words in the wrong order, and nothing anywhere noticed.
 */
export const SITE_LABEL = "TheAiTravelGuide.com";

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
];

const BY_SLUG = new Map(ALL_ANSWERS.map((a) => [a.slug, a]));

export function getAnswer(slug) {
  return BY_SLUG.get(slug) || null;
}

export function answerParams() {
  return ALL_ANSWERS.map((a) => ({ slug: a.slug }));
}

// Category display order for the index page.
export const CATEGORY_ORDER = ["Expedition", "Hotels", "Villas", "Voyages", "Rails", "Yachts", "Planning"];

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

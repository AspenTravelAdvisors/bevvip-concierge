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

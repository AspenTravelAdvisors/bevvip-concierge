// The fact engine, bound to the shipped data. Server-only.
//
// lib/seo/facts.mjs holds the semantics and no data; this file is the Next-side
// loader for it. scripts/verify-seo.mjs is the other loader. Neither carries a
// second copy of what a term means.

import { makeFacts } from "@/lib/seo/facts.mjs";
import { COLLECTIONS } from "@/lib/atlas-config";
import { ALL_ANSWERS, getAnswer, answersByCategory } from "@/lib/answers";
import { allHotels, hotelPath } from "@/lib/seo/hotels";
import journeyFacts from "@/data/atlas/shared/journey-facts.json";

// The hotels the entity pages serve, so a row in an evidence table and the page
// it links to are the same record — program overrides and slugs included.
const HOTELS = allHotels();

const COLLECTION_COUNTS = Object.fromEntries(
  COLLECTIONS.map((c) => [c.type, c.count]),
);

/*
 * Journeys arrive as a generated artifact, not as the route feeds.
 *
 * A live import would pull every route atlas plus 3.6MB of cruise route
 * geometry into this bundle to count rows. scripts/build-journey-facts.mjs
 * precomputes exactly the countable fields, one row per itinerary, using the
 * same grouping the /journeys pages serve from — so a count in a sentence and
 * the page it links to cannot disagree about what an itinerary is.
 */
export const facts = makeFacts(HOTELS, COLLECTION_COUNTS, journeyFacts.rows);

/**
 * Resolve an answer's `evidence` block into real, linkable properties.
 *
 * This is the part the Virtuoso sync makes possible. Before it, an answer page
 * could assert "the quietest resorts in Italy" and support the claim with
 * nothing a reader or a crawler could follow. Now the claim is followed
 * immediately by the properties it is about — named, counted, linked to their
 * own pages, and regenerated from the supplier feed on every build.
 */
export function answerEvidence(a) {
  if (!a || !a.evidence) return null;
  const e = a.evidence;
  const rows = facts.select(e.query, { limit: e.limit || 12, sort: e.sort || "name" });
  const total = facts.count(e.query);
  return {
    h2: e.h2,
    note: e.note || null,
    total,
    shown: rows.length,
    rows: rows.map((h) => ({
      id: h.id,
      name: h.name,
      where: [h.city, h.country].filter(Boolean).join(", "),
      program: h.program,
      brand: h.brand,
      rooms: Number.isFinite(h.numberOfRooms) ? h.numberOfRooms : null,
      perks: (h.vipUpgrades || []).length,
      href: hotelPath(h),
    })),
  };
}

/**
 * The registry, resolved. Every surface that renders answer PROSE reads from
 * here rather than from lib/answers.js directly.
 *
 * That indirection is not decoration — it is the fix for a bug this file
 * caused. The detail page resolved its own record and the index page did not,
 * so `/answers` and `/llms.txt` published `{{hotels:program=Virtuoso}}` in
 * their descriptions while the page those descriptions pointed at read
 * correctly. One resolved accessor per consumer is one too many; there is now
 * exactly one, and lib/answers.js stays token-bearing so robots.js and
 * sitemap.js (which read only slugs and dates) never load the hotel feed.
 */
export const resolvedAnswers = () => ALL_ANSWERS.map((a) => facts.resolveDeep(a));

export function resolvedAnswer(slug) {
  const raw = getAnswer(slug);
  return raw ? facts.resolveDeep(raw) : null;
}

export function resolvedAnswersByCategory() {
  return answersByCategory().map(({ category, answers }) => ({
    category,
    answers: answers.map((a) => facts.resolveDeep(a)),
  }));
}

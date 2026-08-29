// How a journey collection collapses into itinerary pages — the rule, once.
//
// Three places need this and each had its own copy of it within a day of the
// first being written: lib/seo/journeys.js builds the pages, this repo's
// verify-seo.mjs re-derived the slugs to check them, and the facts generator
// needs the same grouping to count itineraries rather than departures. A
// verifier carrying its own definition of the thing it verifies can pass while
// the thing is broken — the failure this repository has paid for with four
// copies of an NDJSON reader and two definitions of a CSS detector.
//
// Pure: it takes adapted offerings and returns groups. No I/O, no imports, so
// the Next pages and the node scripts share one implementation.

const fold = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export const slugify = (s) =>
  fold(s)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The operator an itinerary is filed under: brandLabel, else operator. */
export const operatorOf = (o) => o.brandLabel || o.operator || null;

/** The grouping key. Operator plus title — see the note in lib/seo/journeys.js. */
export const groupKeyOf = (o) => `${operatorOf(o) || ""}|${o.title}`;

/**
 * Group one collection's offerings into itineraries, in a deterministic order,
 * each with its slug already assigned.
 *
 * The order is by the first offering's id, and the slug tie-break appends that
 * id, so a feed that later adds a colliding itinerary cannot take an existing
 * page's URL away.
 */
export function groupItineraries(offerings) {
  const groups = new Map();
  for (const o of offerings || []) {
    const key = groupKeyOf(o);
    const g = groups.get(key) || { key, operator: operatorOf(o), title: o.title, departures: [] };
    g.departures.push(o);
    groups.set(key, g);
  }

  const ordered = [...groups.values()].sort((a, b) =>
    String(a.departures[0].id).localeCompare(String(b.departures[0].id)),
  );

  const taken = new Set();
  for (const g of ordered) {
    const base =
      slugify([g.operator, g.title].filter(Boolean).join(" ")) ||
      slugify(g.departures[0].id);
    g.slug = taken.has(base) ? `${base}-${slugify(g.departures[0].id)}` : base;
    taken.add(g.slug);
  }
  return ordered;
}

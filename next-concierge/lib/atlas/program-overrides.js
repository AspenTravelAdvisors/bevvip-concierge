// lib/atlas/program-overrides.js — hotel program membership overlay
//
// The inventory feed stores the channel a property was imported under, not the
// program that governs it: 1,970 of 2,501 hotels say "Virtuoso", which flattens
// whole hotel-company programs into one bucket on the atlas's "Brand / Program"
// axis and hides the relationship from the preferred-partner ranking.
//
// data/atlas/hotel/program-overrides.json is the ledger that puts those
// families back. Applying it here — rather than editing luxury-hotels.json —
// keeps the override alive across a feed re-import, the same discipline
// port-overrides.json follows for coordinates.
//
// Applied at both entry points so the map and the query layer never disagree:
//   - lib/atlas/hotels.js          (API, Guide search, cards)
//   - scripts/build-hotel-points.mjs (public/maps/hotel/hotel-points.json)

const ledger = require("../../data/atlas/hotel/program-overrides.json");

const fold = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

// Compile once: each rule becomes a flat list of {program, brand, re, brandKey}
// tests, cheapest (exact brand equality) first.
const COMPILED = (ledger.rules || []).map((rule) => ({
  program: rule.program,
  excludeIds: new Set(rule.excludeIds || []),
  brands: (rule.brandRules || []).map((b) => ({
    brand: b.brand,
    brandKey: fold(b.brand),
    re: b.namePattern ? new RegExp(b.namePattern) : null,
  })),
}));

/**
 * The rule a hotel falls under, or null. Brand equality and the name pattern
 * are both accepted: the feed leaves `brand` null on most InterContinental and
 * Kimpton records, and mislabels one (see the ledger notes), so the name is the
 * only reliable signal there — while Six Senses and Regent arrive brand-tagged.
 */
function overrideFor(hotel) {
  if (!hotel) return null;
  const name = fold(hotel.name);
  const brandKey = fold(hotel.brand);
  for (const rule of COMPILED) {
    if (rule.excludeIds.has(hotel.id)) continue;
    for (const b of rule.brands) {
      if ((brandKey && brandKey === b.brandKey) || (b.re && b.re.test(name))) {
        return { program: rule.program, brand: b.brand };
      }
    }
  }
  return null;
}

/**
 * Returns the hotel with its program (and brand) corrected, or the SAME object
 * when no rule applies — identity is preserved so callers can keep using the
 * record as a Map key and so the untouched 97% costs nothing.
 *
 * `programSource` keeps the feed's original program value; nothing is lost.
 */
function applyOverride(hotel) {
  const hit = overrideFor(hotel);
  if (!hit) return hotel;
  const out = { ...hotel, program: hit.program, brand: hit.brand };
  if (hotel.program && hotel.program !== hit.program) out.programSource = hotel.program;
  return out;
}

/** Map a whole inventory array through the ledger. */
function applyProgramOverrides(list) {
  return Array.isArray(list) ? list.map(applyOverride) : list;
}

module.exports = { overrideFor, applyOverride, applyProgramOverrides };

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
  fromPrograms: rule.fromPrograms ? new Set(rule.fromPrograms) : null,
  brands: (rule.brandRules || []).map((b) => ({
    brand: b.brand || null,
    brandKey: b.brand ? fold(b.brand) : "",
    chainKey: b.chain ? fold(b.chain) : "",
    re: b.namePattern ? new RegExp(b.namePattern) : null,
  })),
}));

/**
 * One brandRule against one hotel. A `chain` entry is keyed to Virtuoso's own
 * chain field (supplier truth) and must match; a namePattern alongside it then
 * narrows the chain (Marriott's luxury group spans two programs). Without a
 * chain, brand equality or the name pattern is enough.
 */
function ruleMatches(b, name, brandKey, chainKey) {
  if (b.chainKey) return chainKey === b.chainKey && (!b.re || b.re.test(name));
  return (brandKey && brandKey === b.brandKey) || (b.re && b.re.test(name));
}

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
  const chainKey = fold(hotel.chain);
  for (const rule of COMPILED) {
    if (rule.excludeIds.has(hotel.id)) continue;
    // A rule limited to the import channel never relabels a hotel someone
    // already filed under a specific program (e.g. "Ritz-Carlton Reserve").
    if (rule.fromPrograms && !rule.fromPrograms.has(hotel.program || "Virtuoso")) continue;
    for (const b of rule.brands) {
      if (ruleMatches(b, name, brandKey, chainKey)) {
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
  // A chain rule names no brand: "Hilton Luxury Brands" spans Waldorf Astoria,
  // Conrad and LXR, and each record's own brand is the right one to keep.
  const out = { ...hotel, program: hit.program, brand: hit.brand || hotel.brand };
  if (hotel.program && hotel.program !== hit.program) out.programSource = hotel.program;
  return out;
}

/** Map a whole inventory array through the ledger. */
function applyProgramOverrides(list) {
  return Array.isArray(list) ? list.map(applyOverride) : list;
}

module.exports = { overrideFor, applyOverride, applyProgramOverrides };

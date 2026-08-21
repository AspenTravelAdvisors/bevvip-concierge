// lib/atlas/place-aliases.js — resort-umbrella search aliases
//
// The feed stores a property's postal town. For most of the inventory that is
// also what a guest types, but at a handful of ski addresses it is not: the
// town is "Snowmass Village" and the search is "aspen". The result was a search
// that looked right and was wrong — /atlas/hotel?q=aspen returned five of the
// six Aspen-area houses and quietly left out Viceroy Snowmass.
//
// data/atlas/hotel/place-aliases.json is the ledger. Applying it here rather
// than rewriting `city` keeps the displayed town honest (Viceroy Snowmass is
// not in Aspen) and survives a feed re-import, the same discipline
// program-overrides.json and port-overrides.json follow.
//
// Applied at every surface that owns a hotel haystack:
//   - lib/atlas/hotels.js            (API, Guide search, cards)
//   - scripts/build-hotel-points.mjs (public/maps/hotel/hotel-points.json)
//     which in turn feeds lib/atlas/adapters/hotel.ts and the standalone map.

const ledger = require("../../data/atlas/hotel/place-aliases.json");

const fold = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

const RULES = (ledger.rules || []).map((r) => ({
  city: fold(r.city),
  adminRegion: r.adminRegion ? fold(r.adminRegion) : null,
  country: r.country ? fold(r.country) : null,
  aliases: (r.aliases || []).filter(Boolean),
}));

/** The alias names for a hotel, or an empty array. */
function aliasesFor(hotel) {
  if (!hotel) return [];
  const city = fold(hotel.city);
  if (!city) return [];
  for (const r of RULES) {
    if (r.city !== city) continue;
    if (r.adminRegion && r.adminRegion !== fold(hotel.adminRegion || hotel.region)) continue;
    if (r.country && r.country !== fold(hotel.country)) continue;
    return r.aliases;
  }
  return [];
}

/**
 * The aliases as one space-joined string, ready to concatenate onto a haystack.
 * Empty string when there are none, so callers can append unconditionally.
 */
function aliasText(hotel) {
  const a = aliasesFor(hotel);
  return a.length ? a.join(" ") : "";
}

module.exports = { aliasesFor, aliasText };

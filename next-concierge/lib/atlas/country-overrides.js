// lib/atlas/country-overrides.js — hotel country canonicalisation
//
// `country` used to be a filter facet. Since /hotels/<country>/<property> it is
// also a public address, and the feed spells four countries two ways — so the
// same country minted two hub pages and neither held its inventory. "Turkey"
// had 2 properties and "Türkiye" 22, both with hotels in Bodrum.
//
// The evidence that these are typos rather than distinctions is in the data
// itself: every minority spelling is a pre-merge `source: local` record with NO
// countryCode, while the majority spelling carries the supplier's ISO. Da Nang
// is the exception and the strongest case — it carries VNM, so the feed
// disagrees with itself about which country it is in.
//
// An overlay rather than an edit to luxury-hotels.json, so it survives a feed
// re-import — the discipline program-overrides.json and port-overrides.json
// already follow. Applied through lib/atlas/hotel-overlays.js, which is what
// keeps the page and the map from disagreeing.

const ledger = require("../../data/atlas/hotel/country-overrides.json");

const fold = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

// Folded, so a case variant is caught by the same rule that catches the accent
// variant. "Saint Vincent and the Grenadines" and "Saint Vincent And The
// Grenadines" differ only in capitals and are one country either way.
const BY_FROM = new Map(
  (ledger.rules || []).map((r) => [fold(r.from), r.to]),
);

/** Countries that do not name a place. Not filtered out — see `notPlaceCountries`. */
const NOT_PLACES = new Set(
  (ledger.notPlaces || [])
    .filter((n) => !n.keep)
    .map((n) => fold(n.country)),
);

/** The canonical country for a record, or its own if the ledger is silent. */
function canonicalCountry(country) {
  return BY_FROM.get(fold(country)) || country;
}

/**
 * True when this record's country names a portfolio rather than a place.
 *
 * Used by lib/seo/hotels.js to keep three portfolio listings out of the
 * /hotels tree. Deliberately NOT used to filter the atlas: they are real
 * products and stay searchable — they just cannot honestly have an address
 * page, because they have no address.
 */
function isNotAPlace(country) {
  return NOT_PLACES.has(fold(country));
}

function applyCountryOverrides(list) {
  return (list || []).map((h) => {
    const to = BY_FROM.get(fold(h && h.country));
    return to && to !== h.country ? { ...h, country: to } : h;
  });
}

module.exports = { canonicalCountry, isNotAPlace, applyCountryOverrides };

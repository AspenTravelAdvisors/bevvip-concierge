// lib/atlas/hotel-overlays.js — every overlay the hotel feed carries, in order.
//
// This exists because of the shape of the bug it prevents, which this
// repository has now paid for four separate times: a decision applied in three
// of the four places that need it. `applyProgramOverrides` was called in
// lib/atlas/hotels.js, lib/seo/hotels.js, scripts/build-hotel-points.mjs and
// scripts/verify-seo.mjs — four call sites, each of which a new overlay would
// have to be added to by hand, and nothing anywhere failing when one was
// missed. The symptom would be the page and the map disagreeing about what a
// country contains, which is exactly the defect the country ledger was written
// to avoid creating.
//
// So there is one function now. Adding an overlay is one edit here and no edits
// anywhere else.
//
// ORDER MATTERS and is asserted by nothing but this comment: program first,
// because a program rule may key on a brand or a name pattern; country second,
// because nothing keys on country. If an overlay is ever added that reads a
// field an earlier one writes, say so here.

const { applyProgramOverrides } = require("./program-overrides");
const { applyCountryOverrides } = require("./country-overrides");

function applyHotelOverlays(list) {
  return applyCountryOverrides(applyProgramOverrides(list));
}

module.exports = { applyHotelOverlays };

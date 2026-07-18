// lib/atlas/travelwits-overlay.js — TravelWits identity overlay.
// Maps our hotel ids to the portal's own hotelId + coordinates + canonical
// label, harvested by scripts/build-travelwits-overlay.mjs. A deep link only
// auto-runs the search when sa[hotelId] identifies the property; without it
// the client is stranded at the search form ("Address is required").

const overlay = require("../../data/atlas/hotel/travelwits-overlay.json");

// { hotelId, lat, lon, label } for a hotel record or id, or null when the
// property never resolved against the portal inventory.
function travelWitsFor(hotelOrId) {
  const id = typeof hotelOrId === "string" ? hotelOrId : hotelOrId && hotelOrId.id;
  return (id && overlay.matched[id]) || null;
}

module.exports = { travelWitsFor };

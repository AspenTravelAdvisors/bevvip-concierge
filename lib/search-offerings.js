// lib/search-offerings.js — Base Camp T6
// The single tool the Guide calls. Maps a natural-language intent (already
// parsed by the model into params) onto the live Base Camp data layer, returns
// REAL inventory plus the prebuilt Atlas deep link and a marquee region key for
// the [[CHART: region]] control. No model-knowledge invention; no final pricing.
//
// Inventory is the shared source of truth behind /api (SPEC architecture rule).
// Hotels come from the live hotel atlas API; cruise/jet/yacht are normalized
// in-process from each Atlas app's live feed via lib/offerings-data.js (also
// exposed over HTTP at /api/offerings). All four types are live.

import { queryOfferings } from "./offerings-data.js";

const HOTEL_API_BASE =
  process.env.HOTEL_ATLAS_API_BASE || "https://luxury-hotel-atlas-two.vercel.app";

// Marquee region keys the Living Atlas can plot (CLAUDE.md / SPEC §3).
const MARQUEE_KEYS = new Set([
  "antarctica", "arctic", "galapagos", "amazon", "polynesia",
  "patagonia", "kimberley", "mediterranean", "norway", "japan", "namibia",
]);

// Anthropic tool-use schema (SPEC §6, verbatim shape).
export const SEARCH_OFFERINGS_TOOL = {
  name: "search_offerings",
  description:
    "Search Aspen Travel Advisors inventory: luxury hotels, expedition cruises, " +
    "private jet journeys, and brand-yacht sailings. Use whenever a traveler " +
    "names a place, brand, season, or trip type.",
  input_schema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["hotel", "cruise", "jet", "yacht", "any"] },
      q: {
        type: "string",
        description:
          "Free-text descriptors ONLY, e.g. 'overwater villa', 'ski-in', 'northern lights'. " +
          "Never put a brand, country, or region here. Use brand/country/region for those.",
      },
      region: {
        type: "string",
        description:
          "Marquee region key, one of: antarctica, arctic, galapagos, amazon, polynesia, " +
          "patagonia, kimberley, mediterranean, norway, japan, namibia. Use when the trip clearly maps to one.",
      },
      brand: { type: "string", description: "Hotel brand or operator, e.g. Aman, Four Seasons, Rosewood." },
      country: { type: "string", description: "Country name, e.g. Japan, Italy, France." },
      month: { type: "string", description: "YYYY-MM when timing matters" },
      limit: { type: "integer", default: 6 },
    },
  },
};

function clampLimit(raw, fallback = 6) {
  let n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) n = fallback;
  if (n > 24) n = 24; // the Guide leads with a few, never a list dump
  return n;
}

// Trim a normalized hotel record to what the Guide renders on a card. Drops
// coordinates/thumb/tags and anything pricing-related (there is none here).
function hotelCard(h) {
  return {
    id: h.id,
    name: h.name,
    brand: h.brand,
    program: h.program,
    category: h.category,
    city: h.city,
    country: h.country,
    region: h.region,           // marquee key (may be null)
    adminRegion: h.adminRegion,  // sub-national place
    vipUpgrades: h.vipUpgrades || [],
    bookUrl: h.bookUrl,
    bookPassword: h.bookPassword,
  };
}

// Pick the [[CHART: region]] key: an explicit marquee region wins; otherwise the
// most common marquee region among the results, if any.
function chartRegionFrom(inputRegion, results) {
  const r = (inputRegion || "").toLowerCase().trim();
  if (MARQUEE_KEYS.has(r)) return r;
  const tally = {};
  for (const h of results) {
    if (h.region && MARQUEE_KEYS.has(h.region)) tally[h.region] = (tally[h.region] || 0) + 1;
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

async function searchHotels(input, fetchImpl) {
  const limit = clampLimit(input.limit, 6);
  const p = new URLSearchParams();
  if (input.q) p.set("q", String(input.q).trim());
  if (input.region) p.set("region", String(input.region).trim());
  if (input.brand) p.set("brand", String(input.brand).trim());
  if (input.country) p.set("country", String(input.country).trim());
  p.set("limit", String(limit));

  const url = `${HOTEL_API_BASE}/api/luxury-hotels?${p.toString()}`;
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`hotel api ${r.status}`);
  const j = await r.json();
  const results = (j.results || []).map(hotelCard);

  return {
    type: "hotel",
    total: j.total ?? results.length,   // honest unpaginated count for the Guide
    count: results.length,
    results,
    deepLink: j.deepLink || null,
    chartRegion: chartRegionFrom(input.region, j.results || []),
  };
}

// cruise | jet | yacht -> normalized in-process from each Atlas app's live feed
// (lib/offerings-data.js). Same query shape as hotels; degrades gracefully if a
// feed is unreachable so the Guide routes to an advisor instead of inventing.
async function searchOfferingsByType(type, input, fetchImpl) {
  const limit = clampLimit(input.limit, 6);
  try {
    const j = await queryOfferings(
      { type, q: input.q, region: input.region, country: input.country, month: input.month, limit },
      { fetchImpl }
    );
    return {
      type,
      total: j.total ?? j.results.length,
      count: j.results.length,
      results: j.results,
      deepLink: j.deepLink || null,
      chartRegion: j.chartRegion ?? chartRegionFrom(input.region, j.results),
    };
  } catch (err) {
    // Feed unreachable: tell the Guide so it can route to an advisor.
    return {
      type,
      total: 0,
      count: 0,
      results: [],
      deepLink: null,
      chartRegion: MARQUEE_KEYS.has((input.region || "").toLowerCase())
        ? input.region.toLowerCase()
        : null,
      unavailable: true,
      note:
        `${type} inventory is momentarily unreachable. An advisor can ` +
        `source live ${type} options directly.`,
    };
  }
}

// Main entry. `input` is the validated tool input from the model.
export async function searchOfferings(input = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const type = String(input.type || "any").toLowerCase();

  if (type === "hotel" || type === "any") {
    return searchHotels(input, fetchImpl);
  }
  if (type === "cruise" || type === "jet" || type === "yacht") {
    return searchOfferingsByType(type, input, fetchImpl);
  }
  // Unknown type -> treat as hotel search rather than erroring.
  return searchHotels(input, fetchImpl);
}

export { chartRegionFrom, clampLimit, MARQUEE_KEYS, HOTEL_API_BASE };

// lib/search-offerings.js — Base Camp T6
// The single tool the Guide calls. Maps a natural-language intent (already
// parsed by the model into params) onto the live Base Camp data layer, returns
// REAL inventory plus the prebuilt Atlas deep link and a marquee region key for
// the [[CHART: region]] control. No model-knowledge invention; no final pricing.
//
// Inventory is the shared source of truth behind /api (SPEC architecture rule).
// Each type is served by its own Atlas repo's query API, identical in contract
// to the Hotel Atlas /api/luxury-hotels: { total, count, results, deepLink }.
// The Guide queries all four the same way over HTTP.

const HOTEL_API_BASE =
  process.env.HOTEL_ATLAS_API_BASE || "https://luxury-hotel-atlas-two.vercel.app";

// type -> { base URL, endpoint path } for the cruise/jet/yacht Atlas APIs.
const OFFERINGS_ENDPOINTS = {
  cruise: {
    base: process.env.CRUISE_ATLAS_API_BASE || "https://expedition-cruise-map.vercel.app",
    path: "/api/expedition-cruises",
  },
  jet: {
    base: process.env.JET_ATLAS_API_BASE || "https://private-jet-expeditions.vercel.app",
    path: "/api/jet-journeys",
  },
  yacht: {
    base: process.env.YACHT_ATLAS_API_BASE || "https://luxury-hotel-brand-yacht-atlas.vercel.app",
    path: "/api/yacht-sailings",
  },
};

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
      month: {
        type: "string",
        description:
          "Travel month. Prefer YYYY-MM. If the traveler names a month with no year, " +
          "a bare month name (e.g. 'January') is fine; it is resolved to the next " +
          "occurrence of that month.",
      },
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

// Month names -> 1..12 (full + common 3-letter abbreviations).
const MONTH_NAMES = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

// Normalize a month value to "YYYY-MM".
//  - "YYYY-MM" (year given) is respected as-is.
//  - A bare month ("January", "jan", "01", "1") with NO year is mapped to the
//    NEXT occurrence of that month from `now`: this year if it has not passed,
//    otherwise next year. (Per Base Camp rule: month without year => next instance.)
// Returns null for anything unparseable.
function normalizeMonth(raw, now = new Date()) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // Explicit year supplied, e.g. "2027-01" or "2027/1" -> respect it.
  const ym = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (ym) {
    const mo = Math.min(12, Math.max(1, parseInt(ym[2], 10)));
    return `${ym[1]}-${String(mo).padStart(2, "0")}`;
  }

  // Bare month: a name, or a 1-2 digit number with no year.
  let mo = MONTH_NAMES[s];
  if (!mo) {
    const n = s.match(/^(\d{1,2})$/);
    if (n) {
      const v = parseInt(n[1], 10);
      if (v >= 1 && v <= 12) mo = v;
    }
  }
  if (!mo) return null;

  const curY = now.getFullYear();
  const curM = now.getMonth() + 1; // 1..12
  const year = mo >= curM ? curY : curY + 1; // next instance of that month
  return `${year}-${String(mo).padStart(2, "0")}`;
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

// cruise | jet | yacht -> each type's own Atlas query API, same shape as hotels.
// Degrades gracefully if an endpoint is unreachable so the Guide routes to an
// advisor instead of inventing inventory.
async function searchOfferingsByType(type, input, fetchImpl) {
  const limit = clampLimit(input.limit, 6);
  const cfg = OFFERINGS_ENDPOINTS[type];
  const p = new URLSearchParams();
  if (input.q) p.set("q", String(input.q).trim());
  if (input.region) p.set("region", String(input.region).trim());
  if (input.country) p.set("country", String(input.country).trim());
  if (input.month) {
    // Month without a year => next instance of that month (Base Camp rule).
    const m = normalizeMonth(input.month);
    if (m) p.set("month", m);
  }
  p.set("limit", String(limit));

  const url = `${cfg.base}${cfg.path}?${p.toString()}`;
  try {
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error(`${type} api ${r.status}`);
    const j = await r.json();
    const results = j.results || [];
    return {
      type,
      total: j.total ?? results.length,
      count: results.length,
      results,
      deepLink: j.deepLink || cfg.base,
      chartRegion: chartRegionFrom(input.region, results),
    };
  } catch (err) {
    // Endpoint unreachable: tell the Guide so it can route to an advisor.
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

export { chartRegionFrom, clampLimit, normalizeMonth, MARQUEE_KEYS, HOTEL_API_BASE };

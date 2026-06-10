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
const DEFAULT_RECOMMENDATION_LIMIT = 3;
const MAX_RECOMMENDATION_LIMIT = 24;

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
    "Search Aspen Travel Advisors inventory: luxury hotels, Expedition Cruise journeys, " +
    "private jet journeys, and brand-yacht sailings. Use whenever a traveler " +
    "names a place, brand, season, or trip type. Type cruise intentionally " +
    "searches both Expedition Cruise journeys and hotel-brand yachts.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["hotel", "cruise", "jet", "yacht", "any"],
        description:
          "Use cruise for broad cruise/cruises language; it searches both Expedition Cruise journeys and hotel-brand yachts.",
      },
      q: {
        type: "string",
        description:
          "Free-text descriptors ONLY, e.g. 'overwater villa', 'ski-in', 'northern lights'. " +
          "Never put a brand, country, or region here. Use brand/country/region for those.",
      },
      intent: {
        type: "string",
        enum: ["honeymoon", "family", "celebration", "business", "active", "uhnw", "simpleVip"],
        description:
          "Hotel fit intent when clear: honeymoon, family, celebration, business, active, uhnw, or simpleVip.",
      },
      region: {
        type: "string",
        description:
          "Marquee region key, one of: antarctica, arctic, galapagos, amazon, polynesia, " +
          "patagonia, kimberley, mediterranean, norway, japan, namibia. Use when the trip clearly maps to one.",
      },
      place: {
        type: "string",
        description:
          "Specific destination place, city, town, island, resort area, or neighborhood, " +
          "e.g. Aspen, Paris, Kyoto, Maui, Beverly Hills. Use this whenever the traveler names a place.",
      },
      brand: {
        type: "string",
        description:
          "Hotel brand, Expedition Cruise operator, or yacht brand, e.g. Aman, Four Seasons, Rosewood, Seabourn, Ritz-Carlton.",
      },
      country: { type: "string", description: "Country name, e.g. Japan, Italy, France." },
      month: {
        type: "string",
        description:
          "Travel month. Prefer YYYY-MM. If the traveler names a month with no year, " +
          "a bare month name (e.g. 'January') is fine; it is resolved to the next " +
          "occurrence of that month.",
      },
      limit: {
        type: "integer",
        default: DEFAULT_RECOMMENDATION_LIMIT,
        description: "Number of records to return. Curate around 3 by default; use more when the request calls for it. Max 24.",
      },
      world: {
        type: "boolean",
        description:
          "Private jet only. True when the traveler asks for Around the World, ATW, circumnavigation, seven-continent, or global private jet journeys.",
      },
    },
  },
};

function clampLimit(raw, fallback = DEFAULT_RECOMMENDATION_LIMIT) {
  let n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) n = fallback;
  if (n > MAX_RECOMMENDATION_LIMIT) n = MAX_RECOMMENDATION_LIMIT; // flexible, but still prevent accidental list dumps
  return n;
}

function requestedLimit(input = {}) {
  return clampLimit(input.limit, DEFAULT_RECOMMENDATION_LIMIT);
}

function candidateLimitForInput(input = {}, displayLimit = requestedLimit(input)) {
  const hasBrandConstraint = !!String(input.brand || input.operator || "").trim();
  if (hasBrandConstraint) return displayLimit;
  return displayLimit <= DEFAULT_RECOMMENDATION_LIMIT ? MAX_RECOMMENDATION_LIMIT : displayLimit;
}

// Month names -> 1..12 (full + common 3-letter abbreviations).
const MONTH_NAMES = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_WORD_RE =
  "(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)";

// Normalize a month value to "YYYY-MM".
//  - "YYYY-MM", "YYYY/MM", "August 2026", and "2026 August" respect the year.
//  - A bare month ("January", "jan", "01", "1") with NO year is mapped to the
//    NEXT occurrence of that month from `now`: this year if it has not passed,
//    otherwise next year. (Per Base Camp rule: month without year => next instance.)
// Returns null for anything unparseable.
function normalizeMonth(raw, now = new Date()) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/\./g, "");
  if (!s) return null;

  // Explicit year supplied, e.g. "2027-01" or "2027/1" -> respect it.
  const ym = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (ym) {
    const mo = Math.min(12, Math.max(1, parseInt(ym[2], 10)));
    return `${ym[1]}-${String(mo).padStart(2, "0")}`;
  }

  const monthYear = s.match(new RegExp(`^${MONTH_WORD_RE}\\s+(\\d{4})$`));
  if (monthYear) {
    const mo = MONTH_NAMES[monthYear[1]];
    return `${monthYear[2]}-${String(mo).padStart(2, "0")}`;
  }
  const yearMonth = s.match(new RegExp(`^(\\d{4})\\s+${MONTH_WORD_RE}$`));
  if (yearMonth) {
    const mo = MONTH_NAMES[yearMonth[2]];
    return `${yearMonth[1]}-${String(mo).padStart(2, "0")}`;
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

function monthFromText(raw, now = new Date()) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/\./g, "");
  if (!s) return null;

  const direct = normalizeMonth(s, now);
  if (direct) return direct;

  const numeric = s.match(/\b(\d{4})[-/](\d{1,2})\b/);
  if (numeric) return normalizeMonth(numeric[0], now);

  const monthYear = s.match(new RegExp(`\\b${MONTH_WORD_RE}\\s+(\\d{4})\\b`));
  if (monthYear) return normalizeMonth(`${monthYear[1]} ${monthYear[2]}`, now);

  const yearMonth = s.match(new RegExp(`\\b(\\d{4})\\s+${MONTH_WORD_RE}\\b`));
  if (yearMonth) return normalizeMonth(`${yearMonth[1]} ${yearMonth[2]}`, now);

  const bareMonth = s.match(new RegExp(`\\b${MONTH_WORD_RE}\\b`));
  return bareMonth ? normalizeMonth(bareMonth[1], now) : null;
}

function stripDateFromQuery(raw) {
  if (raw == null) return "";
  return String(raw)
    .replace(new RegExp(`\\b${MONTH_WORD_RE}\\s+\\d{4}\\b`, "ig"), " ")
    .replace(new RegExp(`\\b\\d{4}\\s+${MONTH_WORD_RE}\\b`, "ig"), " ")
    .replace(/\b\d{4}[-/]\d{1,2}\b/g, " ")
    .replace(new RegExp(`\\b${MONTH_WORD_RE}\\b`, "ig"), " ")
    .replace(/(?<!-)\b(what|whats|which|show|find|looking|recommend|recommends|recommendation|recommendations|me|i|we|want|need|please|most|best|nicest|finest|top|good|great|better|in|for|during|around|the|a|an|hotel|hotels|resort|resorts|property|properties|stay|stays|luxury|luxurious|vip|virtuoso)\b(?!-)/ig, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AROUND_THE_WORLD_JET_RE =
  /\b(around\s+the\s+world|round\s+the\s+world|atw|circumnavigation|circumnavigate|circumnavigating|seven\s+continents|global\s+(journey|journeys|itinerary|itineraries|expedition|expeditions)|world\s+by\s+private\s+jet|world\s+private\s+jet|private\s+jet\s+world|grand\s+horizons|international\s+intrigue|new\s+world\s+icons|grandest\s+tour|timeless\s+encounters|golf\s+around\s+the\s+world|wild\s+wonders|hidden\s+horizons|photographing\s+the\s+world|world\s+less\s+traveled)\b/i;
const GENERIC_AROUND_THE_WORLD_JET_RE =
  /\b(around\s+the\s+world|round\s+the\s+world|atw|circumnavigation|circumnavigate|circumnavigating|seven\s+continents|global\s+(journey|journeys|itinerary|itineraries|expedition|expeditions)|world\s+by\s+private\s+jet|world\s+private\s+jet|private\s+jet\s+world)\b/i;

function aroundTheWorldJetIntent(input = {}) {
  if (input.world === true || String(input.world || "").toLowerCase() === "true") return true;
  const hay = [
    input.q,
    input.place,
    input.region,
    input.country,
    input.brand,
    input.operator,
  ].filter(Boolean).join(" ");
  return AROUND_THE_WORLD_JET_RE.test(hay);
}

function stripAroundTheWorldJetTerms(raw) {
  return String(raw || "")
    .replace(GENERIC_AROUND_THE_WORLD_JET_RE, " ")
    .replace(/\b(private|jet|jets|journey|journeys|itinerary|itineraries|expedition|expeditions|tour|tours|trip|trips|global|luxury)\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoosePlace(raw) {
  const cleaned = stripDateFromQuery(raw)
    .replace(/\b(near|outside|within|close|to|at|by|and|or)\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "";
}

function hotelQueryForInput(input) {
  const place = normalizeLoosePlace(input.place);
  const descriptor = stripDateFromQuery(input.q);
  const parts = [];
  if (place) parts.push(place);
  if (descriptor && (!place || !descriptor.toLowerCase().includes(place.toLowerCase()))) {
    parts.push(descriptor);
  }
  return { place, q: parts.join(" ").trim(), descriptor };
}

function firstPriorityBenefit(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text || /^["']?first priority["']?\b/i.test(text)) return text;
  if (/^room upgrade\b/i.test(text)) return `"First Priority" ${text}`;
  if (/^upgrade\b/i.test(text)) return `"First Priority" ${text}`;
  return text;
}

function normalizedYachtBrand(raw) {
  const v = String(raw || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!v) return "";
  if (/\britz\b/.test(v) && /\bcarlton\b/.test(v)) return "Ritz-Carlton Yacht Collection";
  if (/\bfour\b/.test(v) && /\bseasons\b/.test(v)) return "Four Seasons Yachts";
  if (/\borient\b/.test(v) && /\bexpress\b/.test(v)) return "Orient Express Sailing Yachts";
  if (/\baman\b/.test(v)) return "Aman at Sea";
  return "";
}

function normalizeBrandKey(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resultBrandKey(item = {}, fallbackType = "") {
  const type = item.type || fallbackType;
  const value = type === "hotel"
    ? item.brand
    : (item.brand || item.operator);
  // Independents (most of the hotel inventory) are each their own "brand";
  // collapsing them under one unbranded key would demote every independent
  // after the first behind lower-ranked chain properties.
  return normalizeBrandKey(value) || normalizeBrandKey(item.name) || "unbranded";
}

function resultIdentity(item = {}) {
  return item.id || `${item.type || ""}:${item.name || ""}:${item.startDate || ""}:${item.month || ""}`;
}

function brandDiverseResults(candidates = [], displayLimit = DEFAULT_RECOMMENDATION_LIMIT, fallbackType = "") {
  const firstByBrand = [];
  const duplicates = [];
  const seenBrand = new Set();
  const seenItem = new Set();
  for (const item of candidates) {
    const itemKey = resultIdentity(item);
    if (seenItem.has(itemKey)) continue;
    seenItem.add(itemKey);
    const brandKey = resultBrandKey(item, fallbackType);
    if (!seenBrand.has(brandKey)) {
      seenBrand.add(brandKey);
      firstByBrand.push(item);
    } else {
      duplicates.push(item);
    }
  }
  // Honor the display limit: candidates are overfetched for diversity, not so
  // a "curate three" request can balloon into a two-dozen-row dump.
  const target = Math.min(candidates.length, displayLimit);
  return firstByBrand.concat(duplicates).slice(0, target);
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
    lat: h.lat,
    lng: h.lng,
    fit: h.fit ? {
      bestFit: h.fit.bestFit,
      intentTags: h.fit.intentTags || [],
      serviceStyle: h.fit.serviceStyle,
      atmosphere: h.fit.atmosphere,
      confidence: h.fit.confidence,
      overallFitScore: h.fit.overallFitScore,
      matchScores: h.fit.matchScores || {},
      criteriaScores: h.fit.criteriaScores || {},
      evaluationNotes: h.fit.evaluationNotes,
      description: h.fit.description,
      searchKeywords: (h.fit.searchKeywords || []).slice(0, 5),
    } : null,
    vipUpgrades: (h.vipUpgrades || []).map(firstPriorityBenefit),
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

function deepLinkWithResultIds(deepLink, results = []) {
  if (!deepLink) return null;
  const ids = results.map((r) => r && r.id).filter(Boolean);
  if (!ids.length) return deepLink;
  try {
    const u = new URL(deepLink);
    u.searchParams.set("ids", ids.join(","));
    return u.toString();
  } catch {
    const sep = deepLink.includes("?") ? "&" : "?";
    return `${deepLink}${sep}ids=${encodeURIComponent(ids.join(","))}`;
  }
}

// ── Cross-channel related offerings ─────────────────────────────────────────
// A hotel request is often one channel of a bigger trip: Four Seasons in Italy
// also means Four Seasons Yachts calling at Italian ports; a Norway hotel ask
// sits next to real fjord expedition departures. These helpers fetch a small
// sidecar of REAL inventory from the other atlases so the Guide can mention it
// naturally. Failures never break the primary search: related is best-effort.

const YACHT_CAPABLE_HOTEL_BRAND_RE = /\b(four\s*seasons|ritz[\s-]*carlton|aman|orient[\s-]*express|belmond)\b/i;

function relatedEntry(kind, reason, payload) {
  const results = ((payload && payload.results) || []).slice(0, 1);
  if (!results.length) return null;
  return {
    kind,
    reason,
    total: payload.total || results.length,
    count: results.length,
    results,
    deepLink: payload.deepLink || null,
  };
}

function relatedRegionFromInput(input = {}) {
  return [input.region, input.country, input.place]
    .map((v) => String(v || "").toLowerCase().trim())
    .find((v) => MARQUEE_KEYS.has(v)) || null;
}

// Yacht sailings that share the hotel search's brand and/or geography.
async function relatedYachtsForHotels(input, fetchImpl, month) {
  const brand = String(input.brand || "").trim();
  const yachtBrand = normalizedYachtBrand(brand);
  const geo = String(input.country || input.place || "").trim();
  const isYachtBrand = !!yachtBrand || YACHT_CAPABLE_HOTEL_BRAND_RE.test(brand);
  // Only worth a call when there is a yacht-capable brand or real geography.
  if (!isYachtBrand && !geo && !input.region) return null;
  if (brand && !isYachtBrand) return null; // brand named, but it has no yachts

  // Hotel descriptors ("ski-in", "overwater villa") would zero out sailings,
  // so the sidecar matches on brand + geography + month only.
  const sub = {
    region: input.region,
    country: input.country || (geo || undefined),
    brand: yachtBrand || brand,
    month: month || input.month,
  };
  const r = await searchOfferingsByType("yacht", sub, fetchImpl, 1);
  if (!r || r.unavailable || !r.count) return null;
  const who = yachtBrand || "Hotel-brand yacht";
  const where = geo || input.region;
  return relatedEntry(
    "yacht",
    where
      ? `${who} sailings calling at ${where} ports around the requested timing.`
      : `${who} sailings, the sea side of the same brand.`,
    r
  );
}

// Expedition cruises for hotel searches that land in a marquee expedition
// region (norway, japan, galapagos, patagonia, ...).
async function relatedCruisesForHotels(input, fetchImpl, month) {
  if (String(input.brand || "").trim()) return null; // brand asks stay on-brand
  const region = relatedRegionFromInput(input);
  if (!region) return null;
  const r = await searchOfferingsByType(
    "cruise",
    { region, month: month || input.month },
    fetchImpl,
    1
  );
  if (!r || r.unavailable || !r.count) return null;
  return relatedEntry(
    "cruise",
    `Expedition Cruise departures in ${region} for travelers weighing land versus sea.`,
    r
  );
}

// Private jet journeys in the same marquee area as a hotel search.
async function relatedJetsForHotels(input, fetchImpl, month) {
  if (String(input.brand || "").trim()) return null; // brand asks stay on-brand
  const region = relatedRegionFromInput(input);
  if (!region) return null;
  const r = await searchOfferingsByType(
    "jet",
    { region, month: month || input.month },
    fetchImpl,
    1
  );
  if (!r || r.unavailable || !r.count) return null;
  return relatedEntry(
    "jet",
    `Private jet journeys touching ${region} for travelers weighing a broader hosted itinerary.`,
    r
  );
}

// Pre/post hotel stays near a sailing's embarkation city, for yacht results.
async function relatedHotelsForSailing(leadSailing, fetchImpl) {
  const city = String((leadSailing && leadSailing.from) || "").split(",")[0]
    .replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!city) return null;
  try {
    const p = new URLSearchParams();
    p.set("q", city);
    p.set("limit", "3");
    const r = await fetchImpl(`${HOTEL_API_BASE}/api/luxury-hotels?${p.toString()}`);
    if (!r.ok) return null;
    const j = await r.json();
    const results = (j.results || []).slice(0, 3).map(hotelCard);
    return relatedEntry(
      "hotel",
      `Approved stays in ${city} for nights before or after embarkation.`,
      { total: j.total, results, deepLink: j.deepLink || null }
    );
  } catch {
    return null;
  }
}

async function searchHotels(input, fetchImpl) {
  const limit = requestedLimit(input);
  const candidateLimit = candidateLimitForInput(input, limit);
  const month = normalizeMonth(input.month) || monthFromText(input.q);
  const { place, q, descriptor } = hotelQueryForInput(input);

  const fetchHotelQuery = async (queryText, { dropPlace = false } = {}) => {
    const p = new URLSearchParams();
    if (queryText) p.set("q", queryText);
    if (input.region) p.set("region", String(input.region).trim());
    if (input.brand) p.set("brand", String(input.brand).trim());
    if (input.country) p.set("country", String(input.country).trim());
    if (input.intent) p.set("intent", String(input.intent).trim());
    if (month) p.set("month", month);
    p.set("limit", String(candidateLimit));

    const url = `${HOTEL_API_BASE}/api/luxury-hotels?${p.toString()}`;
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error(`hotel api ${r.status}`);
    return r.json();
  };

  // Cross-channel sidecars run alongside the hotel query so they cost no
  // extra latency; each resolves to null on any miss or failure.
  const relatedPromises = [
    relatedYachtsForHotels(input, fetchImpl, month).catch(() => null),
    relatedCruisesForHotels(input, fetchImpl, month).catch(() => null),
    relatedJetsForHotels(input, fetchImpl, month).catch(() => null),
  ];

  // Fallback chain: place + descriptors -> place only -> country/region only.
  // Each step loosens the over-filtering constraint most likely to have zeroed
  // the match set, so a misspelled or unindexed place still lands somewhere
  // real instead of returning nothing.
  let j = await fetchHotelQuery(q);
  if (place && descriptor && !(j.results || []).length) {
    j = await fetchHotelQuery(place);
  }
  if (!(j.results || []).length && q && (input.country || input.region)) {
    j = await fetchHotelQuery("");
  }
  const candidates = (j.results || []).map(hotelCard);
  const results = brandDiverseResults(candidates, limit, "hotel");
  const related = (await Promise.all(relatedPromises)).filter(Boolean);

  return {
    type: "hotel",
    total: j.total ?? results.length,   // honest unpaginated count for the Guide
    count: results.length,
    results,
    deepLink: deepLinkWithResultIds(j.deepLink || null, results),
    chartRegion: chartRegionFrom(input.region, j.results || []),
    ...(related.length ? { related } : {}),
  };
}

// cruise | jet | yacht -> each type's own Atlas query API, same shape as hotels.
// Degrades gracefully if an endpoint is unreachable so the Guide routes to an
// advisor instead of inventing inventory.
async function searchOfferingsByType(type, input, fetchImpl, limitOverride = null) {
  const atwJet = type === "jet" && aroundTheWorldJetIntent(input);
  const limit = limitOverride == null
    ? (atwJet ? clampLimit(input.limit, 18) : requestedLimit(input))
    : clampLimit(limitOverride);
  const candidateLimit = candidateLimitForInput(input, limit);
  const cfg = OFFERINGS_ENDPOINTS[type];
  const p = new URLSearchParams();
  const month = normalizeMonth(input.month) || monthFromText(input.q);
  const q = atwJet ? stripAroundTheWorldJetTerms(stripDateFromQuery(input.q)) : stripDateFromQuery(input.q);
  const brand = String(input.brand || input.operator || "").trim();
  let queryText = q;
  if (atwJet) {
    p.set("world", "true");
  } else {
    if (input.region) p.set("region", String(input.region).trim());
    if (input.country) p.set("country", String(input.country).trim());
  }
  if (type === "cruise" && brand) p.set("operator", brand);
  if (type === "jet" && brand) p.set("brand", brand);
  if (type === "yacht" && brand) {
    const yachtBrand = normalizedYachtBrand(brand);
    if (yachtBrand) p.set("brand", yachtBrand);
    else queryText = [brand, queryText].filter(Boolean).join(" ");
  }
  if (queryText) p.set("q", queryText);
  // Month without a year => next instance of that month (Base Camp rule).
  if (month) p.set("month", month);
  p.set("limit", String(candidateLimit));

  const url = `${cfg.base}${cfg.path}?${p.toString()}`;
  try {
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error(`${type} api ${r.status}`);
    const j = await r.json();
    const candidates = j.results || [];
    const results = brandDiverseResults(candidates, limit, type);
    return {
      type,
      total: j.total ?? results.length,
      count: results.length,
      results,
      deepLink: deepLinkWithResultIds(j.deepLink || cfg.base, results),
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

function interleaveResults(groups, limit) {
  const candidates = [];
  const seen = new Set();
  let idx = 0;
  while (true) {
    let added = false;
    for (const group of groups) {
      const item = group[idx];
      if (!item) continue;
      const key = resultIdentity(item);
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(item);
        added = true;
      }
    }
    if (!added) break;
    idx++;
  }
  return brandDiverseResults(candidates, limit, "cruise");
}

async function searchCruisesAndYachts(input, fetchImpl) {
  const limit = requestedLimit(input);
  const [cruise, yacht] = await Promise.all([
    searchOfferingsByType("cruise", input, fetchImpl, limit),
    searchOfferingsByType("yacht", input, fetchImpl, limit),
  ]);
  const results = interleaveResults([cruise.results || [], yacht.results || []], limit);
  const sources = [cruise, yacht].map((r) => ({
    type: r.type,
    total: r.total || 0,
    count: r.count || 0,
    deepLink: r.deepLink || null,
    unavailable: !!r.unavailable,
  }));
  const firstSourceWithResults = [cruise, yacht].find((r) => r.count > 0);
  const unavailable = sources.every((s) => s.unavailable);
  const related = await sailingRelatedHotels(results, fetchImpl);

  return {
    type: "cruise",
    total: sources.reduce((n, s) => n + (s.total || 0), 0),
    count: results.length,
    results,
    deepLink: firstSourceWithResults ? firstSourceWithResults.deepLink : null,
    chartRegion: chartRegionFrom(input.region, results),
    sources,
    unavailable,
    note: unavailable
      ? "Expedition Cruise and yacht inventory is momentarily unreachable. An advisor can source live options directly."
      : null,
    ...(related.length ? { related } : {}),
  };
}

// Pre/post hotel sidecar for any result set that contains a sailing with a
// known embarkation city (yacht records carry `from`; expedition cruises
// usually do not).
async function sailingRelatedHotels(results = [], fetchImpl) {
  const lead = results.find((r) => r && r.from);
  if (!lead) return [];
  const entry = await relatedHotelsForSailing(lead, fetchImpl).catch(() => null);
  return entry ? [entry] : [];
}

// Main entry. `input` is the validated tool input from the model.
export async function searchOfferings(input = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const type = String(input.type || "any").toLowerCase();

  if (type === "hotel" || type === "any") {
    return searchHotels(input, fetchImpl);
  }
  if (type === "cruise") {
    return searchCruisesAndYachts(input, fetchImpl);
  }
  if (type === "yacht") {
    const r = await searchOfferingsByType(type, input, fetchImpl);
    const related = await sailingRelatedHotels(r.results, fetchImpl);
    return related.length ? { ...r, related } : r;
  }
  if (type === "jet") {
    return searchOfferingsByType(type, input, fetchImpl);
  }
  // Unknown type -> treat as hotel search rather than erroring.
  return searchHotels(input, fetchImpl);
}

const BROAD_PLACE_WORDS = new Set([
  "us", "u s", "usa", "u s a", "united states", "america", "canada", "mexico",
  "italy", "france", "japan", "greece", "spain", "portugal", "england",
  "united kingdom", "uk", "u k", "australia", "new zealand",
]);

function extractMentionedPlace(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const m = s.match(/\b(?:in|near|around|outside|within|close to|at|by)\s+([a-z][a-z\s.'-]{1,70}?)(?=\s+(?:for|with|during|in|around|next|this|from|and|or)\b|[?.!,;:]|$)/i);
  if (!m) return "";
  const place = normalizeLoosePlace(m[1]).toLowerCase();
  if (!place || BROAD_PLACE_WORDS.has(place) || MONTH_NAMES[place]) return "";
  if (place.split(/\s+/).length > 5) return "";
  return place
    .split(/\s+/)
    .map((word) => word ? word[0].toUpperCase() + word.slice(1) : word)
    .join(" ");
}

// Trip-reason words -> hotel fit intent, used when the model leaves intent
// unset. The fit data ranks on these, so recovering an obvious one from the
// traveler's own words materially reorders the shortlist.
const INTENT_HINTS = [
  [/\b(honeymoon|honeymooners|newlywed|newlyweds|just\s+married|minimoon)\b/i, "honeymoon"],
  [/\b(anniversary|birthday|babymoon|proposal|propose|engagement|graduation|retirement|milestone|celebrate|celebrating|celebration)\b/i, "celebration"],
  [/\b(family|families|kids?|children|toddlers?|teens?|teenagers?|multigen(?:erational)?|grandparents|grandkids)\b/i, "family"],
  [/\b(business|work\s+trip|conference|offsite|meetings)\b/i, "business"],
  [/\b(ski(?:ing)?|hik(?:e|es|ing)|trek(?:king)?|safari|div(?:e|ing)|surf(?:ing)?|golf(?:ing)?|expedition|adventure|active)\b/i, "active"],
];

function inferIntentFromText(text) {
  const s = String(text || "");
  if (!s) return null;
  for (const [re, intent] of INTENT_HINTS) {
    if (re.test(s)) return intent;
  }
  return null;
}

function prioritizeMentionedPlace(input = {}, latestUserText = "") {
  const type = String(input.type || "any").toLowerCase();
  const text = String(latestUserText || "");
  const hasHotelIntent = /\b(hotel|hotels|resort|resorts|property|properties|stay|stays)\b/i.test(text);
  const hasCruiseIntent = /\b(cruise|cruises)\b/i.test(text);
  const hasYachtIntent = /\b(yacht|yachts)\b/i.test(text);

  if (!hasHotelIntent && (type === "hotel" || type === "any")) {
    if (hasCruiseIntent) return { ...input, type: "cruise" };
    if (hasYachtIntent) return { ...input, type: "yacht" };
  }

  if (type !== "hotel" && type !== "any") return input;
  let out = input;
  if (!out.place) {
    const place = extractMentionedPlace(latestUserText);
    if (place) out = { ...out, place };
  }
  if (!out.intent) {
    const intent = inferIntentFromText(`${text} ${input.q || ""}`);
    if (intent) out = { ...out, intent };
  }
  return out;
}

export {
  chartRegionFrom,
  clampLimit,
  normalizeMonth,
  MARQUEE_KEYS,
  HOTEL_API_BASE,
  prioritizeMentionedPlace,
};

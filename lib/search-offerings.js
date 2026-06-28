// lib/search-offerings.js — Base Camp T6
// The single tool the Guide calls. Maps a natural-language intent (already
// parsed by the model into params) onto the live Base Camp data layer, returns
// REAL inventory plus the prebuilt Atlas deep link and a marquee region key for
// the [[CHART: region]] control. No model-knowledge invention; no final pricing.
//
// Inventory is the shared source of truth behind /api (SPEC architecture rule).
// Each type is served by its own Atlas repo's query API, identical in contract
// to the Hotel Atlas /api/luxury-hotels: { total, count, results, deepLink }.
// The Guide queries each atlas the same way over HTTP.

const HOTEL_API_BASE =
  process.env.HOTEL_ATLAS_API_BASE || "https://luxury-hotel-atlas-two.vercel.app";
const DEFAULT_RECOMMENDATION_LIMIT = 3;
const MAX_RESULTS_PER_CATEGORY = 4;
const MAX_CANDIDATE_LIMIT = 24;
// Open (no-brand) cruise/yacht/jet searches surface ONE sailing per operator and
// must cover every operator in the region/month, not crop to the small hotel-style
// shortlist — a region with 4-5 expedition lines should return all of them. This
// caps that supplier sweep so a busy category can't run away.
const MAX_SUPPLIERS_PER_CATEGORY = 8;

// Upstream atlas calls must never hang the Guide's serverless function. A stalled
// atlas (slow cold start, network black hole) would otherwise block until Vercel's
// maxDuration kills the whole SSE stream — which the browser surfaces as an opaque
// "Load failed". A bounded fetch turns a hang into a normal rejection, which every
// search path below already degrades into a graceful "unavailable" result so the
// Guide routes to an advisor instead of dying mid-reply.
const ATLAS_FETCH_TIMEOUT_MS = Number(process.env.ATLAS_FETCH_TIMEOUT_MS) || 12000;

async function fetchWithTimeout(url, init = {}, timeoutMs = ATLAS_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
  worldcruise: {
    base: process.env.WORLD_CRUISE_ATLAS_API_BASE || "https://world-cruise-atlas.vercel.app",
    path: "/api/world-cruises",
  },
};

// Marquee region keys the Living Atlas can plot (CLAUDE.md / SPEC §3).
// alaska and caribbean join the eleven classic keys as marquee regions;
// "northwest passage" is a pillar of expedition cruising in its own right.
const MARQUEE_KEYS = new Set([
  "antarctica", "arctic", "galapagos", "amazon", "polynesia",
  "patagonia", "kimberley", "mediterranean", "norway", "japan", "namibia",
  "alaska", "caribbean", "northwest passage",
]);

// alaska and caribbean are the two newest marquee regions, and not every atlas
// backend filters them yet. EXTENDED_REGION_NATIVE records which atlases filter
// each on the backend: the eleven classic keys are filtered everywhere, but for
// these two we only send a region= param to an atlas that understands it. Where
// it is not yet supported, the region is bound as free text so it still
// constrains the search instead of being silently dropped (which would broaden
// it). Flip a flag to true the moment that atlas's backend ships the filter.
const EXTENDED_MARQUEE_KEYS = new Set(["alaska", "caribbean", "northwest passage"]);
const EXTENDED_REGION_NATIVE = {
  hotel:       { alaska: false, caribbean: true,  "northwest passage": false },
  worldcruise: { alaska: true,  caribbean: true,  "northwest passage": false },
  cruise:      { alaska: false, caribbean: false, "northwest passage": false },
  jet:         { alaska: false, caribbean: false, "northwest passage": false },
  yacht:       { alaska: false, caribbean: false, "northwest passage": false },
};
// Marquee keys that are also real countries the atlases filter via country=, so
// a "country" value naming one must not be rerouted to the region filter.
const MARQUEE_COUNTRIES = new Set(["japan", "norway", "namibia"]);

// True when `type`'s backend can filter `key` via the region= param.
function atlasFiltersRegion(type, key) {
  if (!key) return false;
  if (!EXTENDED_MARQUEE_KEYS.has(key)) return true;
  const t = EXTENDED_REGION_NATIVE[type];
  return !!(t && t[key]);
}
// Luxury Cruise advisor routing: unambiguous brand phrases route on sight;
// bare words like "regent", "crystal", or "oceania" also name hotels, lagoons,
// and a continent, so they only route when the ask is actually about cruising.
const STRONG_LUXURY_CRUISE_RE =
  /\b(regent\s+seven\s+seas|seven\s+seas\s+(?:explorer|splendor|grandeur|mariner|navigator|voyager)|crystal\s+(?:cruises?|serenity|symphony)|oceania\s+cruises?|explora\s+journeys?|cunard)\b/i;
const AMBIGUOUS_LUXURY_CRUISE_BRAND_RE =
  /\b(regent|crystal|oceania|explora|queen\s+(?:mary\s*2?|elizabeth|anne|victoria))\b/i;
const CRUISE_CONTEXT_RE =
  /\b(cruis(?:e|es|ing)|sailing|sailings|voyage|voyages|ship|ships|liner|liners)\b/i;
const GENERIC_LUXURY_CRUISE_RE =
  /\b(luxury\s+(?:ocean\s+)?cruis(?:e|es|ing)|ocean\s+cruis(?:e|es|ing))\b/i;
const CURRENT_CRUISE_INVENTORY_RE =
  /\b(expedition|expeditions|ritz[\s-]*carlton|four\s+seasons|aman|orient[\s-]*express|yacht|yachts)\b/i;

// World cruises and grand voyages ARE live inventory (the World Cruise Atlas),
// even for lines that are otherwise advisor-led Luxury Cruise brands. Strong
// phrases route on sight; bare around-the-world language needs cruise context
// so it never hijacks the private-jet ATW category.
const STRONG_WORLD_CRUISE_RE =
  /\b(world\s+cruises?|world\s+voyages?|grand\s+voyages?|grand\s+world\s+voyages?|full\s+world|world\s+by\s+sea|around\s+the\s+world\s+(?:by\s+(?:sea|ship)|cruises?|sailings?|voyages?)|round\s+the\s+world\s+(?:cruises?|sailings?|voyages?)|circumnavigations?\s+(?:cruises?|by\s+sea|voyages?)|world\s+cruise\s+segments?)\b/i;
const GENERIC_GLOBAL_VOYAGE_RE =
  /\b(around\s+the\s+world|round\s+the\s+world|atw|circumnavigat\w+|seven\s+continents)\b/i;

const foldDiacritics = (s) =>
  String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// ── alias normalization ─────────────────────────────────────────────────────
// The atlas APIs filter brand/operator/country by exact (case-insensitive)
// equality, while travelers write "UK", "St Lucia", "Ponant", or "A&K". These
// maps translate the common shorthand into the values the data actually holds
// before any HTTP call, so a well-formed ask never zeroes out on spelling.

// Aliases -> the country spelling in the hotel inventory.
const COUNTRY_ALIASES = {
  "uk": "United Kingdom",
  "u k": "United Kingdom",
  "great britain": "United Kingdom",
  "britain": "United Kingdom",
  "england": "United Kingdom",
  "us": "United States",
  "u s": "United States",
  "usa": "United States",
  "u s a": "United States",
  "america": "United States",
  "united states of america": "United States",
  "states": "United States",
  "uae": "United Arab Emirates",
  "u a e": "United Arab Emirates",
  "emirates": "United Arab Emirates",
  "bvi": "British Virgin Islands",
  "usvi": "U.S. Virgin Islands",
  "us virgin islands": "U.S. Virgin Islands",
  "u s virgin islands": "U.S. Virgin Islands",
  "holland": "Netherlands",
  "netherlands": "Netherlands",
  "czechia": "Czech Republic",
  "korea": "South Korea",
  "tahiti": "French Polynesia",
  "bora bora": "French Polynesia",
  "saint barts": "Saint Barthélemy",
  "saint barths": "Saint Barthélemy",
  "saint barth": "Saint Barthélemy",
  "saint barthelemy": "Saint Barthélemy",
  "curacao": "Curacao",
  "turks and caicos": "Turks and Caicos",
};

function normalizeCountry(raw) {
  const original = String(raw || "").trim();
  if (!original) return "";
  const key = foldDiacritics(original.toLowerCase())
    .replace(/\./g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "")
    .replace(/^st\s+/, "saint ");
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  // The atlas compares case-insensitively, so the transformed form ("saint
  // lucia", "turks and caicos") is safe to send whenever it differs.
  return key === original.toLowerCase() ? original : key;
}

function countryAliasKey(raw) {
  return foldDiacritics(String(raw || "").toLowerCase())
    .replace(/\./g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "")
    .replace(/^st\s+/, "saint ");
}

function countryFromPlaceAlias(raw) {
  const key = countryAliasKey(raw);
  if (!key) return "";
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  if (["saint lucia", "turks and caicos", "turks and caicos islands"].includes(key)) {
    return normalizeCountry(raw);
  }
  return "";
}

// Near-marquee phrasing -> the marquee key the atlases plot.
const REGION_ALIASES = {
  "med": "mediterranean",
  "the med": "mediterranean",
  "mediterranean sea": "mediterranean",
  "antarctic": "antarctica",
  "the antarctic": "antarctica",
  "antarctic peninsula": "antarctica",
  "the arctic": "arctic",
  "arctic circle": "arctic",
  "high arctic": "arctic",
  "svalbard": "arctic",
  "the northwest passage": "northwest passage",
  "north west passage": "northwest passage",
  "nw passage": "northwest passage",
  "northwest passage crossing": "northwest passage",
  "the galapagos": "galapagos",
  "galapagos islands": "galapagos",
  "the galapagos islands": "galapagos",
  "the amazon": "amazon",
  "amazonia": "amazon",
  "amazon river": "amazon",
  "french polynesia": "polynesia",
  "tahiti": "polynesia",
  "bora bora": "polynesia",
  "society islands": "polynesia",
  "the kimberley": "kimberley",
  "kimberly": "kimberley",
  "the kimberly": "kimberley",
  "norwegian fjords": "norway",
  "norway fjords": "norway",
  "the fjords": "norway",
  "fjords": "norway",
  "the caribbean": "caribbean",
  "caribbean sea": "caribbean",
  "caribbean islands": "caribbean",
  "west indies": "caribbean",
  "the alaska": "alaska",
  "alaskan": "alaska",
};

function normalizeRegionKey(raw) {
  const v = foldDiacritics(String(raw || "").toLowerCase()).replace(/\s+/g, " ").trim();
  if (!v) return null;
  if (MARQUEE_KEYS.has(v)) return v;
  return REGION_ALIASES[v] || null;
}

// Length-ordered [regex, marquee key] list so a destination name a traveler (or
// the model) dropped into free text can be recovered as the region filter. The
// cruise/yacht atlases AND-filter `q` over fields that do NOT index the
// destination name, so a name left in `q` zeroes an otherwise-valid search
// (e.g. region=galapagos+month returns 44 departures; adding q=Galapagos -> 0).
const REGION_PHRASES = [
  ...[...MARQUEE_KEYS].map((k) => [k, k]),
  ...Object.entries(REGION_ALIASES),
]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([phrase, key]) => [
    new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
    key,
  ]);

// If `text` names a marquee region, return that region key plus the text with
// the phrase removed, so the search binds on the region filter instead of an
// unmatchable `q` token. Returns { key:null, cleaned:<text> } when none found.
function promoteRegionFromText(raw) {
  const text = foldDiacritics(String(raw || ""));
  for (const [re, key] of REGION_PHRASES) {
    if (re.test(text)) {
      return { key, cleaned: text.replace(re, " ").replace(/\s+/g, " ").trim() };
    }
  }
  return { key: null, cleaned: String(raw || "") };
}

// Marquee region for the Hotel atlas. caribbean and alaska are marquee keys
// now, so normalizeRegionKey resolves them directly; whether the atlas actually
// filters a given key is decided later via atlasFiltersRegion("hotel", ...).
function hotelRegionFor(raw) {
  return normalizeRegionKey(raw);
}

// Famous landmarks -> the city whose inventory actually answers the ask. The
// atlas has no geospatial proximity, so "near the Louvre" must become a Paris
// search plus an honest note instead of a zero-result place filter.
const LANDMARKS = [
  [/\b(?:the\s+)?louvre\b/i, "Paris", "the Louvre"],
  [/\beiffel(?:\s+tower)?\b/i, "Paris", "the Eiffel Tower"],
  [/\bchamps[\s-]?elysees\b/i, "Paris", "the Champs-Élysées"],
  [/\barc\s+de\s+triomphe\b/i, "Paris", "the Arc de Triomphe"],
  [/\bsagrada\s+familia\b/i, "Barcelona", "the Sagrada Família"],
  [/\bcolosseum\b/i, "Rome", "the Colosseum"],
  [/\b(?:the\s+)?vatican\b/i, "Rome", "the Vatican"],
  [/\btrevi\s+fountain\b/i, "Rome", "the Trevi Fountain"],
  [/\bspanish\s+steps\b/i, "Rome", "the Spanish Steps"],
  [/\bbig\s+ben\b/i, "London", "Big Ben"],
  [/\bbuckingham\s+palace\b/i, "London", "Buckingham Palace"],
  [/\btower\s+bridge\b/i, "London", "Tower Bridge"],
  [/\btimes\s+square\b/i, "New York", "Times Square"],
  [/\bcentral\s+park\b/i, "New York", "Central Park"],
  [/\bstatue\s+of\s+liberty\b/i, "New York", "the Statue of Liberty"],
  [/\bgolden\s+gate\b/i, "San Francisco", "the Golden Gate"],
  [/\bburj\s+khalifa\b/i, "Dubai", "the Burj Khalifa"],
  [/\bsydney\s+opera\s+house\b/i, "Sydney", "the Sydney Opera House"],
  [/\b(?:the\s+)?acropolis\b/i, "Athens", "the Acropolis"],
  [/\bbrandenburg\s+gate\b/i, "Berlin", "the Brandenburg Gate"],
  [/\bgrand\s+canal\b/i, "Venice", "the Grand Canal"],
  [/\brialto\b/i, "Venice", "the Rialto"],
];

// High-nuance categories the prompt routes advisor-led. Inventory may still
// hold adjacent stays (safari lodges, villa resorts), so the search runs and
// the note tells the Guide to frame results as a starting point, not blocking.
const ADVISOR_LED_CATEGORIES = [
  [/\bsafaris?\b|\bgame\s+(?:drives?|reserves?)\b/i, "Safari"],
  [/\b(?:private|exclusive)\s+islands?\b/i, "Private island"],
  [/\bbuy[\s-]?outs?\b|\bexclusive[\s-]use\b|\bfull[\s-]property\b/i, "Buyout"],
  [/\bvilla\s+rentals?\b|\b(?:standalone|private)\s+villas?\b|\brent(?:ing)?\s+a\s+villa\b/i, "Villa rental"],
  [/\b(?:escorted|guided|group|private)\s+tours?\b|\btour\s+operators?\b/i, "Escorted tour"],
];

function advisorLedCategoryFrom(input = {}) {
  const hay = [input.q, input.place].filter(Boolean).join(" ");
  for (const [re, label] of ADVISOR_LED_CATEGORIES) {
    if (re.test(hay)) return label;
  }
  return null;
}

// Per-channel brand aliases -> the exact brand/operator values in each atlas.
// Empty string means "no alias"; callers fall back to the raw input.
function normalizedHotelBrand(raw) {
  const v = normalizeBrandKey(raw);
  if (!v) return "";
  if (v === "fs" || /^four seasons?\b/.test(v)) return "Four Seasons";
  if (/\britz\b/.test(v) && /\bcarlton\b/.test(v)) {
    return /\breserve\b/.test(v) ? "Ritz-Carlton Reserve" : "Ritz-Carlton";
  }
  if (/^mandarin( oriental)?s?$/.test(v)) return "Mandarin Oriental";
  if (v === "one and only" || v === "one only") return "One&Only";
  if (/^(st|saint) regis$/.test(v)) return "St. Regis";
  if (/^waldorf( astoria)?$/.test(v)) return "Waldorf Astoria";
  if (/^shangri la/.test(v)) return "Shangri-La";
  if (/^auberge( resorts?( collection)?)?$/.test(v)) return "Auberge Resorts";
  if (/^oetker( collection)?$/.test(v)) return "Oetker Collection";
  if (/^aman( resorts)?$/.test(v)) return "Aman";
  if (/^(the )?peninsula( hotels)?$/.test(v)) return "The Peninsula";
  if (/^rosewood( hotels)?$/.test(v)) return "Rosewood";
  if (/^(bulgari|bvlgari)( hotels)?$/.test(v)) return "Bulgari";
  return "";
}

function normalizedCruiseOperator(raw) {
  const v = normalizeBrandKey(raw);
  if (!v) return "";
  if (/\bponant\b/.test(v)) return "PONANT EXPLORATIONS";
  if (/^hx\b/.test(v) || /hurtigruten/.test(v)) return "HX Expeditions";
  if (/lindblad/.test(v) || /national geographic/.test(v) || /\bnat geo\b/.test(v)) {
    return "National Geographic-Lindblad Expeditions";
  }
  if (/^quark/.test(v)) return "Quark Expeditions";
  if (/^aurora/.test(v)) return "Aurora Expeditions";
  if (/^atlas( ocean( voyages)?)?$/.test(v)) return "Atlas Ocean Voyages";
  if (/^aqua( expeditions)?$/.test(v)) return "Aqua Expeditions";
  if (/^swan( hellenic)?$/.test(v)) return "Swan Hellenic";
  if (/^silver ?seas?$/.test(v)) return "Silversea";
  if (/^seabourn/.test(v)) return "Seabourn";
  return "";
}

// World Cruise Atlas line names are short display names ("Regent Seven Seas",
// "Holland America"); travelers write the long or colloquial forms.
function normalizedWorldCruiseOperator(raw) {
  const v = normalizeBrandKey(raw);
  if (!v) return "";
  if (/\bregent\b/.test(v) || /seven seas/.test(v)) return "Regent Seven Seas";
  if (/\bcrystal\b/.test(v)) return "Crystal";
  if (/\boceania\b/.test(v)) return "Oceania Cruises";
  if (/\bcunard\b/.test(v) || /queen (mary|anne|victoria|elizabeth)/.test(v)) return "Cunard";
  if (v === "hal" || /holland/.test(v)) return "Holland America";
  if (/princess/.test(v)) return "Princess Cruises";
  if (/\bviking\b/.test(v)) return "Viking";
  if (/silver ?seas?/.test(v)) return "Silversea";
  if (/seabourn/.test(v)) return "Seabourn";
  if (/azamara/.test(v)) return "Azamara";
  if (/explora/.test(v)) return "Explora Journeys";
  if (/windstar/.test(v)) return "Windstar Cruises";
  if (/lindblad/.test(v) || /national geographic/.test(v) || /\bnat geo\b/.test(v)) {
    return "Nat Geo-Lindblad";
  }
  return "";
}

function normalizedJetBrand(raw) {
  const v = normalizeBrandKey(raw);
  if (!v) return "";
  if (v === "a k" || v === "ak" || /abercrombie/.test(v)) return "Abercrombie & Kent";
  if (/^tcs\b/.test(v)) return "TCS World Travel";
  if (v === "fs" || /^four seasons?\b/.test(v)) return "Four Seasons Private Jet";
  if (/^aman\b/.test(v)) return "Aman Jet Expeditions";
  if (/national geographic/.test(v) || /\bnat geo\b/.test(v) || /lindblad/.test(v)) {
    return "National Geographic";
  }
  if (/^remote lands?$/.test(v)) return "Remote Lands";
  if (/^seasonz/.test(v)) return "Seasonz New Zealand";
  if (/^signature/.test(v)) return "Signature Jet Journeys";
  return "";
}

// Anthropic tool-use schema (SPEC §6, verbatim shape).
export const SEARCH_OFFERINGS_TOOL = {
  name: "search_offerings",
  description:
    "Search Aspen Travel Advisors inventory: luxury hotels, Expedition Cruise journeys, " +
    "private jet journeys, luxury hotel yacht sailings, and world cruises. Use whenever a traveler " +
    "names a place, brand, season, or trip type. Type cruise intentionally " +
    "searches both Expedition Cruise journeys and luxury hotel yachts. Type worldcruise " +
    "searches live world cruises and grand voyages (50-250 day sailings with day-by-day " +
    "itineraries), including lines like Regent Seven Seas, Crystal, Oceania, and Cunard. " +
    "Ordinary (non-world) Luxury Cruises by those lines remain advisor-led outside the live inventory.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["hotel", "cruise", "jet", "yacht", "worldcruise", "any"],
        description:
          "Use cruise for Expedition Cruise or luxury hotel yacht language. Use worldcruise for world cruises, grand voyages, world cruise segments, and circumnavigations by sea. Ordinary Luxury Cruises such as Regent Seven Seas and Crystal should route to an advisor, not current inventory.",
      },
      q: {
        type: "string",
        description:
          "Free-text descriptors ONLY, e.g. 'overwater villa', 'ski-in', 'northern lights'. " +
          "Never put a brand, country, or region here. Use brand/country/region for those.",
      },
      intent: {
        type: "string",
        enum: [
          "honeymoon", "couples", "family", "multigen", "celebration", "business",
          "active", "expedition", "culture", "wildlife", "photography",
          "first-timer", "uhnw", "wellness", "foodie", "value", "simpleVip",
        ],
        description:
          "Guest-fit intent when clear. Applies across all five Atlases: honeymoon, couples, family, multigen, celebration, business, active, expedition, culture, wildlife, photography, first-timer, uhnw, wellness, foodie, value, or simpleVip.",
      },
      region: {
        type: "string",
        description:
          "Marquee region key, one of: antarctica, arctic, galapagos, amazon, polynesia, " +
          "patagonia, kimberley, mediterranean, norway, japan, namibia, alaska, caribbean, " +
          "northwest passage. Use when the trip clearly maps to one. " +
          "For any other area (Tuscany, the Amalfi Coast, Baja) leave region unset and use place or country instead.",
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
          "Hotel brand, Expedition Cruise operator, yacht brand, or world cruise line, e.g. Aman, Four Seasons, Rosewood, Seabourn, Ritz-Carlton. For type worldcruise, lines like Regent Seven Seas, Crystal, Oceania, Cunard, Viking, and Seabourn are live searchable inventory; for ordinary cruises those Luxury Cruise brands are advisor-led.",
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
        description: "Number of records to return per atlas/category. Curate around 3 by default. Max 4.",
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
  if (n > MAX_RESULTS_PER_CATEGORY) n = MAX_RESULTS_PER_CATEGORY;
  return n;
}

function requestedLimit(input = {}) {
  return clampLimit(input.limit, DEFAULT_RECOMMENDATION_LIMIT);
}

function candidateLimitForInput(input = {}, displayLimit = requestedLimit(input)) {
  const hasBrandConstraint = !!String(input.brand || input.operator || "").trim();
  if (hasBrandConstraint) return displayLimit;
  return displayLimit <= DEFAULT_RECOMMENDATION_LIMIT ? MAX_CANDIDATE_LIMIT : displayLimit;
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

// World cruise / grand voyage asks are live World Cruise Atlas inventory and
// must win over the Luxury Cruise advisor guard ("Regent world cruise" is a
// real searchable sailing, not an advisor-only brand mention).
function worldCruiseIntent(input = {}, type = String(input.type || "any").toLowerCase()) {
  if (type === "worldcruise") return true;
  const hay = [
    input.q,
    input.place,
    input.region,
    input.country,
    input.brand,
    input.operator,
  ].filter(Boolean).join(" ");
  if (!hay) return false;
  if (STRONG_WORLD_CRUISE_RE.test(hay)) return true;
  // "Around the world" alone belongs to the private-jet ATW category unless
  // the ask is already about cruising.
  const cruiseContext = type === "cruise" || type === "yacht" || CRUISE_CONTEXT_RE.test(hay);
  return cruiseContext && GENERIC_GLOBAL_VOYAGE_RE.test(hay);
}

function stripWorldCruiseTerms(raw) {
  return String(raw || "")
    .replace(STRONG_WORLD_CRUISE_RE, " ")
    .replace(GENERIC_GLOBAL_VOYAGE_RE, " ")
    .replace(/\b(world|grand|full|luxury|cruise|cruises|cruising|voyage|voyages|sailing|sailings|segment|segments|by\s+sea|ship|ships)\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function luxuryCruiseAdvisorIntent(input = {}, type = String(input.type || "any").toLowerCase()) {
  const hay = [
    input.q,
    input.place,
    input.region,
    input.country,
    input.brand,
    input.operator,
  ].filter(Boolean).join(" ");
  if (!hay) return false;
  if (STRONG_LUXURY_CRUISE_RE.test(hay)) return true;
  // "Regent" is also a hotel brand and "crystal"/"oceania" ordinary travel
  // words; those only mean Luxury Cruise when the ask is already about cruising.
  const cruiseContext = type === "cruise" || CRUISE_CONTEXT_RE.test(hay);
  if (cruiseContext && AMBIGUOUS_LUXURY_CRUISE_BRAND_RE.test(hay)) return true;
  return GENERIC_LUXURY_CRUISE_RE.test(hay) && !CURRENT_CRUISE_INVENTORY_RE.test(hay);
}

function advisorLedLuxuryCruiseResult(input = {}) {
  const brand = String(input.brand || input.operator || "").trim();
  const named = brand
    || (String(input.q || "").match(STRONG_LUXURY_CRUISE_RE) || [])[0]
    || (String(input.q || "").match(AMBIGUOUS_LUXURY_CRUISE_BRAND_RE) || [])[0]
    || "Luxury Cruise";
  return {
    type: "cruise",
    total: 0,
    count: 0,
    results: [],
    deepLink: null,
    chartRegion: chartRegionFrom(input.region, []),
    advisorOnly: true,
    note:
      `${named} is advisor-led Luxury Cruise inventory outside the current live Atlas. ` +
      `Route the traveler to an advisor to source sailings, suite fit, perks, and availability.`,
  };
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

function hotelQueryForInput(input, regionText = "") {
  let place = normalizeLoosePlace(input.place);
  // A non-marquee region (Alaska, Tuscany) would zero out the hotel atlas's
  // exact region filter, so it joins the place text and matches as geography.
  const rt = normalizeLoosePlace(regionText);
  if (rt && !place.toLowerCase().includes(rt.toLowerCase())) {
    place = [place, rt].filter(Boolean).join(" ");
  }
  let descriptor = stripDateFromQuery(input.q);
  let landmark = null;
  for (const [re, city, label] of LANDMARKS) {
    if (!re.test(foldDiacritics(`${place} ${descriptor}`))) continue;
    landmark = { city, label };
    descriptor = descriptor.replace(re, " ").replace(/\bnear\b/ig, " ").replace(/\s+/g, " ").trim();
    if (!place || re.test(foldDiacritics(place))) place = city;
    break;
  }
  const parts = [];
  if (place) parts.push(place);
  if (descriptor && (!place || !descriptor.toLowerCase().includes(place.toLowerCase()))) {
    parts.push(descriptor);
  }
  return { place, q: parts.join(" ").trim(), descriptor, landmark };
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

function brandDiverseResults(
  candidates = [],
  displayLimit = DEFAULT_RECOMMENDATION_LIMIT,
  fallbackType = "",
  { allowDuplicateBrands = false, supplierCap = 0 } = {},
) {
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
  // An explicit brand ask (Four Seasons in the Caribbean) wants several
  // properties from that one brand, so backfill same-brand duplicates up to the
  // display limit.
  if (allowDuplicateBrands) {
    const target = Math.min(candidates.length, displayLimit);
    return firstByBrand.concat(duplicates).slice(0, target);
  }
  // Open search: one card per supplier. A shortlist of "Silversea, Lindblad,
  // Silversea" is wrong — each slot should go to the next supplier. When a
  // supplierCap is given (cruise/yacht/jet), surface EVERY operator up to that
  // cap so a 4-5 operator region returns them all; otherwise (hotels, with
  // thousands of independent "brands") fall back to the small display limit.
  const cap = supplierCap > 0 ? supplierCap : displayLimit;
  return firstByBrand.slice(0, cap);
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
    thumb: h.thumb || null,
    photos: (h.photos || h.images || [h.thumb]).filter(Boolean).slice(0, 3),
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

// Pick the [[CHART: region]] key: an explicit marquee region wins; otherwise
// the most common marquee region among the results, but only when it covers a
// majority. One mistagged long itinerary must not chart-jump an Alaska or
// Caribbean shortlist to an unrelated marquee map.
function chartRegionFrom(inputRegion, results) {
  const r = normalizeRegionKey(inputRegion);
  if (r) return r;
  const tally = {};
  for (const h of results) {
    if (h.region && MARQUEE_KEYS.has(h.region)) tally[h.region] = (tally[h.region] || 0) + 1;
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] * 2 <= results.length) return null;
  return top[0];
}

function chartRegionForTravelInput(input = {}, results = []) {
  const explicit = [input.region, input.place, input.country]
    .map((v) => normalizeRegionKey(v))
    .find(Boolean);
  if (explicit) return explicit;
  // If the traveler named non-marquee geography such as Baja, the Seychelles,
  // or Tuscany, do not infer a marquee chart jump from a few mixed or
  // supplier-misfiled sailings. The exact result deep link carries the visual.
  const hasSpecificGeo = [input.region, input.place, input.country]
    .some((v) => String(v || "").trim());
  return hasSpecificGeo ? null : chartRegionFrom("", results);
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
  const results = ((payload && payload.results) || []).slice(0, MAX_RESULTS_PER_CATEGORY);
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
    .map((v) => normalizeRegionKey(v))
    .find(Boolean) || null;
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
    intent: input.intent,
  };
  const r = await searchOfferingsByType("yacht", sub, fetchImpl, DEFAULT_RECOMMENDATION_LIMIT);
  if (!r || r.unavailable || !r.count) return null;
  const who = yachtBrand || "Luxury hotel yacht";
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
    { region, month: month || input.month, intent: input.intent },
    fetchImpl,
    DEFAULT_RECOMMENDATION_LIMIT
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
    { region, month: month || input.month, intent: input.intent },
    fetchImpl,
    DEFAULT_RECOMMENDATION_LIMIT
  );
  if (!r || r.unavailable || !r.count) return null;
  return relatedEntry(
    "jet",
    `Private jet journeys touching ${region} for travelers weighing a broader hosted itinerary.`,
    r
  );
}

// Pre/post hotel stays near a sailing's embarkation city, for yacht results.
// A yacht line's hotel sibling, when one exists, for the "same brand ashore"
// rule. Returns "" when the line has no hotels (then we show the best in area).
function hotelBrandForYachtBrand(raw) {
  const v = normalizeBrandKey(raw);
  if (!v) return "";
  if (/four seasons/.test(v)) return "Four Seasons";
  if (/ritz/.test(v) && /carlton/.test(v)) return "Ritz-Carlton";
  if (/aman/.test(v)) return "Aman";
  if (/orient/.test(v) && /express/.test(v)) return "Orient Express";
  if (/belmond/.test(v)) return "Belmond";
  return "";
}

// Nature-forward expedition regions whose luxury lodges live under a country the
// hotel atlas filters (these region keys are not hotel-tagged). Multi-country or
// hotel-less regions (antarctica, arctic) are intentionally absent so we skip
// rather than mis-anchor.
const REGION_PRIMARY_COUNTRY = {
  galapagos: "Ecuador",
  amazon: "Peru",
  patagonia: "Chile",
  kimberley: "Australia",
  polynesia: "French Polynesia",
};

function regionLabelFor(key) {
  return String(key || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Companion-hotel reason text, by channel. brandUsed set => same-brand-ashore.
function companionReason(type, label, brandUsed) {
  if (brandUsed) return `${brandUsed} ashore in ${label}, matching the yacht for nights before or after sailing.`;
  if (type === "cruise") return `Nature-forward lodges in ${label} to pair with the expedition, before or after.`;
  if (type === "jet") return `The highest-rated stays in ${label} to bookend the journey.`;
  if (type === "worldcruise") return `The highest-rated stays in ${label}, for nights before or after embarkation.`;
  return `The strongest stays in ${label}, for nights before or after sailing.`;
}

// Hotels to pair with a sailing or journey. The companion channel sets BOTH the
// quality bar and the anchor: expedition cruise -> nature-forward (intent
// wildlife); jet & world cruise -> highest available (intent uhnw); yacht ->
// the same brand ashore when it has hotels here, otherwise the best in the area.
// Anchor is the embarkation port when the record carries `from`, else the
// region/country the journey covers.
async function relatedHotelsForCompanion(lead, type, fetchImpl) {
  if (!lead) return null;
  const clean = (s) =>
    String(s || "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();

  // ── Anchor ──────────────────────────────────────────────────────────────
  const base = new URLSearchParams();
  let label = "";
  const parts = String(lead.from || "").split(",");
  const portCity = clean(parts[0]);
  // Scope a port to its country so a port-town name can't collide with a
  // same-named town elsewhere ("Philipsburg, Sint Maarten" once matched The
  // Ranch at Rock Creek in Philipsburg, Montana).
  const portCountry = portCity
    ? normalizeCountry(clean(parts.slice(1).join(",")) || lead.country || "")
    : "";
  if (portCity && portCountry) {
    base.set("q", portCity);
    base.set("country", portCountry);
    label = portCity;
  } else {
    const regionKey = normalizeRegionKey(lead.region) || normalizeRegionKey(lead.regionLabel);
    const mappedCountry = regionKey ? REGION_PRIMARY_COUNTRY[regionKey] : "";
    const leadCountry = normalizeCountry(lead.country || "");
    if (mappedCountry) { base.set("country", mappedCountry); label = mappedCountry; }
    else if (leadCountry) { base.set("country", leadCountry); label = leadCountry; }
    else if (regionKey && atlasFiltersRegion("hotel", regionKey)) { base.set("region", regionKey); label = regionLabelFor(regionKey); }
    else return null; // nothing safe to anchor on — skip rather than guess
  }

  // ── Quality / brand plan ────────────────────────────────────────────────
  const intent = type === "cruise" ? "wildlife" : "uhnw"; // jet/yacht/worldcruise -> highest
  const sameBrand = type === "yacht" ? hotelBrandForYachtBrand(lead.brand || lead.operator) : "";
  base.set("intent", intent);
  base.set("limit", "3");

  const run = async (p) => {
    try {
      const r = await fetchImpl(`${HOTEL_API_BASE}/api/luxury-hotels?${p.toString()}`);
      if (!r.ok) return null;
      const j = await r.json();
      const results = (j.results || []).slice(0, 3).map(hotelCard);
      return results.length ? { total: j.total, results, deepLink: j.deepLink || null } : null;
    } catch {
      return null;
    }
  };

  // Yacht with a hotel sibling: try that brand ashore first; fall back to the
  // best in the area if the brand has nothing here.
  let brandUsed = "";
  let got = null;
  if (sameBrand) {
    const branded = new URLSearchParams(base);
    branded.set("brand", sameBrand);
    got = await run(branded);
    if (got) brandUsed = sameBrand;
  }
  if (!got) got = await run(base);
  if (!got) return null;

  return relatedEntry("hotel", companionReason(type, label, brandUsed), {
    total: got.total,
    results: got.results,
    deepLink: got.deepLink,
  });
}

async function searchHotels(input, fetchImpl) {
  const limit = requestedLimit(input);
  const candidateLimit = candidateLimitForInput(input, limit);
  const month = normalizeMonth(input.month) || monthFromText(input.q);
  const rawBrand = String(input.brand || "").trim();
  const brand = rawBrand ? (normalizedHotelBrand(rawBrand) || rawBrand) : "";

  // Resolve the marquee region the traveler named, in region, then place, then a
  // region-like country value. A region named only in `place` (the "Four
  // Seasons in Caribbean" case) would otherwise leave as a free-text place
  // token that matches no single property and zeroes the search. Detection
  // (chartKey, for the map) is kept separate from whether the atlas can filter
  // it: an unsupported key still binds, as free text rather than a dropped param.
  let chartKey = hotelRegionFor(input.region);
  let working = input;
  if (!chartKey && input.place) {
    const fromPlace = promoteRegionFromText(input.place);
    if (fromPlace.key) { chartKey = fromPlace.key; working = { ...working, place: fromPlace.cleaned }; }
  }
  if (!chartKey && input.country) {
    const cKey = normalizeRegionKey(input.country);
    if (cKey && !MARQUEE_COUNTRIES.has(cKey)) { chartKey = cKey; working = { ...working, country: "" }; }
  }
  let regionKey = chartKey;
  let regionAsText = "";
  if (regionKey && !atlasFiltersRegion("hotel", regionKey)) { regionAsText = regionKey; regionKey = null; }

  const placeCountry = working.country ? "" : countryFromPlaceAlias(working.place);
  const country = normalizeCountry(working.country) || placeCountry;
  const regionText = regionAsText
    || (!chartKey && working.region ? String(working.region).trim() : "");
  const queryInput = placeCountry ? { ...working, place: "" } : working;
  const { place, q, descriptor, landmark } = hotelQueryForInput(queryInput, regionText);
  const notes = [];
  if (landmark) {
    notes.push(
      `The atlas cannot search proximity to ${landmark.label}; showing the strongest approved ` +
      `${landmark.city} stays instead. An advisor can target the exact neighborhood.`
    );
  }

  const fetchHotelQuery = async (queryText, { dropBrand = false } = {}) => {
    const p = new URLSearchParams();
    if (queryText) p.set("q", queryText);
    if (regionKey) p.set("region", regionKey);
    if (brand && !dropBrand) p.set("brand", brand);
    if (country) p.set("country", country);
    if (input.intent) p.set("intent", String(input.intent).trim());
    if (month) p.set("month", month);
    p.set("limit", String(candidateLimit));

    const url = `${HOTEL_API_BASE}/api/luxury-hotels?${p.toString()}`;
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error(`hotel api ${r.status}`);
    return r.json();
  };

  // Cross-channel sidecars run alongside the hotel query so they cost no
  // extra latency; each resolves to null on any miss or failure. They get the
  // normalized brand/country so "FS" still finds Four Seasons Yachts.
  const sidecarInput = { ...input, brand, country };
  const relatedPromises = [
    relatedYachtsForHotels(sidecarInput, fetchImpl, month).catch(() => null),
    relatedCruisesForHotels(sidecarInput, fetchImpl, month).catch(() => null),
    relatedJetsForHotels(sidecarInput, fetchImpl, month).catch(() => null),
  ];

  // Fallback chain: place + descriptors -> place only -> brand as free text ->
  // country/region only. Each step loosens the constraint most likely to have
  // zeroed the match set, and every loosening leaves a note so the Guide can
  // say plainly what was dropped instead of presenting fallbacks as matches.
  const count = (res) => (res.results || []).length;
  let j = await fetchHotelQuery(q);
  if (place && descriptor && !count(j)) {
    j = await fetchHotelQuery(place);
    if (count(j)) {
      notes.push(
        `Nothing in the approved inventory matched "${descriptor}" in ${place}; ` +
        `showing the strongest approved ${place} stays instead.`
      );
    }
  }
  if (!count(j) && brand) {
    // Exact brand filtering is strict; an unrecognized spelling still matches
    // as free text against the property name and brand fields.
    j = await fetchHotelQuery([rawBrand, place].filter(Boolean).join(" "), { dropBrand: true });
    if (count(j)) {
      notes.push(`"${rawBrand}" did not match an exact brand name; results matched it as text.`);
    }
  }
  if (!count(j) && q && (country || regionKey)) {
    j = await fetchHotelQuery("");
    if (count(j)) {
      const where = country || regionKey;
      notes.push(place
        ? `No approved property matched "${place}"; showing approved options in ${where} ` +
          `instead. Worth confirming the place name, or an advisor can source it directly.`
        : `Nothing matched "${descriptor}" exactly; showing strong approved options in ${where} instead.`);
    }
  }
  const advisorCategory = advisorLedCategoryFrom(input);
  if (advisorCategory) {
    notes.push(
      `${advisorCategory} requests are advisor-led; treat any matches as a starting point ` +
      `and route the planning itself to an advisor.`
    );
  }
  const candidates = (j.results || []).map(hotelCard);
  // Hotels keep the established behavior: prefer distinct brands, then fill to
  // the limit (a free-text "aman" search should still return several Amans). The
  // one-per-supplier sweep is scoped to the cruise/yacht/jet atlases below.
  const results = brandDiverseResults(candidates, limit, "hotel", {
    allowDuplicateBrands: true,
  });
  const related = (await Promise.all(relatedPromises)).filter(Boolean);

  return {
    type: "hotel",
    total: j.total ?? results.length,   // honest unpaginated count for the Guide
    count: results.length,
    results,
    deepLink: deepLinkWithResultIds(j.deepLink || null, results),
    chartRegion: chartRegionFrom(chartKey || input.region, j.results || []),
    ...(notes.length ? { note: notes.join(" ") } : {}),
    ...(related.length ? { related } : {}),
  };
}

// cruise | jet | yacht -> each type's own Atlas query API, same shape as hotels.
// Degrades gracefully if an endpoint is unreachable so the Guide routes to an
// advisor instead of inventing inventory.
async function searchOfferingsByType(type, input, fetchImpl, limitOverride = null, { supplierCap = 0 } = {}) {
  const atwJet = type === "jet" && aroundTheWorldJetIntent(input);
  const limit = limitOverride == null
    ? requestedLimit(input)
    : clampLimit(limitOverride);
  // Supplier diversity needs a wide candidate pool. candidateLimitForInput only
  // overfetches when the display limit is small (<=3); when the model asks for
  // limit:4 it would fetch just 4 records — often two sailings each from only two
  // operators, hiding the rest. Whenever we are diversifying (supplierCap set),
  // pull the full page so every operator is in the pool to pick one each from.
  const candidateLimit = supplierCap > 0
    ? MAX_CANDIDATE_LIMIT
    : candidateLimitForInput(input, limit);
  const cfg = OFFERINGS_ENDPOINTS[type];
  const month = normalizeMonth(input.month) || monthFromText(input.q);
  let baseQ = atwJet ? stripAroundTheWorldJetTerms(stripDateFromQuery(input.q))
    : type === "worldcruise" ? stripWorldCruiseTerms(stripDateFromQuery(input.q))
    : stripDateFromQuery(input.q);
  let placeText = !atwJet && type !== "jet" && input.place ? normalizeLoosePlace(input.place) : "";
  const rawBrand = String(input.brand || input.operator || "").trim();
  // No specific brand asked → diversify suppliers. The cruise/yacht/jet atlases
  // cap a page at 24 records and, when an intent is passed, sort so heavily by
  // fit that the top page collapses to one or two operators (a Galápagos
  // "expedition" page came back all Silversea + Lindblad, hiding Aqua and HX).
  // intent only re-sorts, it does not filter (the total is unchanged), so for an
  // open search we drop it from the query to recover supplier breadth and pick
  // one sailing per operator below. An explicit brand ask keeps intent.
  const diversifySuppliers = !rawBrand;
  let brand = rawBrand;
  if (type === "cruise") brand = normalizedCruiseOperator(rawBrand) || rawBrand;
  else if (type === "jet") brand = normalizedJetBrand(rawBrand) || rawBrand;
  else if (type === "worldcruise") brand = normalizedWorldCruiseOperator(rawBrand) || rawBrand;
  const yachtBrand = type === "yacht" ? normalizedYachtBrand(rawBrand) : "";
  let regionKey = normalizeRegionKey(input.region);
  // Recover or de-dupe a marquee region the model left in free text: the
  // cruise/yacht atlases don't index the destination name in `q`, so leaving it
  // there AND-filters the search to zero even when region+month alone is valid.
  // Promote it to the region filter and strip the name from the q text.
  if (!atwJet && type !== "jet") {
    const fromQ = promoteRegionFromText(baseQ);
    if (fromQ.key) { regionKey = regionKey || fromQ.key; baseQ = fromQ.cleaned; }
    const fromPlace = promoteRegionFromText(placeText);
    if (fromPlace.key) { regionKey = regionKey || fromPlace.key; placeText = fromPlace.cleaned; }
  }
  // alaska and caribbean are marquee regions, but the Expedition Cruise, Jet,
  // and Yacht atlases do not filter them on the backend yet (their region=
  // param silently drops unknown values, which would broaden the search).
  // Until those backends ship the filter (see EXTENDED_REGION_NATIVE), bind the
  // named region as free text so it still constrains the result set.
  let regionAsText = "";
  if (regionKey && type !== "worldcruise" && !atlasFiltersRegion(type, regionKey)) {
    regionAsText = regionKey;
    regionKey = null;
  }
  // The World Cruise Atlas resolves its own region aliases (caribbean, alaska,
  // hawaii, the marquee keys), so the raw region passes through as a region.
  const worldCruiseRegion = type === "worldcruise"
    ? (regionKey || String(input.region || "").trim()) : "";
  // A region not filtered natively (a non-marquee area, or alaska/caribbean on
  // an atlas whose backend is not yet updated) binds as free text against the
  // name/region labels instead of being dropped.
  const regionText = !atwJet && type !== "worldcruise"
    ? (regionAsText || (!regionKey && input.region ? String(input.region).trim() : ""))
    : "";
  const country = normalizeCountry(input.country);
  const hadQText = !!String([regionText, placeText, baseQ].filter(Boolean).join(" ")).trim();

  const buildUrl = ({ brandAsText = false, dropQ = false } = {}) => {
    const p = new URLSearchParams();
    let queryText = [regionText, placeText, baseQ].filter(Boolean).join(" ").trim();
    if (atwJet) {
      p.set("world", "true");
    } else if (type === "worldcruise") {
      if (worldCruiseRegion) p.set("region", worldCruiseRegion);
      if (country) p.set("country", country);
    } else {
      if (regionKey) p.set("region", regionKey);
      if (country) p.set("country", country);
    }
    if (brand) {
      if (type === "yacht") {
        if (yachtBrand && !brandAsText) p.set("brand", yachtBrand);
        else queryText = [rawBrand, queryText].filter(Boolean).join(" ");
      } else if (brandAsText) {
        queryText = [rawBrand, queryText].filter(Boolean).join(" ");
      } else if (type === "cruise") {
        p.set("operator", brand);
      } else {
        p.set("brand", brand);
      }
    }
    if (queryText && !dropQ) p.set("q", queryText);
    // Month without a year => next instance of that month (Base Camp rule).
    if (month) p.set("month", month);
    // Send intent only on a branded ask; an open search drops it so the page is
    // not sorted down to a single operator (see diversifySuppliers above).
    if (input.intent && !diversifySuppliers) p.set("intent", String(input.intent).trim());
    p.set("limit", String(candidateLimit));
    return `${cfg.base}${cfg.path}?${p.toString()}`;
  };

  try {
    const run = async (opts) => {
      const r = await fetchImpl(buildUrl(opts));
      if (!r.ok) throw new Error(`${type} api ${r.status}`);
      return r.json();
    };
    let j = await run({});
    let note = null;
    const brandParamSet = !!brand && (type !== "yacht" || !!yachtBrand);
    if (brandParamSet && !(j.results || []).length) {
      // Exact operator/brand names are strict ("Ponant" vs "PONANT
      // EXPLORATIONS"); a near-miss still matches as free text.
      const retry = await run({ brandAsText: true });
      if ((retry.results || []).length) {
        j = retry;
        note = `"${rawBrand}" did not match an exact ${type} operator name; results matched it as text.`;
      }
    }
    // Descriptor words a traveler uses ("wildlife", "luxury") are not always
    // indexed in the atlas `q` fields; combined with a real geographic anchor
    // they AND-filter the search to zero. With a region or country to keep the
    // search bounded, retry once without `q` rather than returning nothing.
    const geoAnchor = !!(regionKey || country || worldCruiseRegion);
    if (geoAnchor && hadQText && !(j.results || []).length) {
      const retry = await run({ dropQ: true });
      if ((retry.results || []).length) {
        j = retry;
        if (!note) {
          note = "Some descriptive words did not match indexed fields; broadened to the region to surface live inventory.";
        }
      }
    }
    const candidates = j.results || [];
    const results = brandDiverseResults(candidates, limit, type, {
      allowDuplicateBrands: !!rawBrand,
      supplierCap: rawBrand ? 0 : supplierCap,
    });
    return {
      type,
      total: j.total ?? results.length,
      count: results.length,
      results,
      deepLink: deepLinkWithResultIds(j.deepLink || cfg.base, results),
      chartRegion: chartRegionForTravelInput(input, results),
      ...(note ? { note } : {}),
    };
  } catch (err) {
    // Endpoint unreachable: tell the Guide so it can route to an advisor.
    const typeLabel = type === "worldcruise" ? "World Cruise" : type;
    return {
      type,
      total: 0,
      count: 0,
      results: [],
      deepLink: null,
      chartRegion: normalizeRegionKey(input.region),
      unavailable: true,
      note:
        `${typeLabel} inventory is momentarily unreachable. An advisor can ` +
        `source live ${typeLabel} options directly.`,
    };
  }
}

function interleaveResults(groups, perCategoryLimit, { allowDuplicateBrands = false, supplierCap = 0 } = {}) {
  const cappedGroups = groups.map((group) =>
    brandDiverseResults(group || [], perCategoryLimit, "cruise", {
      allowDuplicateBrands,
      supplierCap: allowDuplicateBrands ? 0 : supplierCap,
    }));
  const candidates = [];
  const seen = new Set();
  let idx = 0;
  while (true) {
    let added = false;
    for (const group of cappedGroups) {
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
  return candidates;
}

async function searchCruisesAndYachts(input, fetchImpl) {
  const limit = requestedLimit(input);
  // No brand named → sweep one sailing per operator across both atlases so every
  // expedition line in the region/month appears; a brand ask stays a short list.
  const allowDuplicateBrands = !!String(input.brand || input.operator || "").trim();
  const supplierCap = allowDuplicateBrands ? 0 : MAX_SUPPLIERS_PER_CATEGORY;
  const [cruise, yacht] = await Promise.all([
    searchOfferingsByType("cruise", input, fetchImpl, limit, { supplierCap }),
    searchOfferingsByType("yacht", input, fetchImpl, limit, { supplierCap }),
  ]);
  const results = interleaveResults(
    [cruise.results || [], yacht.results || []],
    limit,
    { allowDuplicateBrands, supplierCap },
  );
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
    chartRegion: chartRegionForTravelInput(input, results),
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
async function sailingRelatedHotels(results = [], fetchImpl, fallbackType = "") {
  // Anchor on the first result with a usable location (port, region, or country)
  // — expedition cruise and jet carry a region but no embarkation port.
  const lead = results.find((r) => r && (r.from || r.region || r.regionLabel || r.country));
  if (!lead) return [];
  const type = String(lead.type || fallbackType || "").toLowerCase();
  const entry = await relatedHotelsForCompanion(lead, type, fetchImpl).catch(() => null);
  return entry ? [entry] : [];
}

// World cruise channel: the search plus a pre/post hotel sidecar for the
// embarkation city, same shape as the yacht channel.
async function searchWorldCruises(input, fetchImpl) {
  const r = await searchOfferingsByType("worldcruise", input, fetchImpl);
  const related = await sailingRelatedHotels(r.results, fetchImpl, "worldcruise");
  return related.length ? { ...r, related } : r;
}

// Main entry. `input` is the validated tool input from the model.
export async function searchOfferings(input = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetchWithTimeout;
  const type = String(input.type || "any").toLowerCase();

  // World cruises outrank the Luxury Cruise advisor guard: "Regent world
  // cruise" is live World Cruise Atlas inventory, not an advisor-only brand.
  if (type === "worldcruise" ||
      ((type === "cruise" || type === "yacht" || type === "any") && worldCruiseIntent(input, type))) {
    return searchWorldCruises(input, fetchImpl);
  }

  // Yacht included: "luxury cruise in the Med" routed to type yacht must still
  // reach an advisor, not be silently answered with yacht inventory.
  if ((type === "cruise" || type === "yacht" || type === "any") && luxuryCruiseAdvisorIntent(input, type)) {
    return advisorLedLuxuryCruiseResult(input);
  }
  if (type === "hotel" || type === "any") {
    return searchHotels(input, fetchImpl);
  }
  if (type === "cruise") {
    return searchCruisesAndYachts(input, fetchImpl);
  }
  const openSupplierCap = String(input.brand || input.operator || "").trim()
    ? 0
    : MAX_SUPPLIERS_PER_CATEGORY;
  if (type === "yacht") {
    const r = await searchOfferingsByType(type, input, fetchImpl, null, { supplierCap: openSupplierCap });
    const related = await sailingRelatedHotels(r.results, fetchImpl, "yacht");
    return related.length ? { ...r, related } : r;
  }
  if (type === "jet") {
    // Jets bookend with the highest-available hotels in the journey's region.
    const r = await searchOfferingsByType(type, input, fetchImpl, null, { supplierCap: openSupplierCap });
    const related = await sailingRelatedHotels(r.results, fetchImpl, "jet");
    return related.length ? { ...r, related } : r;
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

// Trip-reason words -> guest-fit intent, used when the model leaves intent
// unset. The fit data ranks on these, so recovering an obvious one from the
// traveler's own words materially reorders the shortlist.
const INTENT_HINTS = [
  [/\b(honeymoon|honeymooners|newlywed|newlyweds|just\s+married|minimoon)\b/i, "honeymoon"],
  [/\b(couple|couples|romantic|romance|partners)\b/i, "couples"],
  [/\b(anniversary|birthday|babymoon|proposal|propose|engagement|graduation|retirement|milestone|celebrate|celebrating|celebration)\b/i, "celebration"],
  [/\b(multigen(?:erational)?|grandparents|grandkids|extended\s+family)\b/i, "multigen"],
  [/\b(family|families|kids?|children|toddlers?|teens?|teenagers?)\b/i, "family"],
  [/\b(business|work\s+trip|conference|offsite|meetings)\b/i, "business"],
  [/\b(safari|wildlife|animals?|gorillas?|penguins?|polar\s+bears?|whales?|bears?)\b/i, "wildlife"],
  [/\b(photo|photos|photography|photographer|camera)\b/i, "photography"],
  [/\b(expedition|remote|antarctica|arctic|galapagos|amazon|patagonia|kimberley|svalbard|northwest\s+passage)\b/i, "expedition"],
  [/\b(ski(?:ing)?|hik(?:e|es|ing)|trek(?:king)?|div(?:e|ing)|surf(?:ing)?|golf(?:ing)?|adventure|active)\b/i, "active"],
  [/\b(culture|cultural|history|historic|museums?|art|architecture|temples?|unesco|food|culinary|wine)\b/i, "culture"],
  [/\b(wellness|spa|reset|recovery|detox|yoga|sleep)\b/i, "wellness"],
  [/\b(foodie|restaurant|restaurants|dining|culinary|wine)\b/i, "foodie"],
  [/\b(first[\s-]?timer|first\s+time|easy|introductory|introduction)\b/i, "first-timer"],
  [/\b(uhnw|ultra[\s-]?luxury|private|privacy|exclusive|top\s+tier|best\s+of\s+the\s+best)\b/i, "uhnw"],
  [/\b(value|deal|reasonable|not\s+too\s+expensive|lower\s+budget)\b/i, "value"],
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
  let out = input;
  if (!out.intent) {
    const intent = inferIntentFromText(`${text} ${input.q || ""}`);
    if (intent) out = { ...out, intent };
  }

  // The traveler's own words said "world cruise"/"grand voyage": route to the
  // World Cruise Atlas even if the model only typed cruise or left type unset.
  if (type !== "jet" && type !== "hotel" && type !== "worldcruise" &&
      STRONG_WORLD_CRUISE_RE.test(text)) {
    return { ...out, type: "worldcruise" };
  }

  if (!hasHotelIntent && (type === "hotel" || type === "any")) {
    if (hasCruiseIntent) return { ...out, type: "cruise" };
    if (hasYachtIntent) return { ...out, type: "yacht" };
  }

  if (type !== "hotel" && type !== "any") return out;
  if (!out.place) {
    const place = extractMentionedPlace(latestUserText);
    if (place) out = { ...out, place };
  }
  return out;
}

export {
  chartRegionFrom,
  clampLimit,
  normalizeMonth,
  normalizeCountry,
  normalizeRegionKey,
  luxuryCruiseAdvisorIntent,
  worldCruiseIntent,
  MARQUEE_KEYS,
  HOTEL_API_BASE,
  prioritizeMentionedPlace,
};

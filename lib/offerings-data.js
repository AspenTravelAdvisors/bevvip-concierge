// lib/offerings-data.js — Base Camp: live cruise / jet / yacht inventory.
//
// Hotels have a real paginated API; cruise/jet/yacht each publish a static feed
// from their own Atlas app. This module fetches those feeds server-side once,
// normalizes them into a single offering-record shape the Guide can render and
// reason over, maps each app's region vocabulary onto our marquee keys, and
// supports the same q / region / country / month / limit filters as hotels.
//
// Used in-process by lib/search-offerings.js (the Guide tool) and over HTTP by
// api/offerings.js. No model-knowledge invention; no final pricing. Every record
// carries a real advisor-backed Virtuoso booking URL.

const SOURCES = {
  cruise: "https://expedition-cruise-map.vercel.app/sailings.json",
  jet:    "https://private-jet-expeditions.vercel.app/itinerary.json",
  yacht:  "https://luxury-hotel-brand-yacht-atlas.vercel.app/itinerary.json",
};
const ATLAS_URL = {
  cruise: "https://expedition-cruise-map.vercel.app",
  jet:    "https://private-jet-expeditions.vercel.app",
  yacht:  "https://luxury-hotel-brand-yacht-atlas.vercel.app",
};

const TTL = 1000 * 60 * 60 * 6;   // refresh each in-memory feed every 6h
const CACHE = {};                 // { type: { records, at } }

// Marquee region keys the Living Atlas can plot (CLAUDE.md / SPEC §3).
const MARQUEE = new Set([
  "antarctica", "arctic", "galapagos", "amazon", "polynesia",
  "patagonia", "kimberley", "mediterranean", "norway", "japan", "namibia",
]);

// App region vocabulary -> marquee key (only the ones that genuinely map).
const CRUISE_REGION_MARQUEE = {
  "Antarctica": "antarctica",
  "Arctic": "arctic",
  "Galápagos": "galapagos",
  "Amazon & South America": "amazon",
  "Hawaii & Tahiti": "polynesia",
  "Mediterranean": "mediterranean",
  "Norway, Fjords & Coast": "norway",
};
const JET_REGION_MARQUEE = {
  ANTARCTICA: "antarctica",
  AURORA: "arctic",
  POLY: "polynesia",
  EASTASIA: "japan",
  SAM: "amazon",
};
const YACHT_REGION_MARQUEE = {
  MED: "mediterranean", CENTRALMED: "mediterranean",
  ADRIATIC: "mediterranean", AEGEAN: "mediterranean",
  POLY: "polynesia", EASTASIA: "japan",
};

// Readable region labels (for cards / prose) keyed by the app's own region key.
const JET_REGION_NAME = {
  EUROPE: "Europe & the Mediterranean", EASTASIA: "Japan, China & East Asia",
  SEASIA: "Southeast Asia", INDIA: "India & South Asia",
  SILK: "Silk Road & Central Asia", MIDEAST: "Arabia & the Middle East",
  AFRICA: "Africa", POLY: "South Pacific & Polynesia",
  ANZ: "Australia & New Zealand", SAM: "South America",
  AMERICAS: "North & Central America", CANADA: "Canada & the Far North",
  AURORA: "Arctic, Iceland & the Aurora", ANTARCTICA: "Antarctica",
};
const JET_BRAND = {
  fourseasons: "Four Seasons Private Jet", aman: "Aman Jet Expeditions",
  natgeo: "National Geographic", signature: "Signature Jet Journeys",
  remotelands: "Remote Lands", ak: "Abercrombie & Kent",
  seasonz: "Seasonz New Zealand", tcs: "TCS World Travel",
};
const YACHT_REGION_NAME = {
  MED: "Western Mediterranean & Rivieras", ADRIATIC: "Adriatic, Ionian & Dalmatian Coast",
  AEGEAN: "Greek Isles, Turkey & Aegean", CENTRALMED: "Malta, Sicily & Central Mediterranean",
  ATLANTIC: "Atlantic Crossings, Iberia & Canary Islands", CARIB: "Caribbean, Bahamas & Lesser Antilles",
  CENTRALAM: "Central America, Panama & Costa Rica", ALASKA: "Alaska & Pacific Northwest",
  POLY: "South Pacific, Tahiti & Hawaii", EASTASIA: "Japan, Korea, China & East Asia",
  SEASIA: "Southeast Asia, Thailand & Indonesia", NEUROPE: "Northern Europe, British Isles & Iceland",
  REDSEA: "Red Sea, Egypt & Middle East",
};
const YACHT_BRAND = {
  fourseasons: "Four Seasons Yachts", aman: "Aman at Sea",
  orientexpress: "Orient Express Sailing Yachts", ritzcarlton: "Ritz-Carlton Yacht Collection",
};

// Scan a free-text blob for any marquee keyword; used to refine region tags
// (e.g. a Kimberley sailing filed under "Australia, NZ & South Pacific").
const KEYWORD_TO_MARQUEE = [
  ["antarctica", "antarctica"], ["galápagos", "galapagos"], ["galapagos", "galapagos"],
  ["amazon", "amazon"], ["patagonia", "patagonia"], ["kimberley", "kimberley"],
  ["namibia", "namibia"], ["norway", "norway"], ["mediterranean", "mediterranean"],
  ["polynesia", "polynesia"], ["tahiti", "polynesia"], ["arctic", "arctic"],
  ["svalbard", "arctic"], ["japan", "japan"],
];
function marqueeFromText(text, fallback) {
  const t = String(text || "").toLowerCase();
  for (const [kw, key] of KEYWORD_TO_MARQUEE) if (t.includes(kw)) return key;
  return fallback || null;
}

const num = (v) => Number(v);
// "Lisbon, Portugal" -> "Portugal"; plain "Lisbon" -> "".
function countryOf(place) {
  const parts = String(place || "").split(",");
  return parts.length > 1 ? parts[parts.length - 1].trim() : "";
}
function ym(dateLike) {
  // Accept "2027-04-01", "6/16/2026", or a Date-parseable string.
  const s = String(dateLike || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, "0")}`;
  const d = new Date(s);
  if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return null;
}

// ── per-type normalizers -> common offering record ──────────────────────────
async function buildCruise() {
  const j = await (await fetch(SOURCES.cruise)).json();
  const idx = {};
  (j.schema || []).forEach((k, i) => (idx[k] = i));
  const base = j.urlBase || (ATLAS_URL.cruise + "/cruises/sailings/");
  return (j.rows || []).map((row) => {
    const name = row[idx.name];
    const regionLabel = row[idx.region];
    const slug = row[idx.slug] || "";
    const id = row[idx.id];
    const bookUrl = id && slug ? `${base}${id}/${slug}` : ATLAS_URL.cruise;
    return {
      id: `cr_${id}`,
      type: "cruise",
      name,
      operator: row[idx.operator] || null,
      brand: row[idx.operator] || null,
      regionLabel: regionLabel && !/^other$/i.test(regionLabel) ? regionLabel : null,
      region: marqueeFromText(name, CRUISE_REGION_MARQUEE[regionLabel] || null),
      country: null,
      nights: Number(row[idx.nights]) || null,
      startDate: row[idx.start] || null,
      month: ym(row[idx.start]),
      bookUrl,
    };
  });
}

async function buildJet() {
  const j = await (await fetch(SOURCES.jet)).json();
  return (j.TRIPS || []).map((t, i) => {
    const tag = (t.g && t.g[0]) || null;
    const regionLabel = tag ? (JET_REGION_NAME[tag] || tag) : null;
    return {
      id: `jt_${i}_${(t.n || "").slice(0, 8)}`,
      type: "jet",
      name: t.n,
      operator: JET_BRAND[t.b] || t.b || null,
      brand: JET_BRAND[t.b] || t.b || null,
      regionLabel,
      region: marqueeFromText(`${t.n} ${regionLabel || ""}`, JET_REGION_MARQUEE[tag] || null),
      country: null,
      startDate: t.d || null,
      endDate: t.r || null,
      month: ym(t.d),
      bookUrl: t.u || ATLAS_URL.jet,
    };
  });
}

async function buildYacht() {
  const j = await (await fetch(SOURCES.yacht)).json();
  return (j.TRIPS || []).map((t) => {
    const tag = (t.g && t.g[0]) || null;
    const regionLabel = tag ? (YACHT_REGION_NAME[tag] || tag) : null;
    return {
      id: `yc_${t.id}`,
      type: "yacht",
      name: t.title,
      operator: YACHT_BRAND[t.brand] || t.brand || null,
      brand: YACHT_BRAND[t.brand] || t.brand || null,
      ship: t.ship || null,
      regionLabel,
      region: marqueeFromText(`${t.title} ${regionLabel || ""}`, YACHT_REGION_MARQUEE[tag] || null),
      country: countryOf(t.to) || countryOf(t.from) || null,
      from: t.from || null,
      to: t.to || null,
      route: t.route || null,
      startDate: t.dates || null,
      month: t.monthKey || ym(t.dates),
      bookUrl: t.u || ATLAS_URL.yacht,
    };
  });
}

const BUILDERS = { cruise: buildCruise, jet: buildJet, yacht: buildYacht };

async function recordsFor(type, fetchImpl) {
  if (fetchImpl && fetchImpl !== globalThis.fetch) {
    // tests can inject fetch; bypass cache so they stay deterministic
    return BUILDERS[type] ? BUILDERS[type](fetchImpl) : [];
  }
  const now = Date.now();
  const c = CACHE[type];
  if (!c || now - c.at > TTL) {
    CACHE[type] = { records: await BUILDERS[type](), at: now };
  }
  return CACHE[type].records;
}

// ── filtering ────────────────────────────────────────────────────────────────
function searchableBlob(r) {
  return [r.name, r.operator, r.brand, r.ship, r.regionLabel, r.country, r.route, r.from, r.to]
    .filter(Boolean).join(" ").toLowerCase();
}

function applyFilters(records, input) {
  const q = (input.q || "").toLowerCase().trim();
  const region = (input.region || "").toLowerCase().trim();
  const country = (input.country || "").toLowerCase().trim();
  const month = (input.month || "").trim();
  return records.filter((r) => {
    if (region && MARQUEE.has(region) && r.region !== region) return false;
    if (month && r.month !== month) return false;
    const blob = searchableBlob(r);
    if (country && !blob.includes(country)) return false;
    if (q && !blob.includes(q)) return false;
    return true;
  });
}

function chartRegionFrom(inputRegion, results) {
  const r = (inputRegion || "").toLowerCase().trim();
  if (MARQUEE.has(r)) return r;
  const tally = {};
  for (const x of results) if (x.region && MARQUEE.has(x.region)) tally[x.region] = (tally[x.region] || 0) + 1;
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

function deepLinkFor(type, input) {
  const base = ATLAS_URL[type];
  const region = (input.region || "").toLowerCase().trim();
  return MARQUEE.has(region) ? `${base}?region=${encodeURIComponent(region)}` : base;
}

// ── public API ───────────────────────────────────────────────────────────────
// queryOfferings({ type, q, region, country, month, limit }, { fetchImpl })
//   -> { type, total, count, results, deepLink, chartRegion }
export async function queryOfferings(input = {}, opts = {}) {
  const type = String(input.type || "").toLowerCase();
  if (!BUILDERS[type]) {
    return { type, total: 0, count: 0, results: [], deepLink: null, chartRegion: null };
  }
  let limit = parseInt(input.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 6;
  if (limit > 24) limit = 24;

  const all = await recordsFor(type, opts.fetchImpl);
  const matched = applyFilters(all, input);
  const results = matched.slice(0, limit);

  return {
    type,
    total: matched.length,
    count: results.length,
    results,
    deepLink: deepLinkFor(type, input),
    chartRegion: chartRegionFrom(input.region, matched),
  };
}

export { MARQUEE, chartRegionFrom, ym, marqueeFromText };

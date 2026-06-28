// lib/journeys.js — Private Jet Atlas query layer
// Shared in-memory query over the jet TRIPS feed, mirroring the Hotel Atlas
// lib/hotels.js contract so the concierge can query jet journeys like hotels.
// Pure functions, one-time JSON load, unit-testable without an HTTP server.

const raw = require("../../data/atlas/jet/itinerary.json");
const itineraryFit = require("../../data/atlas/shared/itinerary-fit.json");
const { rankItems } = require("./supplier-fit");

const ATLAS_URL =
  process.env.ATLAS_JET_URL || "/maps/jet";

const ci = (s) => String(s == null ? "" : s).toLowerCase().trim();
const norm = (s) => ci(s)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const intentKey = (raw) => {
  const key = norm(raw);
  const aliases = {
    adventure: "active",
    culinary: "foodie",
    first: "first-timer",
    firsttimer: "first-timer",
    "first timer": "first-timer",
    private: "uhnw",
    simple: "first-timer",
    simplevip: "first-timer",
    spa: "wellness",
    vip: "uhnw",
  };
  return aliases[key] || key || null;
};

const Q_STOPWORDS = new Set([
  "in", "the", "of", "at", "on", "a", "an", "and", "to", "for", "near", "or", "by",
  "jet", "jets", "private", "journey", "journeys", "expedition", "expeditions",
  "tour", "tours", "trip", "trips", "flight", "flights",
]);

const MARQUEE = new Set([
  "antarctica", "arctic", "galapagos", "amazon", "polynesia",
  "patagonia", "kimberley", "mediterranean", "norway", "japan", "namibia",
]);
const MARQUEE_CENTER = {
  antarctica: [0, -71], arctic: [18, 79], galapagos: [-90.5, -0.7],
  amazon: [-60, -3], polynesia: [-149.4, -17.6], patagonia: [-72, -49],
  kimberley: [126, -16], mediterranean: [14, 39], norway: [10, 65],
  japan: [138, 37], namibia: [16, -22],
};

// Jet region tag -> marquee key.
const REGION_MARQUEE = {
  ANTARCTICA: "antarctica", AURORA: "arctic", POLY: "polynesia",
  EASTASIA: "japan", SAM: "amazon",
};
const KEYWORDS = [
  ["antarctica", "antarctica"], ["galápagos", "galapagos"], ["galapagos", "galapagos"],
  ["amazon", "amazon"], ["patagonia", "patagonia"], ["kimberley", "kimberley"],
  ["namibia", "namibia"], ["norway", "norway"], ["iceland", "arctic"],
  ["aurora", "arctic"], ["tahiti", "polynesia"], ["japan", "japan"],
];
function marqueeFor(tag, name, regionLabel) {
  const t = `${ci(name)} ${ci(regionLabel)}`;
  for (const [kw, key] of KEYWORDS) if (t.includes(kw)) return key;
  return REGION_MARQUEE[tag] || null;
}

const BRANDS = raw.BRANDS || {};
const REGIONS = raw.REGIONS || {};
const brandName = (b) => (BRANDS[b] && BRANDS[b].short) || b || null;
const regionName = (tag) => (REGIONS[tag] && REGIONS[tag].name) || tag || null;

// "6/16/2026" -> "2026-06"
function ym(d) {
  const m = String(d || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, "0")}`;
  const m2 = String(d || "").match(/^(\d{4})-(\d{2})/);
  return m2 ? `${m2[1]}-${m2[2]}` : null;
}

// --- normalize TRIPS -> records --------------------------------------------
const journeys = (raw.TRIPS || []).map((t, i) => {
  const tag = (t.g && t.g[0]) || null;
  const regionLabel = tag ? regionName(tag) : null;
  return {
    id: `jt_${i}`,
    type: "jet",
    name: t.n,
    operator: brandName(t.b),
    brand: brandName(t.b),
    regionLabel,
    region: marqueeFor(tag, t.n, regionLabel),
    country: null,
    startDate: t.d || null,
    endDate: t.r || null,
    month: ym(t.d),
    route: t.route || null,
    days: t.days || (Array.isArray(t.itin) ? t.itin.length : null),
    itinerary: Array.isArray(t.itin) ? t.itin : null,
    world: !!t.world,
    bookUrl: t.u || ATLAS_URL,
  };
});

// --- filtering -------------------------------------------------------------
function truthy(raw) {
  return /^(1|true|yes|y)$/i.test(String(raw == null ? "" : raw).trim());
}

function filterJourneys(params = {}) {
  const { q, region, country, month, brand, ids, world } = params;
  let list = journeys;

  if (ids != null && String(ids).trim() !== "") {
    const set = new Set(String(ids).split(",").map((s) => s.trim()).filter(Boolean));
    list = list.filter((j) => set.has(j.id));
  }
  if (truthy(world)) list = list.filter((j) => j.world);
  if (region) { const v = ci(region); if (MARQUEE.has(v)) list = list.filter((j) => j.region === v); }
  if (brand) { const v = ci(brand); list = list.filter((j) => ci(j.brand) === v); }
  if (month) { const v = String(month).trim(); list = list.filter((j) => j.month === v); }

  const hay = (j) => `${ci(j.name)} ${ci(j.brand)} ${ci(j.regionLabel)}`;
  if (country != null && String(country).trim() !== "") {
    const v = ci(country); list = list.filter((j) => hay(j).includes(v));
  }
  if (q != null && String(q).trim() !== "") {
    const tokens = ci(q).split(/\s+/).filter((t) => t && !Q_STOPWORDS.has(t));
    if (tokens.length) list = list.filter((j) => tokens.every((t) => hay(j).includes(t)));
  }
  return list;
}

function fitFor(j) {
  return itineraryFit[j.id] || null;
}

function fitScore(j, intent) {
  const key = intentKey(intent);
  const row = key && fitFor(j);
  const value = row && row.guestFit && row.guestFit[key];
  return Number.isFinite(value) ? value : null;
}

function withFit(j, intent) {
  const key = intentKey(intent);
  if (!key) return j;
  const row = fitFor(j);
  const value = row && row.guestFit && row.guestFit[key];
  if (!Number.isFinite(value)) return j;
  return {
    ...j,
    fit: {
      intent: key,
      score: value,
      attributes: row.attributes || {},
      advisorNote: row.advisorNote || null,
    },
  };
}

function sortForIntent(list, intent) {
  const key = intentKey(intent);
  if (!key) return list;
  return [...list].sort((a, b) =>
    ((fitScore(b, key) ?? -1) - (fitScore(a, key) ?? -1)) ||
    String(a.month || "").localeCompare(String(b.month || "")) ||
    String(a.name || "").localeCompare(String(b.name || "")));
}

function clampLimit(rawN) { let n = parseInt(rawN, 10); if (!Number.isFinite(n) || n <= 0) n = 6; if (n > 24) n = 24; return n; }
function clampOffset(rawN) { let n = parseInt(rawN, 10); if (!Number.isFinite(n) || n < 0) n = 0; return n; }

function buildDeepLink(params = {}) {
  const usp = new URLSearchParams();
  for (const k of ["region", "country", "brand", "month", "q", "world", "ids", "intent"]) {
    const val = params[k];
    if (val != null && String(val).trim() !== "") usp.set(k, String(val).trim());
  }
  const qs = usp.toString();
  return qs ? `${ATLAS_URL}?${qs}` : ATLAS_URL;
}

function regions() {
  const tally = {};
  for (const j of journeys) if (j.region && MARQUEE.has(j.region)) tally[j.region] = (tally[j.region] || 0) + 1;
  const out = Object.keys(tally).map((region) => ({
    region, count: tally[region], center: MARQUEE_CENTER[region] || null,
    deepLink: buildDeepLink({ region }),
  })).sort((a, b) => b.count - a.count);
  const total = out.reduce((n, r) => n + r.count, 0);
  return { total, count: out.length, regions: out };
}

function query(params = {}) {
  const matched = rankItems(filterJourneys(params), params.intent, {
    getBrandLabel: (j) => j.brand || j.operator,
    getName: (j) => j.name,
    allowAvoid: params.ids != null && String(params.ids).trim() !== "",
  });
  const total = matched.length;
  const limit = clampLimit(params.limit);
  const offset = clampOffset(params.offset);
  const results = matched.slice(offset, offset + limit);
  return { total, count: results.length, results, deepLink: buildDeepLink(params) };
}

module.exports = {
  journeys, filterJourneys, clampLimit, clampOffset, buildDeepLink, query, regions,
  MARQUEE, ATLAS_URL,
};

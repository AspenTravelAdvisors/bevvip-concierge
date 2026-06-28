// lib/sailings.js — Luxury Yacht Atlas query layer
// Shared in-memory query over the yacht TRIPS feed, mirroring the Hotel Atlas
// lib/hotels.js contract so the concierge can query yacht sailings like hotels.
// Pure functions, one-time JSON load, unit-testable without an HTTP server.

const raw = require("../../data/atlas/yacht/itinerary.json");
const itineraryFit = require("../../data/atlas/shared/itinerary-fit.json");
const { rankItems } = require("./supplier-fit");

const ATLAS_URL =
  process.env.ATLAS_YACHT_URL || "/maps/yacht";

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
  "yacht", "yachts", "sailing", "sailings", "cruise", "cruises", "voyage",
  "voyages", "ship", "trip", "trips",
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

// Yacht region tag -> marquee key.
const REGION_MARQUEE = {
  MED: "mediterranean", CENTRALMED: "mediterranean",
  ADRIATIC: "mediterranean", AEGEAN: "mediterranean",
  POLY: "polynesia", EASTASIA: "japan",
};
const KEYWORDS = [
  ["galápagos", "galapagos"], ["galapagos", "galapagos"], ["norway", "norway"],
  ["tahiti", "polynesia"], ["japan", "japan"], ["mediterranean", "mediterranean"],
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

// "Lisbon, Portugal" -> "Portugal"
function countryOf(place) {
  const parts = String(place || "").split(",");
  return parts.length > 1 ? parts[parts.length - 1].trim() : "";
}

// Every named port of call on the itinerary, in sailing order, deduped.
// A sailing that embarks in Monaco and disembarks in Spain can still spend
// most of its days in Italian ports; without this, country/q matching only
// sees the endpoints and misses those days entirely.
function portsOf(t) {
  const seen = new Set();
  const ports = [];
  for (const stop of t.itin || []) {
    const name = String(stop && stop.n || "").trim();
    if (!name || seen.has(ci(name))) continue;
    seen.add(ci(name));
    ports.push(name);
  }
  return ports;
}

// --- normalize TRIPS -> records --------------------------------------------
const sailings = (raw.TRIPS || []).map((t) => {
  const tag = (t.g && t.g[0]) || null;
  const regionLabel = tag ? regionName(tag) : null;
  const ports = portsOf(t);
  const portCountries = [...new Set(ports.map(countryOf).filter(Boolean))];
  return {
    id: `yc_${t.id}`,
    type: "yacht",
    name: t.title,
    operator: brandName(t.brand),
    brand: brandName(t.brand),
    ship: t.ship || null,
    regionLabel,
    region: marqueeFor(tag, t.title, regionLabel),
    country: countryOf(t.to) || countryOf(t.from) || null,
    countries: portCountries,
    from: t.from || null,
    to: t.to || null,
    route: t.route || null,
    ports,
    startDate: t.dates || null,
    month: t.monthKey || null,
    bookUrl: t.u || ATLAS_URL,
  };
});

// --- filtering -------------------------------------------------------------
function filterSailings(params = {}) {
  const { q, region, country, month, brand, ids } = params;
  let list = sailings;

  if (ids != null && String(ids).trim() !== "") {
    const set = new Set(String(ids).split(",").map((s) => s.trim()).filter(Boolean));
    list = list.filter((s) => set.has(s.id));
  }
  if (region) { const v = ci(region); if (MARQUEE.has(v)) list = list.filter((s) => s.region === v); }
  if (brand) { const v = ci(brand); list = list.filter((s) => ci(s.brand) === v); }
  if (month) { const v = String(month).trim(); list = list.filter((s) => s.month === v); }

  const hay = (s) => `${ci(s.name)} ${ci(s.brand)} ${ci(s.ship)} ${ci(s.regionLabel)} ${ci(s.route)} ${ci(s.from)} ${ci(s.to)} ${(s.ports || []).map(ci).join(" ")}`;
  if (country != null && String(country).trim() !== "") {
    const v = ci(country); list = list.filter((s) => hay(s).includes(v));
  }
  if (q != null && String(q).trim() !== "") {
    const tokens = ci(q).split(/\s+/).filter((t) => t && !Q_STOPWORDS.has(t));
    if (tokens.length) list = list.filter((s) => tokens.every((t) => hay(s).includes(t)));
  }
  return list;
}

function fitFor(s) {
  return itineraryFit[s.id] || null;
}

function fitScore(s, intent) {
  const key = intentKey(intent);
  const row = key && fitFor(s);
  const value = row && row.guestFit && row.guestFit[key];
  return Number.isFinite(value) ? value : null;
}

function withFit(s, intent) {
  const key = intentKey(intent);
  if (!key) return s;
  const row = fitFor(s);
  const value = row && row.guestFit && row.guestFit[key];
  if (!Number.isFinite(value)) return s;
  return {
    ...s,
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
  for (const k of ["region", "country", "brand", "month", "q", "intent"]) {
    const val = params[k];
    if (val != null && String(val).trim() !== "") usp.set(k, String(val).trim());
  }
  const qs = usp.toString();
  return qs ? `${ATLAS_URL}?${qs}` : ATLAS_URL;
}

function regions() {
  const tally = {};
  for (const s of sailings) if (s.region && MARQUEE.has(s.region)) tally[s.region] = (tally[s.region] || 0) + 1;
  const out = Object.keys(tally).map((region) => ({
    region, count: tally[region], center: MARQUEE_CENTER[region] || null,
    deepLink: buildDeepLink({ region }),
  })).sort((a, b) => b.count - a.count);
  const total = out.reduce((n, r) => n + r.count, 0);
  return { total, count: out.length, regions: out };
}

function query(params = {}) {
  const matched = rankItems(filterSailings(params), params.intent, {
    getBrandLabel: (s) => s.brand || s.operator,
    getName: (s) => s.name,
    allowAvoid: params.ids != null && String(params.ids).trim() !== "",
  });
  const total = matched.length;
  const limit = clampLimit(params.limit);
  const offset = clampOffset(params.offset);
  const results = matched.slice(offset, offset + limit);
  return { total, count: results.length, results, deepLink: buildDeepLink(params) };
}

module.exports = {
  sailings, filterSailings, clampLimit, clampOffset, buildDeepLink, query, regions,
  MARQUEE, ATLAS_URL,
};

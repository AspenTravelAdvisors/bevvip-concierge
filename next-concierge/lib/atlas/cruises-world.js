// lib/cruises.js — World Cruise Atlas query layer
// Shared in-memory query over the world-cruise TRIPS feed, mirroring the
// Yacht Atlas lib/sailings.js contract so the concierge can query world
// cruises the same way: { total, count, results, deepLink }.
// Pure functions, one-time JSON load, unit-testable without an HTTP server.

const raw = require("../../data/atlas/world/itinerary.json");
const itineraryFit = require("../../data/atlas/shared/itinerary-fit.json");
const { rankItems } = require("./supplier-fit");

const ATLAS_URL =
  process.env.ATLAS_WORLD_CRUISE_URL || "/maps/worldcruise";

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
  "cruise", "cruises", "cruising", "sailing", "sailings", "voyage", "voyages",
  "ship", "trip", "trips", "world", "grand",
]);

const BRANDS = raw.BRANDS || {};
const REGIONS = raw.REGIONS || {};
const PORTS = raw.PORTS || {};
const brandName = (b) => (BRANDS[b] && BRANDS[b].short) || b || null;
const regionName = (tag) => (REGIONS[tag] && REGIONS[tag].name) || tag || null;

// Concierge marquee region keys -> the world-cruise region tag whose ports
// answer that ask. Marquee keys with no meaningful world-cruise coverage
// (galapagos, amazon, kimberley, namibia, patagonia) fall back to q matching.
const MARQUEE_TO_TAG = {
  mediterranean: "MED",
  japan: "EASTASIA",
  norway: "NEUROPE",
  arctic: "NATL",
  antarctica: "ANTARCTIC",
  polynesia: "PACIFIC",
  // common non-marquee asks the concierge would otherwise have to drop
  caribbean: "CARIB",
  bermuda: "CARIB",
  alaska: "NAMWEST",
  hawaii: "HAWAII",
  tahiti: "PACIFIC",
  "south pacific": "PACIFIC",
  fiji: "PACIFIC",
  baltic: "NEUROPE",
  iceland: "NATL",
  greenland: "NATL",
  "panama canal": "CAMER",
  panama: "CAMER",
  "south america": "SAMER",
  patagonia: "SAMER",
  amazon: "SAMER",
  australia: "AUNZ",
  "new zealand": "AUNZ",
  "middle east": "MIDEAST",
  arabia: "MIDEAST",
  "red sea": "MIDEAST",
  india: "INDIA",
  "southeast asia": "SEASIA",
  asia: "SEASIA",
  africa: "SAFRICA",
};

function regionTagFor(rawRegion) {
  const v = ci(rawRegion);
  if (!v) return null;
  if (MARQUEE_TO_TAG[v]) return MARQUEE_TO_TAG[v];
  const upper = String(rawRegion).trim().toUpperCase();
  if (REGIONS[upper]) return upper;
  // full region names and abbreviations ("Caribbean & Bermuda", "S. Pacific")
  for (const [tag, r] of Object.entries(REGIONS)) {
    if (ci(r.name) === v || ci(r.ab) === v) return tag;
  }
  return null;
}

// "Lisbon, Portugal" -> "Portugal"; "Miami, FL, United States" -> "United States"
function countryOf(place) {
  const parts = String(place || "").split(",");
  return parts.length > 1 ? parts[parts.length - 1].trim() : "";
}

// Every named port of call on the itinerary, in sailing order, deduped.
// A world cruise embarks and disembarks in the same city or two, but spends
// half a year elsewhere; country/q matching has to see every port day.
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
const cruises = (raw.TRIPS || []).map((t) => {
  const ports = portsOf(t);
  const portCountries = [...new Set(ports.map(countryOf).filter(Boolean))];
  const regionLabels = (t.g || []).map(regionName).filter(Boolean);
  const embark = PORTS[ports[0]] || null; // [lat, lng] of the embarkation port
  return {
    id: `wc_${t.id}`,
    type: "worldcruise",
    name: t.title,
    operator: brandName(t.brand),
    brand: brandName(t.brand),
    ship: t.ship || null,
    days: t.days || null,
    regionLabel: regionLabels.slice(0, 4).join(" · ") || null,
    regions: regionLabels,
    regionTags: t.g || [],
    region: null, // a world cruise has no single marquee region
    country: countryOf(t.to) || countryOf(t.from) || null,
    countries: portCountries,
    from: t.from || null,
    to: t.to || null,
    route: t.route || null,
    ports,
    portCount: ports.length,
    startDate: t.dates || null,
    month: t.monthKey || null,
    lat: embark ? embark[0] : null,
    lng: embark ? embark[1] : null,
    bookUrl: t.u || ATLAS_URL,
  };
});

// --- filtering -------------------------------------------------------------
function filterCruises(params = {}) {
  const { q, region, country, month, brand, operator, ids, minDays, maxDays } = params;
  let list = cruises;

  if (ids != null && String(ids).trim() !== "") {
    const set = new Set(String(ids).split(",").map((s) => s.trim()).filter(Boolean));
    list = list.filter((s) => set.has(s.id));
  }
  const tag = regionTagFor(region);
  if (tag) list = list.filter((s) => s.regionTags.includes(tag));
  const brandV = ci(brand || operator);
  if (brandV) list = list.filter((s) => ci(s.brand) === brandV);
  if (month) { const v = String(month).trim(); list = list.filter((s) => s.month === v); }
  const minD = parseInt(minDays, 10);
  if (Number.isFinite(minD)) list = list.filter((s) => (s.days || 0) >= minD);
  const maxD = parseInt(maxDays, 10);
  if (Number.isFinite(maxD)) list = list.filter((s) => (s.days || 0) <= maxD);

  const hay = (s) => `${ci(s.name)} ${ci(s.brand)} ${ci(s.ship)} ${s.regions.map(ci).join(" ")} ${ci(s.route)} ${ci(s.from)} ${ci(s.to)} ${(s.ports || []).map(ci).join(" ")}`;
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
  if (!key) {
    return list.slice().sort((a, b) =>
      String(a.month || "").localeCompare(String(b.month || "")) ||
      String(a.name).localeCompare(String(b.name)));
  }
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

// Region tally for the Living Atlas pins. Every region a cruise calls in
// counts it once, so the pins read "world cruises calling here".
function regions() {
  const tally = {};
  for (const s of cruises) for (const tag of s.regionTags) tally[tag] = (tally[tag] || 0) + 1;
  const out = Object.keys(tally).map((tag) => {
    const r = REGIONS[tag] || {};
    return {
      region: tag,
      name: r.name || tag,
      count: tally[tag],
      center: Array.isArray(r.coord) ? [r.coord[1], r.coord[0]] : null, // [lng,lat]
      deepLink: buildDeepLink({ region: tag }),
    };
  }).sort((a, b) => b.count - a.count);
  const total = cruises.length;
  return { total, count: out.length, regions: out };
}

function query(params = {}) {
  const matched = filterCruises(params);
  const total = matched.length;
  const limit = clampLimit(params.limit);
  const offset = clampOffset(params.offset);
  const sorted = params.intent
    ? rankItems(matched, params.intent, {
      getBrandLabel: (s) => s.brand || s.operator,
      getName: (s) => s.name,
      allowAvoid: params.ids != null && String(params.ids).trim() !== "",
    })
    : sortForIntent(matched, params.intent);
  const results = sorted.slice(offset, offset + limit);
  return { total, count: results.length, results, deepLink: buildDeepLink(params) };
}

module.exports = {
  cruises, filterCruises, clampLimit, clampOffset, buildDeepLink, query, regions,
  regionTagFor, ATLAS_URL,
};

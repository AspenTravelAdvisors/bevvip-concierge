// lib/trains.js — Rail Journeys Atlas query layer
// Shared in-memory query over the train TRIPS feed, mirroring lib/journeys.js
// (jet) so the concierge can query rail journeys like every other pillar.
// Pure functions, one-time JSON load, unit-testable without an HTTP server.

const raw = require("../../data/atlas/train/itinerary.json");
const itineraryFit = require("../../data/atlas/shared/itinerary-fit.json");
const { rankItems } = require("./supplier-fit");

const ATLAS_URL =
  process.env.ATLAS_TRAIN_URL || "/maps/train";

const ci = (s) => String(s == null ? "" : s).toLowerCase().trim();
const intentKey = (rawIntent) => {
  const key = ci(rawIntent).replace(/[^a-z0-9-]+/g, "");
  const aliases = {
    adventure: "active",
    culinary: "foodie",
    firsttimer: "first-timer",
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
  "rail", "train", "trains", "railway", "railways", "journey", "journeys",
  "tour", "tours", "trip", "trips", "luxury", "scenic",
]);

// Marquee keys the Living Atlas can plot; the build stamps `mq` on the trips
// whose geography genuinely maps to one (japan / norway / alaska today).
const MARQUEE = new Set(["japan", "norway", "alaska"]);
const MARQUEE_CENTER = {
  japan: [138, 37], norway: [10, 65], alaska: [-149, 60.5],
};

// Train-atlas region words -> the atlas's own g[] keys, so a region= value the
// marquee set doesn't cover (scotland, switzerland, the Rockies) still filters
// instead of silently broadening. The map page resolves the same aliases.
const ATLAS_REGION_ALIASES = {
  britain: "BRITAIN", scotland: "BRITAIN", uk: "BRITAIN", unitedkingdom: "BRITAIN",
  england: "BRITAIN", wales: "BRITAIN", ireland: "BRITAIN",
  europe: "EUROPE", alps: "EUROPE", switzerland: "EUROPE", italy: "EUROPE",
  nordics: "NORDICS", scandinavia: "NORDICS",
  eastasia: "EASTASIA", korea: "EASTASIA", asia: "EASTASIA",
  seasia: "SEASIA", southeastasia: "SEASIA", malaysia: "SEASIA", singapore: "SEASIA",
  indonesia: "SEASIA",
  india: "INDIA",
  africa: "AFRICA", southafrica: "AFRICA",
  sam: "SAM", southamerica: "SAM", peru: "SAM", andes: "SAM",
  americas: "AMERICAS", us: "AMERICAS", usa: "AMERICAS", unitedstates: "AMERICAS",
  america: "AMERICAS", americanwest: "AMERICAS",
  canada: "CANADA", rockies: "CANADA", canadianrockies: "CANADA",
  anz: "ANZ", australia: "ANZ", newzealand: "ANZ",
};
const regionAliasKey = (v) => ATLAS_REGION_ALIASES[ci(v).replace(/[^a-z0-9]+/g, "")] || null;

// Searchable words for each region tag, so free text like "scotland" or
// "the Rockies" matches the trips it plainly describes instead of zeroing.
const REGION_HAY = {
  BRITAIN: "great britain ireland scotland england wales uk united kingdom",
  EUROPE: "europe continental switzerland italy france germany austria hungary romania poland portugal spain turkey alps",
  NORDICS: "scandinavia nordics norway sweden denmark finland",
  EASTASIA: "japan korea east asia",
  SEASIA: "southeast asia singapore malaysia indonesia myanmar",
  INDIA: "india south asia",
  AFRICA: "africa south africa zimbabwe",
  SAM: "south america peru andes",
  AMERICAS: "united states us usa america american west alaska colorado utah",
  CANADA: "canada canadian rockies",
  ANZ: "australia new zealand",
};

const BRANDS = raw.BRANDS || {};
const REGIONS = raw.REGIONS || {};
const brandName = (b) => (BRANDS[b] && BRANDS[b].short) || b || null;
const regionName = (tag) => (REGIONS[tag] && REGIONS[tag].name) || tag || null;

// "7/20/2026" -> "2026-07-20"
function isoFromMdy(d) {
  const m = String(d || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}
const ym = (iso) => (iso ? iso.slice(0, 7) : null);

// --- normalize TRIPS -> records --------------------------------------------
const journeys = (raw.TRIPS || []).map((t) => {
  const tag = (t.g && t.g[0]) || null;
  const startDate = isoFromMdy(t.d);
  const stops = (t.itin || []).map((e) => e.n).filter(Boolean)
    .filter((n, i, a) => !i || a[i - 1] !== n);
  return {
    id: `rj_${t.id}`,
    type: "train",
    name: t.n,
    operator: brandName(t.b),
    brand: brandName(t.b),
    train: t.train || null,          // named train (Royal Scotsman, VSOE, ...)
    legendary: !!t.world,
    regionLabel: tag ? regionName(tag) : null,
    regionTags: t.g || [],
    region: MARQUEE.has(t.mq) ? t.mq : null,
    country: t.country || null,
    from: t.from || null,
    to: t.to || null,
    stops,
    startDate,
    endDate: isoFromMdy(t.r),
    month: ym(startDate),
    months: t.mks || [],             // every future departure month
    departures: t.depCount || (startDate ? 1 : 0),
    onDemand: !!t.onDemand,
    window: t.win || null,
    route: t.route || null,
    days: t.days || (Array.isArray(t.itin) ? t.itin.length : null),
    itinerary: Array.isArray(t.itin) ? t.itin : null,
    world: !!t.world,                // legendary named trains ride the world flag
    image: t.img || null,
    bookUrl: t.u || ATLAS_URL,
  };
});

// --- filtering -------------------------------------------------------------
function truthy(rawV) {
  return /^(1|true|yes|y)$/i.test(String(rawV == null ? "" : rawV).trim());
}

function filterJourneys(params = {}) {
  const { q, region, country, month, year, brand, ids, world } = params;
  let list = journeys;

  if (ids != null && String(ids).trim() !== "") {
    const set = new Set(String(ids).split(",").map((s) => s.trim()).filter(Boolean));
    list = list.filter((j) => set.has(j.id) || set.has(j.id.replace(/^rj_/, "")));
  }
  if (truthy(world)) list = list.filter((j) => j.legendary);
  if (region) {
    const v = ci(region);
    if (MARQUEE.has(v)) list = list.filter((j) => j.region === v);
    else {
      const tag = regionAliasKey(v) || (REGIONS[String(region).trim().toUpperCase()] ? String(region).trim().toUpperCase() : null);
      if (tag) list = list.filter((j) => j.regionTags.includes(tag));
    }
  }
  if (brand) {
    const v = ci(brand);
    list = list.filter((j) => ci(j.brand) === v || ci(j.train) === v);
  }
  if (month) {
    const v = String(month).trim();
    list = list.filter((j) => j.onDemand || j.month === v || j.months.includes(v));
  }
  if (year) {
    const v = String(year).trim();
    list = list.filter((j) => j.onDemand || j.months.some((k) => k.startsWith(v)));
  }

  const hay = (j) => [
    j.name, j.brand, j.train, j.regionLabel, j.country, j.from, j.to,
    j.stops.join(" "),
    j.regionTags.map((tag) => REGION_HAY[tag] || "").join(" "),
  ].map(ci).join(" ");
  // Whole-word matching: "peru" must not match Perugia, "rail" not Braila.
  const hasWord = (text, term) =>
    new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  if (country != null && String(country).trim() !== "") {
    const v = ci(country); list = list.filter((j) => hasWord(hay(j), v));
  }
  if (q != null && String(q).trim() !== "") {
    const tokens = ci(q).split(/\s+/).filter((t) => t && !Q_STOPWORDS.has(t));
    if (tokens.length) list = list.filter((j) => tokens.every((t) => hasWord(hay(j), t)));
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

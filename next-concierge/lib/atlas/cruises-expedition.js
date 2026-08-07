// lib/cruises.js — Expedition Cruise Atlas query layer
// Shared in-memory query over the sailings feed, mirroring the Hotel Atlas
// lib/hotels.js contract so the concierge can query cruises exactly like hotels.
// Pure functions, one-time JSON load, unit-testable without an HTTP server.
//
// Lives outside api/ on purpose: anything under api/ becomes a Vercel route.
// Source of truth stays sailings.json (the same feed the globe loads); this
// layer normalizes each sailing, maps its region onto a marquee key, and
// supports q / region / country / month filtering + pagination + a deep link.

const raw = require("../../data/atlas/cruise/sailings.json");
const meta = require("../../data/atlas/cruise/atlas-meta.json");
// Geographic region correction — see correctedRegionName(). Stored grouped by
// region name (an id costs 11 bytes, a repeated region name thirty), inverted
// here into the id → region lookup the normalizer wants.
const REGION_BY_ID = (() => {
  const byRegion = require("../../data/atlas/cruise/region-overrides.json").byRegion || {};
  const out = {};
  for (const [region, ids] of Object.entries(byRegion)) for (const id of ids) out[id] = region;
  return out;
})();
const itineraryFit = require("../../data/atlas/shared/itinerary-fit.json");
const { rankItems } = require("./supplier-fit");
const { dropPast, isPast, todayISO, sortOfferings, compareByDeparture } = require("./dates");

const ATLAS_URL =
  process.env.ATLAS_CRUISE_URL || "/maps/cruise";

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

// Connector + genre words dropped from free-text `q` so "alaska expedition
// cruises" matches on "alaska" rather than failing on the genre nouns.
const Q_STOPWORDS = new Set([
  "in", "the", "of", "at", "on", "a", "an", "and", "to", "for", "near", "or", "by",
  "cruise", "cruises", "expedition", "expeditions", "sailing", "sailings",
  "voyage", "voyages", "ship", "trip", "trips",
]);

// Non-marquee cruise regions that should still bind when the concierge or a
// deep link sends them as `region`. These are not Living Atlas chart keys, but
// they are real cruise atlas regions/destinations.
const REGION_SEARCH_ALIASES = {
  "alaska": { labels: ["alaska & yukon"], terms: ["alaska"] },
  "alaska and yukon": { labels: ["alaska & yukon"], terms: ["alaska"] },
  "yukon": { labels: ["alaska & yukon"], terms: ["yukon"] },
  "caribbean": { labels: ["caribbean & bermuda"], terms: ["caribbean"], requireLabel: true },
  "caribbean and bermuda": { labels: ["caribbean & bermuda"], terms: ["caribbean", "bermuda"], requireLabel: true },
  "bermuda": { labels: ["caribbean & bermuda"], terms: ["bermuda"], requireLabel: true },
  "baja": { labels: [], terms: ["baja"] },
  "baja california": { labels: [], terms: ["baja"] },
  "sea of cortez": { labels: [], terms: ["sea of cortez"] },
  "sea cortez": { labels: [], terms: ["sea of cortez"] },
  "seychelles": { labels: ["africa & indian ocean"], terms: ["seychelles"], requireLabel: true },
  "the seychelles": { labels: ["africa & indian ocean"], terms: ["seychelles"], requireLabel: true },
  "british isles": { labels: ["northern europe & british isles"], terms: ["british isles"], requireLabel: true },
  "northern europe": { labels: ["northern europe & british isles"], terms: ["northern europe"], requireLabel: true },
  "northern europe and british isles": { labels: ["northern europe & british isles"], terms: ["british isles"], requireLabel: true },
  // Regions the corrected overlay introduced (see correctedRegionName).
  "chile": { labels: ["patagonia and chilean fjords"], terms: ["chile", "chilean"] },
  "chilean fjords": { labels: ["patagonia and chilean fjords"], terms: ["chilean fjord"] },
  // Iceland, Greenland and Svalbard all sit inside the Arctic label, so these
  // require the label AND the place — otherwise "iceland" would return every
  // Svalbard sailing in the atlas.
  "iceland": { labels: ["arctic"], terms: ["iceland"], requireLabel: true },
  "greenland": { labels: ["arctic"], terms: ["greenland"], requireLabel: true },
  "svalbard": { labels: ["arctic"], terms: ["svalbard", "spitsbergen"], requireLabel: true },
  "spitsbergen": { labels: ["arctic"], terms: ["svalbard", "spitsbergen"], requireLabel: true },
  "northwest passage": { labels: ["northwest passage"], terms: [] },
  "western europe": { labels: ["western europe and iberia"], terms: [] },
  "iberia": { labels: ["western europe and iberia"], terms: [] },
  "portugal": { labels: ["western europe and iberia"], terms: ["portugal", "lisbon", "porto", "iberian"], requireLabel: true },
};

function nonMarqueeRegionMatcher(raw) {
  const alias = REGION_SEARCH_ALIASES[norm(raw)];
  if (!alias) return null;
  const labels = (alias.labels || []).map(norm).filter(Boolean);
  const terms = (alias.terms || []).map(norm).filter(Boolean);
  return (c) => {
    const label = norm(c.regionLabel);
    const hay = norm(`${c.name} ${c.operator} ${c.regionLabel}`);
    if (alias.requireLabel) {
      return labels.includes(label) && (!terms.length || terms.some((term) => hay.includes(term)));
    }
    return labels.includes(label) || terms.some((term) => hay.includes(term));
  };
}

// Marquee region keys the Living Atlas can plot.
const MARQUEE = new Set([
  "antarctica", "arctic", "galapagos", "amazon", "polynesia",
  "patagonia", "kimberley", "mediterranean", "norway", "japan", "namibia",
]);
// Representative centroid [lng,lat] per marquee key (for the regions aggregate).
const MARQUEE_CENTER = {
  antarctica: [0, -71], arctic: [18, 79], galapagos: [-90.5, -0.7],
  amazon: [-60, -3], polynesia: [-149.4, -17.6], patagonia: [-72, -49],
  kimberley: [126, -16], mediterranean: [14, 39], norway: [10, 65],
  japan: [138, 37], namibia: [16, -22],
};

// Cruise region NAME -> marquee key (only the ones that genuinely map).
const REGION_MARQUEE = {
  "Antarctica": "antarctica",
  "Arctic": "arctic",
  "Northwest Passage": "arctic",
  "Galápagos": "galapagos",
  "Amazon & South America": "amazon",
  "Patagonia & Chilean Fjords": "patagonia",
  "Hawaii & Tahiti": "polynesia",
  "Mediterranean": "mediterranean",
  "Norway, Fjords & Coast": "norway",
};
// Finer-grained keyword override scanned from the sailing name, for marquee keys
// no region name carries: Kimberley sits inside "Australia, NZ & South Pacific",
// Namibia inside "Africa & Indian Ocean", Japan inside "Asia & Mekong".
const KEYWORDS = [
  ["kimberley", "kimberley"], ["namibia", "namibia"], ["japan", "japan"],
  ["svalbard", "arctic"], ["spitsbergen", "arctic"],
];
/**
 * The region names in sailings.json are the supplier's marketing buckets, and
 * several are keyword buckets rather than places — "Norway, Fjords & Coast"
 * collected Chilean Patagonia, Greenland and the Alaskan Inside Passage. The
 * corrections live in region-overrides.json, derived from each itinerary's own
 * geocoded ports by scripts/build-cruise-regions.mjs; the title rules below are
 * the fallback for a feed row the overlay has not seen yet. Keep them in step
 * with correctedRegionName() in lib/atlas/adapters/cruise.ts, which the native
 * atlas uses for the same purpose.
 */
function correctedRegionName(regionName, name, id) {
  const overlay = REGION_BY_ID[String(id)];
  if (overlay) return overlay;
  const t = norm(name);
  if (/antarctic|south georgia/.test(t)) return "Antarctica";
  if (t.includes("northwest passage")) return "Northwest Passage";
  if (t.includes("alaska")) return "Alaska & Yukon";
  if (t.includes("baja") || t.includes("sea of cortez")) return "Baja California";
  if (t.includes("seychelles")) return "Africa & Indian Ocean";
  if (/chilean fjord|patagonia|torres del paine|strait of magellan/.test(t)) return "Patagonia & Chilean Fjords";
  if (/iceland|greenland|svalbard|spitsbergen/.test(t) && !t.includes("norway") && !t.includes("norwegian")) return "Arctic";
  if (t.includes("caribbean")) return "Caribbean & Bermuda";
  return regionName;
}
function marqueeFor(regionName, name) {
  // The corrected region name wins: it is the label the atlas shows, and a
  // Norway sailing that mentions Svalbard in its title should not chart as
  // Arctic while its card reads Norway. Keywords only fill the gaps — marquee
  // keys that sit inside a broader region name and so can't be read off it.
  const fromRegion = REGION_MARQUEE[regionName];
  if (fromRegion) return fromRegion;
  const t = ci(name);
  for (const [kw, key] of KEYWORDS) if (t.includes(kw)) return key;
  return null;
}

// --- normalize raw rows -> records (one-time at module load) ---------------
const cruises = (() => {
  const idx = {};
  (raw.schema || []).forEach((k, i) => (idx[k] = i));
  const base = raw.urlBase || (ATLAS_URL + "/cruises/sailings/");
  return (raw.rows || []).map((row) => {
    const id = row[idx.id];
    const name = row[idx.name];
    const regionName = correctedRegionName(row[idx.region], name, id);
    const regionLabel = regionName && !/^other$/i.test(regionName) ? regionName : null;
    const slug = row[idx.slug] || "";
    const start = row[idx.start] || null;
    return {
      id: `cr_${id}`,
      type: "cruise",
      name,
      operator: row[idx.operator] || null,
      brand: row[idx.operator] || null,
      regionLabel,
      region: marqueeFor(regionName, name),
      country: null,
      nights: Number(row[idx.nights]) || null,
      startDate: start,
      month: start ? String(start).slice(0, 7) : null,
      bookUrl: id && slug ? `${base}${id}/${slug}` : ATLAS_URL,
    };
  });
})();

// --- filtering -------------------------------------------------------------
function filterCruises(params = {}) {
  const { q, region, country, month, year, operator, ids } = params;
  // Departed sailings go first — the Leaflet cruise atlas's `s.start >= today`
  // cutoff, restored. This is the largest leak of the six: 303 of 3,542 rows
  // were behind the cutoff, and expedition dates are all clean ISO, so the
  // comparison here is the same one the original made.
  let list = dropPast(cruises);

  if (ids != null && String(ids).trim() !== "") {
    const set = new Set(String(ids).split(",").map((s) => s.trim()).filter(Boolean));
    list = list.filter((c) => set.has(c.id));
  }
  if (region) {
    const v = ci(region);
    if (MARQUEE.has(v)) {
      list = list.filter((c) => c.region === v);
    } else {
      const matchesRegion = nonMarqueeRegionMatcher(region);
      if (matchesRegion) list = list.filter(matchesRegion);
    }
  }
  if (operator) { const v = ci(operator); list = list.filter((c) => ci(c.operator) === v); }
  if (month) { const v = String(month).trim(); list = list.filter((c) => c.month === v); }
  // A bare travel year, the same filter cruises-world.js carries. Antarctica and
  // Arctic seasons are chosen by year as often as by month ("Antarctica in
  // 2027"), and month= (YYYY-MM) cannot express one. month wins when both are
  // present, being the more specific of the two.
  else if (year != null && String(year).trim() !== "") {
    const v = String(year).trim();
    list = list.filter((c) => String(c.month || "").startsWith(`${v}-`));
  }

  const hay = (c) => `${ci(c.name)} ${ci(c.operator)} ${ci(c.regionLabel)}`;
  if (country != null && String(country).trim() !== "") {
    const matchesRegion = nonMarqueeRegionMatcher(country);
    if (matchesRegion) {
      list = list.filter(matchesRegion);
    } else {
      const v = ci(country); list = list.filter((c) => hay(c).includes(v));
    }
  }
  if (q != null && String(q).trim() !== "") {
    const tokens = ci(q).split(/\s+/).filter((t) => t && !Q_STOPWORDS.has(t));
    if (tokens.length) {
      const matchesRegion = nonMarqueeRegionMatcher(tokens.join(" "));
      if (matchesRegion) {
        list = list.filter(matchesRegion);
      } else {
        list = list.filter((c) => tokens.every((t) => hay(c).includes(t)));
      }
    }
  }
  return list;
}

function fitFor(c) {
  return itineraryFit[c.id] || null;
}

function fitScore(c, intent) {
  const key = intentKey(intent);
  const row = key && fitFor(c);
  const value = row && row.guestFit && row.guestFit[key];
  return Number.isFinite(value) ? value : null;
}

function withFit(c, intent) {
  const key = intentKey(intent);
  if (!key) return c;
  const row = fitFor(c);
  const value = row && row.guestFit && row.guestFit[key];
  if (!Number.isFinite(value)) return c;
  return {
    ...c,
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
    compareByDeparture(a, b));
}

// --- pagination (limit default 6 for the Guide, hard cap 24) ---------------
function clampLimit(rawN) { let n = parseInt(rawN, 10); if (!Number.isFinite(n) || n <= 0) n = 6; if (n > 24) n = 24; return n; }
function clampOffset(rawN) { let n = parseInt(rawN, 10); if (!Number.isFinite(n) || n < 0) n = 0; return n; }

// --- deep link (chat-to-atlas handoff) -------------------------------------
function buildDeepLink(params = {}) {
  const usp = new URLSearchParams();
  for (const k of ["region", "country", "operator", "month", "year", "q", "intent"]) {
    const val = params[k];
    if (val != null && String(val).trim() !== "") usp.set(k, String(val).trim());
  }
  const qs = usp.toString();
  return qs ? `${ATLAS_URL}?${qs}` : ATLAS_URL;
}

// --- region aggregate (marquee count + centroid) ---------------------------
function regions() {
  const tally = {};
  // Same cutoff as filterCruises. This is the tally the leak distorted most:
  // 303 departed sailings were inflating the marquee pins.
  const today = todayISO();
  for (const c of cruises) {
    if (isPast(c, today)) continue;
    if (c.region && MARQUEE.has(c.region)) tally[c.region] = (tally[c.region] || 0) + 1;
  }
  const out = Object.keys(tally).map((region) => ({
    region, count: tally[region],
    center: MARQUEE_CENTER[region] || null,
    deepLink: buildDeepLink({ region }),
  })).sort((a, b) => b.count - a.count);
  const total = out.reduce((n, r) => n + r.count, 0);
  return { total, count: out.length, regions: out };
}

// --- full query: filter + paginate + deepLink ------------------------------
function query(params = {}) {
  // Departure order is the BASE ordering, established before ranking rather
  // than after. Two reasons it has to be here:
  //
  //   1. `rankItems` returns its input untouched when there is no intent, and
  //      so did four of the five sortForIntent helpers — so "no intent" meant
  //      "whatever order the supplier's feed arrived in".
  //   2. Array#sort is stable, so pre-sorting survives ranking: where an intent
  //      IS set, supplier fit still leads and the soonest departure breaks ties
  //      within an equal score, instead of feed position breaking them.
  const matched = rankItems(sortOfferings(filterCruises(params)), params.intent, {
    getBrandLabel: (c) => c.brand || c.operator,
    getName: (c) => c.name,
    allowAvoid: params.ids != null && String(params.ids).trim() !== "",
  });
  const total = matched.length;
  const limit = clampLimit(params.limit);
  const offset = clampOffset(params.offset);
  const results = matched.slice(offset, offset + limit);
  return { total, count: results.length, results, deepLink: buildDeepLink(params) };
}

module.exports = {
  cruises, filterCruises, clampLimit, clampOffset, buildDeepLink, query, regions,
  MARQUEE, ATLAS_URL,
};

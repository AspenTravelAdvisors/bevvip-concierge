// lib/villas.js — Villas of Distinction data layer (7th offering type).
//
// SERVER-ONLY. The 7MB source JSON is required statically (same pattern as
// lib/atlas/hotels.js: inlined into the function bundle, parsed once per cold
// start via module require caching). Nothing under app/ may import this from a
// "use client" file — the villa atlas UI talks to /api/villas/search instead.
//
// Villas are the first atlas served exclusively through a paginated search API:
// no client ever downloads the full dataset. This module is also the seam for a
// future live VOD/WTH feed — getContent(id) / getMatches(criteria) mirror the
// TravelWits booking-seam convention, so swapping the static JSON for an API
// client later touches only this file.

const source = require("../data/villas-of-distinction.json");

const ATLAS_URL = "/atlas/villa";

const ci = (s) => String(s == null ? "" : s).toLowerCase().trim();
const fold = (s) => ci(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
// Shared key normalization so "St. Barthélemy", "st barts", and "Saint
// Barthelemy" all land on the same index entry, and "Turks & Caicos" matches
// "turks and caicos".
function nameKey(raw) {
  return fold(raw)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^st\b/, "saint")
    .replace(/\bst\b/g, "saint");
}
const slugify = (s) => fold(s).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Traveler shorthand -> the region/destination names the dataset actually uses.
const REGION_ALIASES = {
  "usa": "united states", "us": "united states", "u s": "united states",
  "u s a": "united states", "america": "united states",
  "carribean": "caribbean", "caribean": "caribbean",
  "central american": "central america", "south american": "south america",
  "south pacific islands": "south pacific",
};
const DESTINATION_ALIASES = {
  "saint barts": "saint barthelemy", "saint barths": "saint barthelemy",
  "saint barth": "saint barthelemy", "saint bart": "saint barthelemy",
  "saint maarten": "saint martin", "sint maarten": "saint martin",
  "turks caicos": "turks and caicos", "turks and caicos islands": "turks and caicos",
  "us virgin islands": "united states virgin islands",
  "usvi": "united states virgin islands",
  "bvi": "british virgin islands",
  "cayman islands": "grand cayman", "caymans": "grand cayman",
  "saint christopher": "saint kitts",
};

const money = (n) => "$" + Math.round(n).toLocaleString("en-US");

// --- normalization -----------------------------------------------------------

// The supplier's own "we do not publish a rate for this villa" marker. It is a
// display string, not a flag, so match it the way the feed writes it.
const CALL_FOR_PRICING = "call for pricing";
const isCallForPricing = (priceString) =>
  ci(priceString) === CALL_FOR_PRICING;

/**
 * The nightly rate a card may show, and the number a price cap may filter on —
 * always the same value, which is the point.
 *
 * The feed carries two rates. `rate_from_usd` is a base rate; `price_low` (and
 * the `price_string` built from it) is what VillaInfo actually publishes on the
 * villa's own page. They agree for 2,519 records and diverge for 798, by a
 * median of 6% and a 90th-percentile 37% — always with the published price
 * higher. Formatting from `rate_from_usd`, as this did, quoted the traveller
 * $1,700/nt for a villa the supplier lists at $2,258, and the gap surfaced
 * either on click-through or in the advisor's quote.
 *
 * `price_string: "Call for Pricing"` overrides both. 425 records pair it with a
 * positive `rate_from_usd` — the supplier is deliberately withholding a rate,
 * and printing one anyway is the same error as the $0 the old rule guarded
 * against, pointed the other way.
 */
function normalizePricing(pricing) {
  const p = pricing || {};
  const rate = Number(p.rate_from_usd) || 0;
  const published = Number(p.price_low) || 0;
  if (isCallForPricing(p.price_string)) {
    return { nightlyFromUsd: null, priceDisplay: "Call for Pricing", baseRateUsd: rate || null };
  }
  const nightly = published > 0 ? published : rate > 0 ? rate : null;
  return {
    nightlyFromUsd: nightly,
    // Never $0, and never a bare rate where the supplier publishes none.
    priceDisplay: nightly
      ? `From ${money(nightly)}/nt`
      : String(p.price_string || "Call for Pricing"),
    baseRateUsd: rate || null,
  };
}

/**
 * Bookable bedroom counts, ascending and de-duplicated.
 *
 * `capacity.bedrooms` is the villa's size; `capacity.available_bedrooms` is what
 * the supplier will actually rent, and for 698 records that is a menu — Àni
 * Thailand is [6,7,8,9,10], Vista Villa is [1,2,3,4]. A 10-bedroom estate that
 * also goes as a 6 is a different product than a card headlining "10 bd", and
 * for the traveller sizing a party it is the more useful number.
 *
 * It also disagrees with `bedrooms` in 45 records — 28 rent more rooms than the
 * size field claims, 17 rent fewer — which is why the bedrooms filter reads the
 * max of these options rather than `bedrooms` alone.
 */
function normalizeBedroomOptions(available, bedrooms) {
  const raw = Array.isArray(available) ? available : [];
  const options = [...new Set(raw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
  options.sort((a, b) => a - b);
  return options.length ? options : bedrooms > 0 ? [bedrooms] : [];
}

function normalizeVilla(v) {
  const { nightlyFromUsd, priceDisplay, baseRateUsd } = normalizePricing(v.pricing);
  const sleepsRaw = Number(v.capacity && v.capacity.sleeps) || 0;
  const bedrooms = Number(v.capacity && v.capacity.bedrooms) || 0;
  const bedroomOptions = normalizeBedroomOptions(
    v.capacity && v.capacity.available_bedrooms,
    bedrooms,
  );
  const geoPrecision = (v.geo && v.geo.precision) || "unknown";
  return {
    offeringType: "villa",
    id: v.id,
    name: v.name,
    slug: v.slug,
    region: v.region && v.region.name,
    regionSlug: slugify(v.region && v.region.name),
    destination: v.destination && v.destination.name,
    destinationSlug: v.destination && v.destination.slug,
    location: v.location && v.location.name,
    locationSlug: v.location && v.location.slug,
    lat: v.geo && v.geo.lat,
    lon: v.geo && v.geo.lon,
    geoPrecision,
    // 236 villas sit on a location or destination centroid rather than their own
    // address. The map already renders those hollow; this is the same fact in a
    // form a card can say out loud.
    exactLocation: geoPrecision === "villa",
    sleeps: sleepsRaw > 0 ? sleepsRaw : null, // one record sleeps 0 — a data hole, so unknown
    bedrooms,
    bedroomOptions,
    // What the bedrooms filter compares against: the largest count the supplier
    // will rent, which is not always the villa's own size.
    bedroomsMax: bedroomOptions.length ? bedroomOptions[bedroomOptions.length - 1] : bedrooms,
    bathrooms: Number(v.capacity && v.capacity.bathrooms) || 0,
    nightlyFromUsd,
    priceDisplay,
    // The base rate behind a published price, kept for the advisor-facing side
    // only (it is what the supplier quotes the agency, not the traveller).
    baseRateUsd,
    // Carried, deliberately not rendered: the feed's only freshness signal
    // (713 records at 0, 3,187 at 1) with no documented meaning. Surfacing it as
    // an availability claim needs confirmation from WTH first — see STATE.md.
    liveAvailability:
      v.availability && v.availability.true_availability != null
        ? Number(v.availability.true_availability) === 1
        : null,
    featured: !!v.featured,
    hasSpecials: Array.isArray(v.specials) && v.specials.length > 0,
    specialCategory: v.ranked_special_category || null,
    specials: Array.isArray(v.specials) ? v.specials.map((s) => s.title).filter(Boolean) : [],
    summary: v.summary || "",
    imageUrl: v.image_url || null,
    supplierDeepLink: v.deep_link || null, // internal reference only — never a client CTA
  };
}

// --- memoized load -----------------------------------------------------------

let cache = null;
function loadVillas() {
  if (cache) return cache;
  const villas = source.villas.map(normalizeVilla);
  const byId = new Map(villas.map((v) => [String(v.id), v]));
  const bySlug = new Map(villas.map((v) => [`${v.destinationSlug}/${v.slug}`, v]));
  // name/slug -> canonical filter value indexes, so region/destination/location
  // params accept names, slugs, and common traveler shorthand.
  const regionKeys = new Map();
  const destinationKeys = new Map();
  const locationKeys = new Map();
  for (const v of villas) {
    if (v.region) {
      regionKeys.set(nameKey(v.region), v.region);
      regionKeys.set(v.regionSlug, v.region);
    }
    if (v.destination) {
      destinationKeys.set(nameKey(v.destination), v.destination);
      destinationKeys.set(v.destinationSlug, v.destination);
    }
    if (v.location) {
      locationKeys.set(nameKey(v.location), v.location);
      locationKeys.set(v.locationSlug, v.location);
    }
  }
  cache = { villas, byId, bySlug, regionKeys, destinationKeys, locationKeys };
  return cache;
}

function resolveRegion(raw) {
  const key = nameKey(raw);
  if (!key) return "";
  const { regionKeys } = loadVillas();
  return regionKeys.get(REGION_ALIASES[key] || key) || regionKeys.get(key) || "";
}
function resolveDestination(raw) {
  const key = nameKey(raw);
  if (!key) return "";
  const { destinationKeys } = loadVillas();
  return destinationKeys.get(DESTINATION_ALIASES[key] || key) || destinationKeys.get(key) || "";
}
function resolveLocation(raw) {
  const key = nameKey(raw);
  if (!key) return "";
  const { locationKeys } = loadVillas();
  return locationKeys.get(key) || "";
}

// --- search ------------------------------------------------------------------

const Q_STOPWORDS = new Set([
  "in", "the", "of", "at", "on", "a", "an", "and", "to", "for", "near", "or", "by", "with",
  "villa", "villas", "home", "homes", "house", "rental", "rentals", "property", "properties",
  "luxury", "luxurious", "private",
]);

const int = (raw) => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const truthy = (raw) => raw === true || raw === "true" || raw === "1" || raw === 1;

function clampPerPage(raw) {
  let n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) n = 24;
  return Math.min(n, 100); // API layer caps harder at 50
}
function clampPage(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const SLEEPS_BUCKETS = [
  { key: "1-6", min: 1, max: 6 },
  { key: "7-12", min: 7, max: 12 },
  { key: "13+", min: 13, max: Infinity },
];

function filterVillas(params = {}) {
  const { villas } = loadVillas();
  let list = villas;

  if (params.ids != null && String(params.ids).trim() !== "") {
    const set = new Set(String(params.ids).split(",").map((s) => s.trim()).filter(Boolean));
    list = list.filter((v) => set.has(String(v.id)));
  }
  const region = resolveRegion(params.region);
  if (params.region && !region) return []; // an unknown region must not silently broaden
  if (region) list = list.filter((v) => v.region === region);

  const destination = resolveDestination(params.destination);
  if (params.destination && !destination) return [];
  if (destination) list = list.filter((v) => v.destination === destination);

  const location = resolveLocation(params.location);
  if (params.location && !location) return [];
  if (location) list = list.filter((v) => v.location === location);

  const sleepsMin = int(params.sleepsMin != null ? params.sleepsMin : params.sleeps);
  if (sleepsMin) list = list.filter((v) => v.sleeps != null && v.sleeps >= sleepsMin);

  // Bedrooms match against the largest count the supplier will actually rent,
  // not the villa's size field. They differ in 45 records — a "5 bedroom" villa
  // bookable as [5,7] used to be hidden from a 7-bedroom search, and one
  // bookable only as [3] used to be returned for a 5-bedroom one.
  const bedroomsMin = int(params.bedroomsMin != null ? params.bedroomsMin : params.bedrooms);
  if (bedroomsMin) list = list.filter((v) => v.bedroomsMax >= bedroomsMin);

  const priceMax = int(params.priceMax);
  // Under a price cap, "Call for Pricing" records (null rate) are excluded —
  // we cannot verify they fit the budget.
  if (priceMax) list = list.filter((v) => v.nightlyFromUsd != null && v.nightlyFromUsd <= priceMax);

  if (truthy(params.featured)) list = list.filter((v) => v.featured);
  if (truthy(params.hasSpecials) || truthy(params.specials)) list = list.filter((v) => v.hasSpecials);

  if (params.q != null && String(params.q).trim() !== "") {
    const tokens = fold(params.q).split(/\s+/).filter((t) => t && !Q_STOPWORDS.has(t));
    if (tokens.length) {
      const res = tokens.map(
        (t) => new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:s|es|ing)?\\b"),
      );
      list = list.filter((v) => {
        const hay = fold([v.name, v.location, v.destination, v.region, v.summary].join(" "));
        return res.every((re) => re.test(hay));
      });
    }
  }

  // Map-viewport filter: bbox=west,south,east,north (lng/lat degrees), set by
  // the atlas "Search this area" button from the live Mapbox bounds. A box whose
  // west > east straddles the antimeridian, so its longitude test is an OR.
  if (params.bbox != null && String(params.bbox).trim() !== "") {
    const b = String(params.bbox).split(",").map(Number);
    if (b.length === 4 && b.every(Number.isFinite)) {
      const [west, south, east, north] = b;
      const inLng = west <= east
        ? (lng) => lng >= west && lng <= east
        : (lng) => lng >= west || lng <= east;
      list = list.filter(
        (v) =>
          Number.isFinite(v.lat) && Number.isFinite(v.lon) &&
          v.lat >= south && v.lat <= north && inLng(v.lon),
      );
    }
  }
  return list;
}

// null nightly rates ("Call for Pricing") always sort last within their band.
const priceAsc = (a, b) =>
  (a.nightlyFromUsd == null) - (b.nightlyFromUsd == null) ||
  (a.nightlyFromUsd || 0) - (b.nightlyFromUsd || 0);

const SORTS = {
  default: (a, b) => b.featured - a.featured || priceAsc(a, b),
  priceAsc,
  priceDesc: (a, b) =>
    (a.nightlyFromUsd == null) - (b.nightlyFromUsd == null) ||
    (b.nightlyFromUsd || 0) - (a.nightlyFromUsd || 0),
  sleeps: (a, b) => (b.sleeps || 0) - (a.sleeps || 0),
  name: (a, b) => a.name.localeCompare(b.name),
};

function computeFacets(list, params = {}) {
  const regions = {};
  const sleeps = { "1-6": 0, "7-12": 0, "13+": 0 };
  const destinations = {};
  let callForPricing = 0;
  for (const v of list) {
    if (v.region) regions[v.region] = (regions[v.region] || 0) + 1;
    if (v.sleeps != null) {
      const b = SLEEPS_BUCKETS.find((b) => v.sleeps >= b.min && v.sleeps <= b.max);
      if (b) sleeps[b.key]++;
    }
    if (v.nightlyFromUsd == null) callForPricing++;
    // Destination counts only when the search is already scoped to a region,
    // so the facet payload stays small on open searches.
    if (params.region && v.destination) {
      destinations[v.destination] = (destinations[v.destination] || 0) + 1;
    }
  }
  const facets = { regions, sleeps, callForPricing };
  if (params.region) facets.destinations = destinations;
  return facets;
}

function buildVillaDeepLink(params = {}) {
  const usp = new URLSearchParams();
  const map = {
    region: params.region, destination: params.destination, location: params.location,
    sleeps: params.sleepsMin != null ? params.sleepsMin : params.sleeps,
    bedrooms: params.bedroomsMin != null ? params.bedroomsMin : params.bedrooms,
    priceMax: params.priceMax, q: params.q, ids: params.ids,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v != null && String(v).trim() !== "") usp.set(k, String(v).trim());
  }
  if (truthy(params.featured)) usp.set("featured", "1");
  if (truthy(params.hasSpecials) || truthy(params.specials)) usp.set("specials", "1");
  const qs = usp.toString();
  return qs ? `${ATLAS_URL}?${qs}` : ATLAS_URL;
}

/**
 * The client-facing projection of a villa record.
 *
 * Every consumer of searchVillas — the search API, the atlas's SSR first page,
 * and the Guide's card builder — sends its output to a browser, so this is the
 * one place that decides what a browser may see. Three internal fields stop
 * here: `supplierDeepLink` (an advisor reference the guardrail says is never
 * client-facing, but which until now shipped inside every card payload and the
 * atlas's server-rendered HTML), `baseRateUsd` (the agency-side rate), and
 * `liveAvailability` (undocumented, so not something to hand a client that
 * might render it). The taxonomy slugs and `geoPrecision` go too — nothing on
 * the client reads them, and `exactLocation` carries the part a card uses.
 */
function toClientVilla(v) {
  const {
    offeringType: _t,
    regionSlug: _rs,
    locationSlug: _ls,
    geoPrecision: _gp,
    bedroomsMax: _bm,
    baseRateUsd: _br,
    liveAvailability: _la,
    supplierDeepLink: _dl,
    ...client
  } = v;
  return client;
}

// Main search: filter + sort + paginate + facets.
// Returns { results, total, page, perPage, facets, deepLink }.
function searchVillas(params = {}) {
  const matched = filterVillas(params);
  const sortKey = SORTS[String(params.sort || "")] ? String(params.sort) : "default";
  const sorted = [...matched].sort(SORTS[sortKey]);
  const perPage = clampPerPage(params.perPage);
  const page = clampPage(params.page);
  const start = (page - 1) * perPage;
  return {
    total: matched.length,
    page,
    perPage,
    results: sorted.slice(start, start + perPage).map(toClientVilla),
    facets: computeFacets(matched, params),
    deepLink: buildVillaDeepLink(params),
  };
}

// Compact map-pin view over the same filters: every match, minimal bytes.
// Each pin is [id, lat, lon, exactPoint(0|1), featured(0|1)] — exactPoint 0
// marks centroid/locality precision so the map can render it hollow and
// cluster-de-emphasize stacked centroids.
function villaPins(params = {}) {
  const matched = filterVillas(params);
  const r5 = (n) => Math.round(Number(n) * 1e5) / 1e5;
  return {
    total: matched.length,
    pins: matched.map((v) => [
      v.id, r5(v.lat), r5(v.lon),
      v.geoPrecision === "villa" ? 1 : 0,
      v.featured ? 1 : 0,
    ]),
  };
}

// Living Atlas overlay feed: one pin per villa region, in the same
// {REGIONS: {key: {coord: [lat, lng], name, count}}} shape the other atlas
// overlay feeds use, so AtlasShell's fetchOverlay consumes it unchanged.
// Keys are the dataset's own region names ("Caribbean", "Europe"), which the
// villa atlas filters natively — the overlay's ?region= click-through just works.
// Longitude uses a circular mean so a region spanning the antimeridian
// (South Pacific, US incl. Hawaii) centers on its villas, not near 0°.
function villaOverlayRegions() {
  const groups = new Map();
  for (const v of loadVillas().villas) {
    if (!v.region || !Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
    let g = groups.get(v.region);
    if (!g) {
      g = { count: 0, sumLat: 0, sumSin: 0, sumCos: 0 };
      groups.set(v.region, g);
    }
    g.count++;
    g.sumLat += v.lat;
    const rad = (v.lon * Math.PI) / 180;
    g.sumSin += Math.sin(rad);
    g.sumCos += Math.cos(rad);
  }
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  const REGIONS = {};
  for (const [name, g] of groups) {
    const lng = (Math.atan2(g.sumSin / g.count, g.sumCos / g.count) * 180) / Math.PI;
    REGIONS[name] = { coord: [r4(g.sumLat / g.count), r4(lng)], name, count: g.count };
  }
  return { REGIONS };
}

// --- single record + taxonomy -------------------------------------------------

function getVillaById(id) {
  return loadVillas().byId.get(String(id)) || null;
}

function getVillaBySlug(destinationSlug, villaSlug) {
  return loadVillas().bySlug.get(`${ci(destinationSlug)}/${ci(villaSlug)}`) || null;
}

// The source regions[] tree (region > destination > location, with slugs and
// supplier deep links) — filter menus come from here, never from a villa scan.
function getVillaTaxonomy() {
  return source.regions;
}

// Every villa's route params, for generateStaticParams on the detail page.
//
// All 3,902, not the 114 featured ones this used to return. The other 3,788
// were rendered on demand and held by ISR, which is the most expensive way to
// serve a page whose content is a static file in this repository — and they are
// the largest surface on the site, so they were the largest share of the ISR
// writes that took the account to 100% of its allowance. See "The ISR writes
// were paying for nothing" in STATE.md.
function allVillaParams() {
  return loadVillas().villas.map((v) => ({
    destination: v.destinationSlug,
    slug: v.slug,
  }));
}

// --- seam (TravelWits convention) ---------------------------------------------
// Villas are a static-file passthrough today. When a live VOD/WTH feed lands,
// reimplement these two against it and every caller keeps working.

function getContent(id) {
  return getVillaById(id);
}

function getMatches(criteria = {}) {
  return searchVillas(criteria);
}

module.exports = {
  loadVillas,
  searchVillas,
  villaOverlayRegions,
  resolveRegion,
  resolveDestination,
  resolveLocation,
  villaPins,
  getVillaById,
  getVillaBySlug,
  getVillaTaxonomy,
  allVillaParams,
  buildVillaDeepLink,
  getContent,
  getMatches,
  ATLAS_URL,
};

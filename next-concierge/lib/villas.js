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

function normalizeVilla(v) {
  const rate = Number(v.pricing && v.pricing.rate_from_usd) || 0;
  const nightlyFromUsd = rate > 0 ? rate : null;
  const sleepsRaw = Number(v.capacity && v.capacity.sleeps) || 0;
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
    geoPrecision: (v.geo && v.geo.precision) || "unknown",
    sleeps: sleepsRaw > 0 ? sleepsRaw : null, // one record sleeps 0 — a data hole, so unknown
    bedrooms: Number(v.capacity && v.capacity.bedrooms) || 0,
    bathrooms: Number(v.capacity && v.capacity.bathrooms) || 0,
    nightlyFromUsd,
    // Never $0: a zero rate renders the supplier's own "Call for Pricing".
    priceDisplay: nightlyFromUsd
      ? `From ${money(nightlyFromUsd)}/nt`
      : String((v.pricing && v.pricing.price_string) || "Call for Pricing"),
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

  const bedroomsMin = int(params.bedroomsMin != null ? params.bedroomsMin : params.bedrooms);
  if (bedroomsMin) list = list.filter((v) => v.bedrooms >= bedroomsMin);

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
    results: sorted.slice(start, start + perPage),
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

// Every featured villa's route params, for generateStaticParams on the detail
// page (114 featured pages prebuilt; the rest are on-demand ISR).
function featuredVillaParams() {
  return loadVillas()
    .villas.filter((v) => v.featured)
    .map((v) => ({ destination: v.destinationSlug, slug: v.slug }));
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
  featuredVillaParams,
  buildVillaDeepLink,
  getContent,
  getMatches,
  ATLAS_URL,
};

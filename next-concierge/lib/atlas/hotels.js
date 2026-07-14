// lib/hotels.js — Base Camp T2
// Shared in-memory query layer over data/luxury-hotels.json. Consumed by the
// serverless functions in api/. Pure functions, no I/O beyond the one-time
// JSON load, so it is unit-testable without an HTTP server.
//
// Lives outside api/ on purpose: anything under api/ becomes a Vercel route.
//
// The static require inlines the JSON into each function bundle at build time,
// which keeps a filtered query well under the 300ms budget (SPEC §8) with no
// cold filesystem read. Clean seam for a later Supabase swap: replace the
// `hotels` source and keep these signatures intact.

const hotels = require("../../data/atlas/hotel/luxury-hotels.json");
const hotelFit = require("../../data/atlas/hotel/hotel-fit.json");
const { rankItems } = require("./supplier-fit");
const { preferredScore, preferredTier } = require("./preferred-overlay");

const ci = (s) => String(s == null ? "" : s).toLowerCase().trim();
const fold = (s) => ci(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const keyPart = (s) => ci(s).replace(/[^a-z0-9|]+/g, " ").trim();
const fitKey = (h) => [h.name, h.city, h.country].map(keyPart).join("|");
// hotelFit still supplies the Forbes/AAA rating and the `q` search haystack /
// card copy; it no longer drives ranking order (see preferredRank).
const fitFor = (h) => hotelFit[fitKey(h)] || null;
const CARIBBEAN_COUNTRIES = new Set([
  "anguilla",
  "antigua and barbuda",
  "aruba",
  "bahamas",
  "barbados",
  "cayman islands",
  "curacao",
  "dominican republic",
  "grenada",
  "jamaica",
  "puerto rico",
  "saint kitts and nevis",
  "st kitts and nevis",
  "saint lucia",
  "turks and caicos",
  "turks and caicos islands",
]);
const REGION_COUNTRY_ALIASES = {
  caribbean: CARIBBEAN_COUNTRIES,
};
// The inventory holds both spellings; either query form must return all of it.
const TURKS_SET = new Set(["turks and caicos", "turks and caicos islands"]);
const COUNTRY_SYNONYMS = {
  "turks and caicos": TURKS_SET,
  "turks and caicos islands": TURKS_SET,
  "st barts": new Set(["saint barthélemy"]),
  "st barths": new Set(["saint barthélemy"]),
  "st barthelemy": new Set(["saint barthélemy"]),
  "saint barts": new Set(["saint barthélemy"]),
  "saint barths": new Set(["saint barthélemy"]),
  "saint barthelemy": new Set(["saint barthélemy"]),
};
const regionCountryAlias = (region) =>
  REGION_COUNTRY_ALIASES[ci(region)] || COUNTRY_SYNONYMS[fold(region)] || null;
const isCaribbeanHotel = (h) => CARIBBEAN_COUNTRIES.has(ci(h.country));

function normalizeQueryText(raw) {
  return String(raw || "")
    .replace(/\b(?:st\.?|saint)\s+lucia\b/ig, "Saint Lucia")
    .replace(/\b(?:turks\s*(?:&|and)\s*caicos)(?:\s+islands)?\b/ig, "Turks and Caicos")
    .replace(/\b(?:st\.?|saint)\s+(?:barts?|barths?|barthelemy)\b/ig, "Saint Barthelemy");
}

function firstPriorityBenefit(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text || /^["']?first priority["']?\b/i.test(text)) return text;
  // The benefit is a "First Priority Room Upgrade"; the source lines start with
  // a bare "Upgrade...", so name it in full. Data that already says "Room
  // Upgrade" keeps its wording.
  if (/^room\s+upgrades?\b/i.test(text)) return `"First Priority" ${text}`;
  if (/^upgrades?\b/i.test(text)) return `"First Priority" Room ${text}`;
  return text;
}

// Bare year headers the source data carries between benefit lists ("For 2026:",
// "For 2025 & 2026:") — a label, not a benefit, so it never renders as one.
const BENEFIT_YEAR_HEADER_RE = /^for\s+20\d{2}(\s*&\s*20\d{2})?\s*:?\s*$/i;

function normalizedBenefits(h) {
  return Array.isArray(h.vipUpgrades)
    ? h.vipUpgrades
        .filter((u) => !BENEFIT_YEAR_HEADER_RE.test(String(u == null ? "" : u).trim()))
        .map(firstPriorityBenefit)
    : h.vipUpgrades;
}

const INTENT_SCORE = {
  honeymoon: "honeymoon",
  couples: "couples",
  family: "family",
  multigen: "multigen",
  celebration: "celebration",
  business: "business",
  active: "active",
  expedition: "expedition",
  adventure: "active",
  culture: "culture",
  wildlife: "wildlife",
  photography: "photography",
  firsttimer: "first-timer",
  first: "first-timer",
  uhnw: "uhnw",
  private: "uhnw",
  wellness: "wellness",
  spa: "wellness",
  foodie: "foodie",
  culinary: "foodie",
  value: "value",
  simple: "simpleVip",
  simplevip: "simpleVip",
  vip: "simpleVip",
};

function enriched(h) {
  const fit = fitFor(h);
  return {
    ...h,
    vipUpgrades: normalizedBenefits(h),
    ...(fit ? { fit } : {}),
  };
}

function summary(h) {
  return {
    id: h.id,
    name: h.name,
    brand: h.brand,
    program: h.program,
    category: h.category,
    country: h.country,
    city: h.city,
    adminRegion: h.adminRegion,
    region: h.region,
    lat: h.lat,
    lng: h.lng,
  };
}

function ratingLevel(value) {
  if (value == null) return 0;
  const text = ci(value);
  if (Number(value) === 5 || text.includes("five") || text.includes("5")) return 5;
  if (Number(value) === 4 || text.includes("four") || text.includes("4")) return 4;
  return 0;
}

function ratingPriority(h) {
  const fit = fitFor(h) || {};
  return Math.max(ratingLevel(fit.forbesRating), ratingLevel(fit.aaaDiamondRating));
}

// Preferred-partner + star-rating ranking signal. Supersedes the old
// overallFitScore for ordering: the compressed, low-confidence fit score no
// longer participates. preferredScore blends the overlay relationship (with a
// booking-time upgrade weighted highest) and the Forbes/AAA rating so a
// Peninsula/Shangri-La/Oetker-tier stay and a five-star property both lead.
function preferredRank(h) {
  return preferredScore(h, ratingPriority(h));
}
function preferredBand(h) {
  return preferredTier(h, ratingPriority(h));
}

function destinationIconPriority(h) {
  const tags = Array.isArray(h.tags) ? h.tags.map(ci) : [];
  const name = ci(h.name);
  if (name.includes("parrot cay")) return 4;
  if (tags.includes("private-island")) return 3;
  if (tags.includes("island")) return 2;
  return 0;
}

// Connector words dropped from free-text `q` so phrases like "Aman in Japan"
// match on the meaningful tokens rather than failing on "in".
const Q_STOPWORDS = new Set([
  "in", "the", "of", "at", "on", "a", "an", "and", "to", "for", "near", "or", "by",
  "hotel", "hotels", "resort", "resorts", "property", "properties", "stay", "stays",
  "luxury", "luxurious", "vip", "virtuoso",
]);

// --- filtering -------------------------------------------------------------
// All params optional and combinable (SPEC §4). Returns the full unpaginated
// match set; pagination is applied separately in query().
function filterHotels(params = {}) {
  const { q, brand, program, category, country, region, bbox, places, ids, intent } = params;
  let list = hotels;
  let coreMatch = null; // populated by the q filter; identity matches rank first

  if (ids != null && String(ids).trim() !== "") {
    const set = new Set(String(ids).split(",").map((s) => s.trim()).filter(Boolean));
    list = list.filter((h) => set.has(h.id));
  }
  if (brand)    { const v = ci(brand);    list = list.filter((h) => ci(h.brand) === v); }
  if (program)  { const v = ci(program);  list = list.filter((h) => ci(h.program) === v); }
  if (category) { const v = ci(category); list = list.filter((h) => ci(h.category) === v); }
  if (country)  {
    const v = ci(country);
    const countries = regionCountryAlias(v);
    list = countries
      ? list.filter((h) => countries.has(ci(h.country)))
      : list.filter((h) => ci(h.country) === v);
  }
  if (region)   {
    const v = ci(region);
    const countries = regionCountryAlias(v);
    list = countries
      ? list.filter((h) => countries.has(ci(h.country)))
      : list.filter((h) => ci(h.region) === v);
  }

  if (bbox != null && String(bbox).trim() !== "") {
    const p = String(bbox).split(",").map(Number);
    if (p.length === 4 && p.every(Number.isFinite)) {
      const [minLng, minLat, maxLng, maxLat] = p;
      list = list.filter(
        (h) => h.lng >= minLng && h.lng <= maxLng && h.lat >= minLat && h.lat <= maxLat
      );
    }
  }

  // places: an OR list of concrete city/area names, the decomposition of a
  // colloquial region the `q` token-AND cannot match (French Riviera -> Nice,
  // Cannes, Antibes, ...). A hotel matches when any place name appears in its
  // city, adminRegion, country, or name. ANDs with country/bbox so those still
  // narrow. Supplied comma- or pipe-separated by search-offerings.
  if (places != null && String(places).trim() !== "") {
    // Whole-word match, not substring: "Nice" must not match "Venice", and
    // "Eze" must not match "Trapeze". \b handles the hyphens in "Saint-Tropez".
    const res = String(places)
      .split(/[|,]/)
      .map((s) => fold(s).trim())
      .filter(Boolean)
      .map((w) => new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b"));
    if (res.length) {
      list = list.filter((h) => {
        const hay = [h.city, h.adminRegion, h.country, h.name].map(fold).join(" ");
        return res.some((re) => re.test(hay));
      });
    }
  }
  if (q != null && String(q).trim() !== "") {
    // Token-AND: every meaningful word must match name/brand/city/country.
    // This lets a phrase like "Aman Japan" match (brand + country) instead of
    // failing as one literal substring. Common connector words are dropped so
    // "Aman in Japan" still works. Single-word queries behave as before.
    // Tokens match whole words, allowing plural/gerund suffixes: "ski" finds
    // "ski-in", "skis", and "skiing", but "paris" no longer matches the inside
    // of "comparison" or the prefix of Caribbean "Parish" place names.
    const tokens = fold(normalizeQueryText(q)).split(/\s+/).filter((t) => t && !Q_STOPWORDS.has(t));
    if (tokens.length) {
      const tokenRes = tokens.map(
        (t) => new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:s|es|ing)?\\b")
      );
      // Identity-field matches outrank prose-only matches: a "Paris" query must
      // put hotels IN Paris above hotels whose fit copy merely mentions Paris.
      coreMatch = new Map();
      list = list.filter((h) => {
        const fit = fitFor(h) || {};
        const hay = [
          h.name, h.brand, h.city, h.country, h.adminRegion, h.program,
          h.category, fit.bestFit, ...(fit.intentTags || []), fit.serviceStyle,
          fit.evaluationNotes, fit.description, fit.forbesRating,
          fit.aaaDiamondRating ? `AAA ${fit.aaaDiamondRating} Diamond` : null,
          ...(fit.ratingBadges || []).map((r) => r && r.label),
          ...(fit.searchKeywords || []), ...(Array.isArray(h.tags) ? h.tags : []),
          isCaribbeanHotel(h) ? "caribbean" : null,
        ].map(fold).join(" ");
        if (!tokenRes.every((re) => re.test(hay))) return false;
        const coreHay = [
          h.name, h.brand, h.city, h.country, h.adminRegion,
          isCaribbeanHotel(h) ? "caribbean" : null,
        ].map(fold).join(" ");
        coreMatch.set(h, tokenRes.every((re) => re.test(coreHay)) ? 1 : 0);
        return true;
      });
    }
  }
  const coreFirst = coreMatch
    ? (a, b) => (coreMatch.get(b) || 0) - (coreMatch.get(a) || 0)
    : () => 0;
  const scoreKey = INTENT_SCORE[ci(intent).replace(/[^a-z]/g, "")];
  if (scoreKey) {
    const ranked = rankItems(list, scoreKey, {
      getBrandLabel: (h) => h.brand,
      getName: (h) => h.name,
      allowAvoid: ids != null && String(ids).trim() !== "",
      attachFit: false,
    });
    // Preferred-partner status and five-star rating are foremost even under an
    // intent: lead with the preferred/rating band, then let the intent fit
    // (rankItems' order, captured here) decide within each band.
    const intentOrder = new Map(ranked.map((h, i) => [h, i]));
    list = ranked.sort((a, b) =>
      coreFirst(a, b) ||
      preferredBand(b) - preferredBand(a) ||
      (intentOrder.get(a) - intentOrder.get(b)));
  } else {
    // No intent: preferred-partner + five-star lead (booking-time-upgrade
    // brands highest), then destination-defining island stays for the middle
    // band. The old overallFitScore no longer participates.
    list = [...list].sort((a, b) =>
      coreFirst(a, b) ||
      preferredRank(b) - preferredRank(a) ||
      destinationIconPriority(b) - destinationIconPriority(a));
  }
  return list;
}

// --- pagination bounds (SPEC §4: limit default 50, hard cap 200) -----------
function clampLimit(raw) {
  let n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) n = 50;
  if (n > 200) n = 200;
  return n;
}
function clampOffset(raw) {
  let n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) n = 0;
  return n;
}

// --- deep link (SPEC §4 + §7) ----------------------------------------------
// Prebuilt chat-to-atlas handoff. Only the params the atlases parse on load
// are forwarded; pagination/bbox are intentionally omitted.
const ATLAS_URL =
  process.env.ATLAS_HOTEL_URL || "/maps/hotel";

function buildDeepLink(params = {}) {
  const keys = ["region", "brand", "program", "category", "country", "ids", "q", "intent"];
  const usp = new URLSearchParams();
  for (const k of keys) {
    const val = params[k];
    if (val != null && String(val).trim() !== "") usp.set(k, String(val).trim());
  }
  const qs = usp.toString();
  return qs ? `${ATLAS_URL}?${qs}` : ATLAS_URL;
}

// --- single record ---------------------------------------------------------
function getById(id) {
  const h = hotels.find((h) => h.id === id) || null;
  return h ? enriched(h) : null;
}

// --- region aggregate (SPEC §4) --------------------------------------------
// Per marquee region: record count + bounding box, so the Living Atlas can show
// "Japan · 39 stays" at its resting state without loading any records.
// bbox order is [minLng, minLat, maxLng, maxLat] to match the `bbox` query param.
function regions() {
  const groups = new Map();
  let unmapped = 0;

  for (const h of hotels) {
    if (h.region == null) { unmapped++; continue; }
    let g = groups.get(h.region);
    if (!g) {
      g = { region: h.region, count: 0, minLng: Infinity, minLat: Infinity, maxLng: -Infinity,
            maxLat: -Infinity, sumSin: 0, sumCos: 0, sumLat: 0 };
      groups.set(h.region, g);
    }
    g.count++;
    if (h.lng < g.minLng) g.minLng = h.lng;
    if (h.lng > g.maxLng) g.maxLng = h.lng;
    if (h.lat < g.minLat) g.minLat = h.lat;
    if (h.lat > g.maxLat) g.maxLat = h.lat;
    // accumulate a circular mean for longitude so regions that straddle the
    // antimeridian (e.g. polynesia, Fiji ~179 and Tahiti ~-149) get a center in
    // the Pacific, not averaged to ~0 off Africa.
    const rad = (h.lng * Math.PI) / 180;
    g.sumSin += Math.sin(rad);
    g.sumCos += Math.cos(rad);
    g.sumLat += h.lat;
  }

  const r6 = (n) => Math.round(n * 1e6) / 1e6;
  const out = [...groups.values()]
    .map((g) => {
      const meanLng = (Math.atan2(g.sumSin / g.count, g.sumCos / g.count) * 180) / Math.PI;
      return {
        region: g.region,
        count: g.count,
        bbox: [g.minLng, g.minLat, g.maxLng, g.maxLat],
        center: [r6(meanLng), r6(g.sumLat / g.count)], // circular-mean lng, mean lat
        deepLink: buildDeepLink({ region: g.region }),
      };
    })
    .sort((a, b) => b.count - a.count);

  const total = out.reduce((n, r) => n + r.count, 0);
  return { total, count: out.length, unmapped, regions: out };
}

// --- full query: filter + paginate + deepLink ------------------------------
function query(params = {}) {
  const matched = filterHotels(params);
  const total = matched.length; // unpaginated match count (SPEC §4)
  const limit = clampLimit(params.limit);
  const offset = clampOffset(params.offset);
  const shape = String(params.summary || "") === "1" ? summary : enriched;
  const results = matched.slice(offset, offset + limit).map(shape);
  return { total, count: results.length, results, deepLink: buildDeepLink(params) };
}

module.exports = {
  hotels,
  filterHotels,
  clampLimit,
  clampOffset,
  buildDeepLink,
  getById,
  query,
  regions,
  ATLAS_URL,
};

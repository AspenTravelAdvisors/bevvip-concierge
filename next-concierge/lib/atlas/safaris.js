// lib/atlas/safaris.js — Safari Atlas query layer
//
// The sibling of lib/atlas/trains.js, over the safari TRIPS feed, and it exists
// because its absence was invisible in exactly the way that matters.
//
// The safari collection shipped as the eighth atlas: 274 journeys, its own
// colour, its own pins on the home globe, its own /atlas/safari page, its own
// entry in the Explore menu. What it never got was a query backend — so
// `queryAtlas("safari")` threw `unknown atlas type: safari`, `safari` was not
// in the search_offerings tool enum, and dispatchSearchOfferings had no branch
// for it. Its final line reads:
//
//     // Unknown type -> treat as hotel search rather than erroring.
//     return searchHotels(input, fetchImpl);
//
// That is the right instinct for an unknown type and the wrong outcome for a
// real one. A traveller asking The Guide for a Botswana safari got a shortlist
// of LODGES — the 72 `Lodge / Safari` properties in the hotel atlas — and never
// an itinerary, because the 274 itineraries were unreachable from the tool. No
// error, no empty result, no gap a reader would notice: a confident answer from
// the wrong atlas. The map showed the pins the whole time.
//
// The feed is journey-shaped (the same adaptJourney family as rail and jet), so
// this is trains.js with three differences, all of them the feed's:
//   - no named vessel: rail has `train`, safari has nothing equivalent
//   - 268 of 274 journeys are on-demand with a booking window rather than a
//     fixed departure, so the `onDemand` exemptions carry nearly the whole
//     collection rather than two thirds of it
//   - no `mq` stamp, so marquee keys are derived from the region tag here
//     (see TAG_MARQUEE) rather than read off the trip

const raw = require("../../data/atlas/safari/itinerary.json");
const itineraryFit = require("../../data/atlas/shared/itinerary-fit.json");
const { rankItems } = require("./supplier-fit");
const { dropPast, isPast, todayISO, sortOfferings, compareByDeparture } = require("./dates");

const ATLAS_URL = process.env.ATLAS_SAFARI_URL || "/atlas/safari";

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

// The collection's own vocabulary, stripped from free text for the same reason
// each atlas strips its own: searching "safari" inside the safari atlas must
// not match all 274 journeys.
const Q_STOPWORDS = new Set([
  "in", "the", "of", "at", "on", "a", "an", "and", "to", "for", "near", "or", "by",
  "safari", "safaris", "game", "drive", "drives", "journey", "journeys",
  "tour", "tours", "trip", "trips", "luxury", "wildlife",
]);

/**
 * Region tag -> marquee key, where the two genuinely name one place.
 *
 * The safari feed carries no `mq`, so without this a caller asking for
 * `region=galapagos` would get nothing from a collection that holds a Galápagos
 * journey. Only the unambiguous tags map: OKAVANGO covers Botswana, the
 * Okavango AND Namibia, so it is not folded into the `namibia` marquee — the
 * marquee is derived from the journey's own `country` instead.
 *
 * Four of these tags (ANTARCTIC, HIGHARCTIC, CHURCHILL, PATAGONIA) are declared
 * in the feed's REGIONS dictionary and used by no journey today. They are
 * mapped anyway, because the alternative is a silent zero the first time the
 * supplier files one — the same failure that put safari itself outside the
 * Guide for as long as it was.
 */
const TAG_MARQUEE = {
  ANTARCTIC: "antarctica",
  CHURCHILL: "arctic",
  HIGHARCTIC: "arctic",
  GALAPAGOS: "galapagos",
  AMAZONIA: "amazon",
  PATAGONIA: "patagonia",
  ALASKA: "alaska",
};
const MARQUEE = new Set(Object.values(TAG_MARQUEE).concat("namibia"));
const MARQUEE_CENTER = {
  antarctica: [-60, -64], arctic: [16, 78], galapagos: [-90.3, -0.7],
  amazon: [-58, -10], patagonia: [-72, -50], alaska: [-150, 58],
  namibia: [17, -22],
};

// Traveller words -> the atlas's own g[] keys, so `region=botswana` filters
// instead of silently broadening to everything. Same job the rail atlas's
// ATLAS_REGION_ALIASES does, over this collection's sixteen tags.
const ATLAS_REGION_ALIASES = {
  eastafrica: "EASTAFRICA", kenya: "EASTAFRICA", tanzania: "EASTAFRICA",
  serengeti: "EASTAFRICA", masaimara: "EASTAFRICA", maasaimara: "EASTAFRICA",
  mara: "EASTAFRICA", ngorongoro: "EASTAFRICA", greatmigration: "EASTAFRICA",
  migration: "EASTAFRICA",
  okavango: "OKAVANGO", botswana: "OKAVANGO", namibia: "OKAVANGO",
  delta: "OKAVANGO", kalahari: "OKAVANGO",
  southern: "SOUTHERN", southernafrica: "SOUTHERN", southafrica: "SOUTHERN",
  capetown: "SOUTHERN", cape: "SOUTHERN", sabisand: "SOUTHERN", krugernationalpark: "SOUTHERN",
  kruger: "SOUTHERN",
  zambezi: "ZAMBEZI", zambia: "ZAMBEZI", zimbabwe: "ZAMBEZI",
  victoriafalls: "ZAMBEZI", vicfalls: "ZAMBEZI",
  greatapes: "GREATAPES", rwanda: "GREATAPES", uganda: "GREATAPES",
  gorilla: "GREATAPES", gorillas: "GREATAPES", chimpanzee: "GREATAPES",
  indianocean: "INDIANOCEAN", madagascar: "INDIANOCEAN", mozambique: "INDIANOCEAN",
  alaska: "ALASKA", greatbear: "ALASKA", greatbearrainforest: "ALASKA",
  rockies: "ROCKIES", yellowstone: "ROCKIES", montana: "ROCKIES", wyoming: "ROCKIES",
  churchill: "CHURCHILL", manitoba: "CHURCHILL", polarbear: "CHURCHILL",
  polarbears: "CHURCHILL", canadiannorth: "CHURCHILL",
  higharctic: "HIGHARCTIC", svalbard: "HIGHARCTIC", spitsbergen: "HIGHARCTIC",
  antarctic: "ANTARCTIC", antarctica: "ANTARCTIC", southgeorgia: "ANTARCTIC",
  galapagos: "GALAPAGOS", ecuador: "GALAPAGOS",
  amazonia: "AMAZONIA", amazon: "AMAZONIA", pantanal: "AMAZONIA", brazil: "AMAZONIA",
  peru: "AMAZONIA",
  patagonia: "PATAGONIA", chile: "PATAGONIA", argentina: "PATAGONIA",
  torresdelpaine: "PATAGONIA",
  subcontinent: "SUBCONTINENT", india: "SUBCONTINENT", ranthambore: "SUBCONTINENT",
  tiger: "SUBCONTINENT", tigers: "SUBCONTINENT",
  borneo: "BORNEO", malaysia: "BORNEO", indonesia: "BORNEO", southeastasia: "BORNEO",
  orangutan: "BORNEO", orangutans: "BORNEO",
  africa: null, // too broad to pin to one tag — falls through to free text
};
const regionAliasKey = (v) => ATLAS_REGION_ALIASES[ci(v).replace(/[^a-z0-9]+/g, "")] || null;

// Searchable words per region tag, so "the Serengeti" or "gorilla trekking"
// matches the journeys it plainly describes instead of zeroing.
const REGION_HAY = {
  EASTAFRICA: "kenya tanzania east africa serengeti masai mara maasai ngorongoro great migration amboseli laikipia",
  OKAVANGO: "botswana okavango delta namibia kalahari makgadikgadi chobe linyanti skeleton coast sossusvlei",
  SOUTHERN: "south africa cape town cape winelands sabi sand kruger madikwe phinda garden route",
  ZAMBEZI: "zambia zimbabwe zambezi victoria falls south luangwa lower zambezi hwange mana pools",
  GREATAPES: "rwanda uganda gorilla gorillas chimpanzee volcanoes bwindi great apes",
  INDIANOCEAN: "madagascar mozambique indian ocean seychelles mauritius lemurs",
  ALASKA: "alaska great bear rainforest british columbia brown bears grizzly katmai",
  ROCKIES: "yellowstone rockies montana wyoming grand teton bison wolves",
  CHURCHILL: "churchill manitoba canada polar bear polar bears tundra hudson bay",
  HIGHARCTIC: "svalbard spitsbergen high arctic norway polar bear walrus",
  ANTARCTIC: "antarctica south georgia peninsula penguins weddell falklands",
  GALAPAGOS: "galapagos ecuador quito darwin tortoise iguana",
  AMAZONIA: "amazon pantanal brazil peru jaguar rainforest river",
  PATAGONIA: "patagonia chile argentina torres del paine puma southern cone",
  SUBCONTINENT: "india subcontinent ranthambore bandhavgarh tiger tigers rajasthan kaziranga",
  BORNEO: "borneo malaysia indonesia southeast asia orangutan orangutans sabah kinabatangan",
};

const BRANDS = raw.BRANDS || {};
const REGIONS = raw.REGIONS || {};
const brandName = (b) => (BRANDS[b] && BRANDS[b].short) || b || null;
const regionName = (tag) => (REGIONS[tag] && REGIONS[tag].name) || tag || null;

// "7/20/2026" -> "2026-07-20". Only 6 of 274 journeys carry a fixed date; the
// rest are windows.
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
  const marquee = (t.g || []).map((g) => TAG_MARQUEE[g]).find(Boolean)
    || (ci(t.country) === "namibia" ? "namibia" : null);
  return {
    id: `sf_${t.id}`,
    type: "safari",
    name: t.n,
    operator: brandName(t.b),
    brand: brandName(t.b),
    regionLabel: tag ? regionName(tag) : null,
    regionTags: t.g || [],
    region: marquee,
    country: t.country || null,
    from: t.from || null,
    to: t.to || null,
    stops,
    startDate,
    endDate: isoFromMdy(t.r),
    month: ym(startDate),
    months: t.mks || [],
    departures: t.depCount || (startDate ? 1 : 0),
    onDemand: !!t.onDemand,
    window: t.win || null,
    route: t.route || null,
    days: t.days || (Array.isArray(t.itin) ? t.itin.length : null),
    itinerary: Array.isArray(t.itin) ? t.itin : null,
    included: t.included || [],
    promotions: t.promotions || [],
    hasPromotion: Array.isArray(t.promotions) && t.promotions.length > 0,
    description: t.description || null,
    world: !!t.world,
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
  // The on-demand exemption carries almost this whole collection: 268 of 274
  // journeys have a booking window rather than a departure date, so a cutoff
  // that dropped them would empty the atlas.
  let list = dropPast(journeys);

  if (ids != null && String(ids).trim() !== "") {
    const set = new Set(String(ids).split(",").map((s) => s.trim()).filter(Boolean));
    list = list.filter((j) => set.has(j.id) || set.has(j.id.replace(/^sf_/, "")));
  }
  if (truthy(world)) list = list.filter((j) => j.world);
  if (region) {
    const v = ci(region);
    const tag = regionAliasKey(v)
      || (REGIONS[String(region).trim().toUpperCase()] ? String(region).trim().toUpperCase() : null);
    if (tag) list = list.filter((j) => j.regionTags.includes(tag));
    else if (MARQUEE.has(v)) list = list.filter((j) => j.region === v);
  }
  if (brand) {
    const v = ci(brand);
    list = list.filter((j) => ci(j.brand) === v);
  }
  if (month) {
    const v = String(month).trim();
    list = list.filter((j) => j.onDemand || j.month === v || j.months.includes(v));
  }
  if (year) {
    const v = String(year).trim();
    list = list.filter((j) => j.onDemand || j.months.some((k) => k.startsWith(v)));
  }

  /*
   * TWO haystacks, and the split is the point.
   *
   * `placeHay` is the journey's OWN geography — where it starts, ends, calls,
   * and the country the supplier files it under. `hay` adds the region family's
   * vocabulary on top, so free text like "the Serengeti" or "Victoria Falls"
   * still finds the journeys it plainly describes.
   *
   * `country=` reads placeHay ONLY. With one shared haystack it read the region
   * words too, and because REGION_HAY.OKAVANGO contains "namibia", every one of
   * the 81 Okavango journeys answered `country=Namibia` — while 17 journeys
   * are actually in Namibia. The Guide would have named Botswana itineraries as
   * Namibia options, which is precisely the failure its own prompt forbids:
   * "only present a category when the returned records genuinely reach the
   * destination". A region family is a good search hint and a bad country.
   */
  const placeHay = (j) => [
    j.name, j.brand, j.country, j.from, j.to, j.stops.join(" "),
  ].map(ci).join(" ");
  const hay = (j) => [
    placeHay(j), ci(j.regionLabel),
    j.regionTags.map((tag) => REGION_HAY[tag] || "").join(" "),
  ].join(" ");
  // Whole-word matching, for the same reason rail does it: "mara" must not
  // match Maramures, "cape" not Capetown-adjacent noise in a description.
  const hasWord = (text, term) =>
    new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  if (country != null && String(country).trim() !== "") {
    const v = ci(country); list = list.filter((j) => hasWord(placeHay(j), v));
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
    compareByDeparture(a, b));
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
  const today = todayISO();
  for (const j of journeys) {
    if (isPast(j, today)) continue;
    if (j.region && MARQUEE.has(j.region)) tally[j.region] = (tally[j.region] || 0) + 1;
  }
  const out = Object.keys(tally).map((region) => ({
    region, count: tally[region], center: MARQUEE_CENTER[region] || null,
    deepLink: buildDeepLink({ region }),
  })).sort((a, b) => b.count - a.count);
  const total = out.reduce((n, r) => n + r.count, 0);
  return { total, count: out.length, regions: out };
}

function query(params = {}) {
  // Departure order first, ranking second — see the note in trains.js: sort is
  // stable, so the base ordering survives ranking and breaks ties within an
  // equal fit score instead of feed position breaking them.
  const matched = rankItems(sortOfferings(filterJourneys(params)), params.intent, {
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
  journeys, filterJourneys, sortForIntent, clampLimit, clampOffset,
  buildDeepLink, query, regions, MARQUEE, ATLAS_URL,
};

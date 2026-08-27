#!/usr/bin/env node
/**
 * build-safari-camps — join the safari lodges we sell to the safari journeys
 * we list, and ship the result as its own small file.
 *
 *   node scripts/build-safari-camps.mjs            # write public/maps/safari/camps.json
 *   node scripts/build-safari-camps.mjs --check    # fail if the shipped file is stale
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 *
 * WORKORDER-safari-atlas.md calls this "the thing that makes this atlas
 * different from the other seven", and it is the whole argument for the
 * collection: every other atlas is half a trip. The hotel and villa atlases
 * plot places to stay and draw no routes; the jet, rail, yacht and cruise
 * atlases draw routes whose stops are cities, not beds. A safari is the one
 * product where the waypoint and the bed are the same object — you fly into
 * the airstrip and you sleep at the camp — so it is the only collection whose
 * itinerary stops are places we also sell, with perks, photographs and a
 * dossier already written.
 *
 * A traveller reading *Serengeti, Grumeti & Zanzibar* should be told, on that
 * journey's own file, that three of its nights are at Singita Grumeti — a
 * property we hold a year-stamped benefits block on. That sentence is what
 * this join produces.
 *
 * ── Why coordinates and not names ──────────────────────────────────────────
 *
 * The two feeds name the same place differently and always will. The hotel
 * feed says `Singita - Singita Grumeti`; the tour feed says
 * `Singita Grumeti Reserves`. `Sabi Sand Game Reserve` in an itinerary is
 * `Singita - Singita Sabi Sand` in the hotel feed, 4km away. No string metric
 * survives that pairing without also pairing things that are not the same
 * camp at all, and a false positive here is worse than a miss: it tells a
 * traveller they are sleeping somewhere they are not.
 *
 * Distance does survive it. A camp inside its own reserve is single-digit
 * kilometres from the stop the operator geocoded, and the nearest OTHER camp
 * we sell is much further away than that — the 30-odd African properties in
 * `Lodge / Safari` are spread over a continent. RADIUS_KM is 25: wide enough
 * for a reserve's own coordinate to differ from a lodge's by the width of the
 * reserve, tight enough that Sabi Sand cannot reach Kruger's rest camps.
 *
 * ── Why a separate file, and not a field on the itinerary ──────────────────
 *
 * The obvious place is a `camps` array on each TRIP in
 * data/atlas/safari/itinerary.json. It is the wrong place, because that file
 * is REBUILT from the Virtuoso feed by merge-virtuoso-journeys.mjs and this
 * join's other input — the hotel atlas — is rebuilt on a different schedule by
 * merge-virtuoso-hotels.mjs. A derived field that two independent rebuilds
 * both own goes stale silently on whichever one runs second. A file of its own
 * is rebuilt from both, and `--check` gates it.
 *
 * The payload is the other half of the argument: the whole hotel atlas is
 * 992 KB and the safari atlas has no business fetching it to name a dozen
 * camps. This file carries only the matched properties, at ~250 bytes each.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOTELS = path.join(ROOT, "data", "atlas", "hotel", "luxury-hotels.json");
const SAFARI = path.join(ROOT, "data", "atlas", "safari", "itinerary.json");
const OUT = path.join(ROOT, "public", "maps", "safari", "camps.json");

const CHECK = process.argv.includes("--check");

/**
 * The category, not a keyword.
 *
 * `Lodge / Safari` is `propertyType === 'Lodge, Ranch, Camp'` and nothing else
 * — see deriveCategory() in merge-virtuoso-hotels.mjs, where the second door
 * into this label (an `Ecotourism` tag) was closed because it filed a palazzo
 * on the Grand Canal as a safari lodge. Reading the category here means this
 * join inherits that fix rather than re-deciding it.
 */
const LODGE_CATEGORY = "Lodge / Safari";

/**
 * How near a camp has to be to a stop to be that stop's camp.
 *
 * Measured, not guessed. Across the shipped feeds the matched pairs sit at a
 * median of ~5km and the tail runs to the low twenties — a reserve's centroid
 * against a lodge inside it. Dropping to 10km loses real pairs (Sabi Sand's
 * lodges against the reserve's own coordinate); widening to 50km starts
 * pairing camps with the airstrip town they fly out of, which is a different
 * claim.
 */
const RADIUS_KM = 25;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Great-circle kilometres between two [lat, lng] pairs. */
function km(a, b) {
  const R = 6371;
  const p = Math.PI / 180;
  const dLat = (b[0] - a[0]) * p;
  const dLng = (b[1] - a[1]) * p;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The perk tags the card shows, from the same source the hotel atlas reads.
 *
 * Deliberately the SHORT form. The dossier for the property already exists on
 * the hotel atlas and carries the full year-stamped block; what this file
 * needs to carry is enough to make the link worth following.
 */
const require_ = (await import("node:module")).createRequire(import.meta.url);
const { hotelPerks } = require_("../lib/atlas/hotel-perks.js");

const hotels = JSON.parse(fs.readFileSync(HOTELS, "utf8"));
const safari = JSON.parse(fs.readFileSync(SAFARI, "utf8"));

const lodges = hotels
  .filter((h) => h.category === LODGE_CATEGORY)
  .map((h) => {
    const lat = num(h.lat);
    const lng = num(h.lng);
    if (lat === null || lng === null) return null;
    return {
      id: String(h.id || ""),
      at: [lat, lng],
      rec: {
        n: h.name || "",
        // The house, not the (usually empty) `brand` field: a traveller
        // recognises "Singita", and `brand` reads "None" on most of these.
        house: h.chain && h.chain !== "None" ? h.chain : null,
        country: h.country || null,
        ll: [lat, lng],
        thumb: h.thumb || null,
        rooms: num(h.numberOfRooms),
        perks: hotelPerks(h),
        promo: String(h.hasPromotion) === "true" || h.hasPromotion === true ? 1 : 0,
      },
    };
  })
  .filter(Boolean);

/*
 * Match every stop of every journey against every lodge.
 *
 * 269 journeys × ~7 stops × 72 lodges is 135k distance calls, which is
 * milliseconds. A spatial index would be faster and would be the wrong trade:
 * this runs in prebuild, and the naive loop is the version a reader can check.
 */
const CAMPS = {};
const BYTRIP = {};

const routes = safari.ROUTES || {};
const trips = safari.TRIPS || [];
const dayByTripStop = new Map();
for (const t of trips) {
  const days = new Map();
  for (const s of t.itin || []) {
    if (s && s.n != null && s.d != null && !days.has(s.n)) days.set(s.n, s.d);
  }
  dayByTripStop.set(String(t.id), days);
}

for (const t of trips) {
  const id = String(t.id);
  const stops = routes[id] || [];
  const days = dayByTripStop.get(id) || new Map();
  /*
   * One row per CAMP, not per stop. An out-and-back itinerary lists Windhoek
   * twice and a reserve's two lodges both sit by the same stop; the file this
   * feeds is a list of "camps on this journey", so the nearest stop wins and
   * the rest are dropped. Without this a nine-day circuit reads as fourteen
   * beds.
   */
  const best = new Map();
  for (const s of stops) {
    const ll = Array.isArray(s?.ll) ? s.ll : null;
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) continue;
    for (const l of lodges) {
      const d = km([ll[0], ll[1]], l.at);
      if (d > RADIUS_KM) continue;
      const prev = best.get(l.id);
      if (prev && prev.km <= d) continue;
      best.set(l.id, {
        id: l.id,
        stop: s.n || null,
        day: days.has(s.n) ? days.get(s.n) : null,
        km: Math.round(d * 10) / 10,
      });
    }
  }
  if (!best.size) continue;
  // Itinerary order where the day is known, then by distance — the dossier
  // renders this list verbatim and a traveller reads it as a sequence.
  const rows = [...best.values()].sort(
    (a, b) => (a.day ?? 999) - (b.day ?? 999) || a.km - b.km || a.id.localeCompare(b.id),
  );
  BYTRIP[id] = rows;
  for (const r of rows) {
    if (!CAMPS[r.id]) CAMPS[r.id] = lodges.find((l) => l.id === r.id).rec;
  }
}

/*
 * The count the SEO copy and the collection-level link are allowed to use.
 *
 * `lodges` is every Lodge / Safari property worldwide — it includes Patagonia,
 * the Serengeti, a Montana ranch and an Antarctic camp, because the category
 * is a property TYPE. `african` is the subset the safari atlas can honestly
 * call safari lodges, derived from the countries its own journeys visit rather
 * than from a hand-kept continent list, so a journey selector that reaches
 * into Namibia brings Namibia's camps with it.
 */
const journeyCountries = new Set(
  trips.map((t) => t.country).filter(Boolean),
);
const african = lodges.filter((l) => journeyCountries.has(l.rec.country));

const out = {
  _meta: {
    purpose:
      "Safari lodges from the hotel atlas, joined to safari journeys by coordinate proximity. Built by scripts/build-safari-camps.mjs; do not hand-edit.",
    built: "derived — see scripts/build-safari-camps.mjs",
    radiusKm: RADIUS_KM,
    lodgesInCategory: lodges.length,
    lodgesInSafariCountries: african.length,
    journeysWithCamps: Object.keys(BYTRIP).length,
    journeysTotal: trips.length,
    campsMatched: Object.keys(CAMPS).length,
  },
  radiusKm: RADIUS_KM,
  /** Every Lodge / Safari property, so the collection link can count honestly. */
  totals: {
    category: lodges.length,
    inSafariCountries: african.length,
  },
  CAMPS,
  BYTRIP,
};

const text = JSON.stringify(out, null, 1) + "\n";

if (CHECK) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== text) {
    console.error(
      "build-safari-camps: public/maps/safari/camps.json is stale — run `npm run build:safari-camps`",
    );
    process.exit(1);
  }
  console.log(
    `build-safari-camps: up to date (${out._meta.campsMatched} camps on ${out._meta.journeysWithCamps}/${out._meta.journeysTotal} journeys)`,
  );
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log(
  `build-safari-camps: ${out._meta.campsMatched} camps within ${RADIUS_KM}km of a stop, on ${out._meta.journeysWithCamps} of ${out._meta.journeysTotal} journeys ` +
    `(${lodges.length} in the category, ${african.length} in safari countries) → ${path.relative(ROOT, OUT)}`,
);

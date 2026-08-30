#!/usr/bin/env node
/**
 * build-gateway-hotels — join the hotels we sell to the cities the other five
 * journey collections start and finish in, and ship one small file per atlas.
 *
 *   node scripts/build-gateway-hotels.mjs          # write public/maps/<atlas>/gateways.json
 *   node scripts/build-gateway-hotels.mjs --check  # fail if a shipped file is stale
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 *
 * build-safari-camps.mjs made the argument for the safari atlas: the one
 * collection whose itinerary stops are places we also sell. It also said, in
 * passing, why the other six atlases could not have the same thing — "the jet,
 * rail, yacht and cruise atlases draw routes whose stops are cities, not beds."
 *
 * That is true of the MIDDLE of those journeys and false at both ends. A world
 * cruise leaves from Venice and a private jet expedition leaves from Seattle,
 * and nobody flies in on the morning of embarkation: there is a night before,
 * usually two, and a night after at the other end, and the supplier's file
 * covers neither. Those nights are the one part of these journeys we can book
 * outright — from the same 2,240 vetted hotels, with the same VIP perks — and
 * until now the atlas that plots the voyage and the atlas that plots the hotel
 * had nothing to say to each other.
 *
 * So: for every journey in the jet, rail, yacht, world-cruise and expedition
 * cruise collections, the hotels within reach of its FIRST stop and of its
 * LAST stop. Not the beds on the itinerary — the beds on either side of it.
 *
 * ── What the join claims, and what it does not ─────────────────────────────
 *
 *   The DATA says: this property, which we sell and hold perks on, is within
 *   RADIUS_KM of the place this journey begins (or ends).
 *
 *   The UI may therefore say: "where to stay before" / "after".
 *
 *   The UI may NOT say this is included, booked, or the operator's own
 *   pre-cruise hotel. Some fares do include a night at the gateway and the
 *   feed never says which; presenting ours as that one would be inventing a
 *   booking.
 *
 * ── Why the brand affinity ─────────────────────────────────────────────────
 *
 * Four of these collections are hotel houses that went to sea or into the air:
 * Four Seasons Yachts and the Four Seasons Private Jet, Aman at Sea and the
 * Aman Jet Expeditions, the Ritz-Carlton Yacht Collection, Belmond's trains,
 * the two Orient Express products. A traveller who has booked a Four Seasons
 * jet has already chosen a house, and the night before that jet leaves belongs
 * to it — Aman Venice is 400m from the berth an Aman at Sea voyage sails from,
 * and it is the answer to "where do we stay the night before" in a way that
 * the nearest unrelated palazzo is not.
 *
 * So each gateway carries the nearest few hotels AND the nearest hotel of each
 * house that this collection's journeys are branded to, and the read side puts
 * the journey's own house first. The affinity is matched on the journey's
 * brand, title and vessel, because the house is not always the operator: the
 * Four Seasons Private Jet expeditions are run by TCS World Travel and say so
 * in the feed's `b`, with "A Four Seasons Private Jet Experience" in the title.
 *
 * Explora is the instructive non-match. `Explora Journeys` is MSC's cruise line
 * and `Explora Atacama` is a Chilean lodge group; the names collide and the
 * companies have nothing to do with each other, so it is not in the table. An
 * affinity that is only a shared word is worse than none.
 *
 * ── Why one file per atlas, derived, and not a field on the itinerary ──────
 *
 * Same argument as the camps, for the same reason: the itineraries are rebuilt
 * from the Virtuoso feed by merge-virtuoso-journeys.mjs and the hotel atlas is
 * rebuilt on its own schedule by merge-virtuoso-hotels.mjs. A derived field
 * that two independent rebuilds both own goes stale silently on whichever one
 * runs second. These files are rebuilt from both, and `--check` gates them.
 *
 * The payload argument is stronger here than it was for the camps. The five
 * collections hold 5,300-odd journeys between them, but they leave from only a
 * few hundred distinct places — 4,311 expedition sailings sail from 176. So a
 * gateway is stored ONCE with its hotels, and a journey stores two keys into
 * that table. Storing the hotels per journey instead would repeat Ushuaia's
 * list several hundred times.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOTELS = path.join(ROOT, "data", "atlas", "hotel", "luxury-hotels.json");

const CHECK = process.argv.includes("--check");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/**
 * How near a hotel has to be to a gateway to be that gateway's hotel.
 *
 * Wider than the camps' 25km, and deliberately: that radius measured a lodge
 * against the reserve it sits inside, while this one measures a hotel against
 * a city — and the traveller arriving for a departure is arriving by air, so
 * the airport hotel counts as much as the one on the square. Venice's berth to
 * Marco Polo is 13km, Athens to Piraeus 11km, Tokyo to Narita 60km. 40km takes
 * the first two, misses the third, and stays inside the metro area nearly
 * everywhere: the median matched pair is under 5km and the tail is the airport.
 *
 * The cost of being generous is bounded by what the UI shows — every row
 * carries its distance and its city, so a hotel 38km out reads as 38km out.
 */
const RADIUS_KM = 40;

/**
 * How many hotels a gateway keeps, before the house picks are added.
 *
 * The dossier shows three per side. Four gives the read side something to work
 * with when it reorders for the journey's own house, without turning a file of
 * gateways into a copy of the hotel atlas.
 */
const PER_GATEWAY = 4;

/**
 * How far two stops of the same name may be apart and still be one gateway.
 *
 * City-scale: two feeds geocoding Kyoto to its station and to its centre are
 * 2km apart and are the same departure; Victoria, British Columbia and
 * Victoria, Seychelles are 15,000km apart and are not. Every value in between
 * is a judgement, and 15km puts the line at the edge of a city rather than at
 * the edge of the radius — a gateway is allowed to be imprecise about where in
 * Kyoto it is, and not about which Kyoto.
 */
const CLUSTER_KM = 15;

/**
 * The houses that sell both a bed and a journey.
 *
 * `journey` is matched against the journey's brand label, title and vessel;
 * `hotel` against the hotel's brand, chain and name. Both sides are needed:
 * "Four Seasons" is a `brand` on 62 hotels and part of the NAME on two more
 * (Beverly Wilshire), and on the journey side it is the title rather than the
 * operator on all 12 Four Seasons jet expeditions.
 *
 * Orient Express carries no `brand` in the hotel feed at all — the three
 * properties are filed under Accor — so it is matched by name, which is also
 * the only thing a traveller reads.
 */
const HOUSES = [
  {
    house: "Four Seasons",
    journey: /four seasons/i,
    hotel: (h) => h.brand === "Four Seasons" || /four seasons/i.test(h.name),
  },
  {
    house: "Aman",
    // "Aman at Sea", "Aman Jet Expedition". Anchored, so Amanpuri matches and
    // "Amankila"-style names do too, while "Hotel Amanda" does not.
    journey: /\baman\b|\baman jet\b/i,
    hotel: (h) => h.brand === "Aman" || h.chain === "Aman" || /^aman/i.test(h.name),
  },
  {
    house: "Ritz-Carlton",
    journey: /ritz-?carlton/i,
    hotel: (h) => /^ritz-carlton/.test(h.brand || "") || /ritz-carlton/i.test(h.name),
  },
  {
    house: "Belmond",
    journey: /belmond/i,
    hotel: (h) => h.brand === "Belmond" || /belmond/i.test(h.chain || "") || /belmond/i.test(h.name),
  },
  {
    house: "Orient Express",
    // Both the trains (La Dolce Vita Orient Express) and the yachts.
    journey: /orient[- ]express/i,
    hotel: (h) => /^orient express/i.test(h.name),
  },
];

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

const isPair = (v) => Array.isArray(v) && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]));

/** Verbatim from adapters/journey.ts `tripSlug()` — jet resolves routes by it. */
function tripSlug(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const require_ = (await import("node:module")).createRequire(import.meta.url);
const { hotelPerks } = require_("../lib/atlas/hotel-perks.js");

const rawHotels = JSON.parse(fs.readFileSync(HOTELS, "utf8"));
const hotels = rawHotels
  .map((h) => {
    const lat = num(h.lat);
    const lng = num(h.lng);
    if (lat === null || lng === null) return null;
    const name = h.name || "";
    const shaped = { name, brand: h.brand || null, chain: h.chain || null };
    const aff = HOUSES.find((x) => x.hotel(shaped))?.house ?? null;
    return {
      id: String(h.id || ""),
      at: [lat, lng],
      aff,
      rec: {
        n: name,
        // The house as a traveller names it, same rule the camps use: the
        // chain where the feed gives one, else the brand, else nothing —
        // `brand` reads null on half the atlas and `chain` reads "None".
        house:
          (h.chain && h.chain !== "None" ? String(h.chain).trim() : null) ||
          (h.brand ? String(h.brand).trim() : null),
        aff,
        city: h.city || null,
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

/* ── Readers: one per collection, each producing the same three things ──────
 *
 * `id`     keyed the way that atlas's component keys its dossier records —
 *          `String(t.id ?? index)` for the journey family (jet has no id on 27
 *          of its trips), `String(t.id)` for the voyages, the row id for cruise.
 *          A key that disagrees with the component is a file the UI can never
 *          read, and nothing else in the build would notice.
 * `houseText`  what the affinity is matched against: brand label, title, vessel.
 * `ends`   [first, last] as `{ n, ll }`, or nulls where the feed locates neither.
 */

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/** jet and rail: stops come from ROUTES, in the itinerary's order. */
function readJourneyAtlas(rel, { brandsFrom = "b" } = {}) {
  const raw = readJson(rel);
  const ROUTES = raw.ROUTES || {};
  const BRANDS = raw.BRANDS || {};
  return (raw.TRIPS || []).map((t, i) => {
    // Route lookup, as adapters/journey.ts does it: explicit key, then the
    // slugged title, then the trip id.
    const key =
      t.route && ROUTES[t.route] ? t.route
      : ROUTES[tripSlug(t.n)] ? tripSlug(t.n)
      : ROUTES[String(t.id)] ? String(t.id)
      : null;
    const stops = (key ? ROUTES[key] : []) || [];
    const byName = new Map();
    for (const s of stops) if (s?.n && !byName.has(s.n)) byName.set(s.n, s);

    // Itinerary order first — a route array is not always sailed in its own
    // order — falling back to the route's order when the names don't line up.
    const named = [];
    for (const e of t.itin || []) {
      if (e?.n && named[named.length - 1] !== e.n) named.push(e.n);
    }
    let located = named
      .map((n) => byName.get(n))
      .filter((s) => s && isPair(s.ll))
      .map((s) => ({ n: s.n, ll: [Number(s.ll[0]), Number(s.ll[1])] }));
    if (!located.length) {
      located = stops
        .filter((s) => isPair(s?.ll))
        .map((s) => ({ n: s.n || null, ll: [Number(s.ll[0]), Number(s.ll[1])] }));
    }
    const brandLabel = BRANDS[t[brandsFrom] || ""]?.short || null;
    return {
      id: String(t.id ?? i),
      houseText: [brandLabel, t.n, t.train].filter(Boolean).join(" "),
      ends: [located[0] || null, located[located.length - 1] || null],
    };
  });
}

/** yacht and world cruise: calls are names into a shared PORTS table. */
function readVoyageAtlas(rel) {
  const raw = readJson(rel);
  const PORTS = raw.PORTS || {};
  const BRANDS = raw.BRANDS || {};
  return (raw.TRIPS || [])
    .filter((t) => t && t.id != null)
    .map((t) => {
      let names = (t.itin || []).map((e) => String(e?.n || "").trim()).filter(Boolean);
      if (!names.length) names = [t.from, t.to].map((n) => String(n || "").trim()).filter(Boolean);
      const located = names
        .map((n) => ({ n, ll: PORTS[n] }))
        .filter((s) => isPair(s.ll))
        .map((s) => ({ n: s.n, ll: [Number(s.ll[0]), Number(s.ll[1])] }));
      const brandLabel = BRANDS[t.brand || ""]?.short || null;
      return {
        id: String(t.id),
        houseText: [brandLabel, t.operator, t.title, t.ship].filter(Boolean).join(" "),
        ends: [located[0] || null, located[located.length - 1] || null],
      };
    });
}

/** expedition cruise: a columnar feed, with the ports in the routes file. */
function readCruiseAtlas() {
  const sailings = readJson("data/atlas/cruise/sailings.json");
  const routes = readJson("public/maps/cruise/data/itinerary-routes.json").routes || {};
  const col = {};
  (sailings.schema || []).forEach((n, i) => { col[n] = i; });
  return (sailings.rows || []).map((r) => {
    const id = String(r[col.id] ?? "");
    const pts = (routes[id] || []).flatMap((d) => d.p || []);
    const located = pts
      .filter((p) => Array.isArray(p) && Number.isFinite(Number(p[1])) && Number.isFinite(Number(p[2])))
      .map((p) => ({ n: String(p[0] || ""), ll: [Number(p[1]), Number(p[2])] }));
    return {
      id,
      houseText: [r[col.operator], r[col.name], r[col.ship]].filter(Boolean).join(" "),
      ends: [located[0] || null, located[located.length - 1] || null],
    };
  }).filter((t) => t.id);
}

const COLLECTIONS = [
  { atlas: "jet", label: "Private jet expeditions", out: "public/maps/jet/gateways.json", read: () => readJourneyAtlas("data/atlas/jet/itinerary.json") },
  { atlas: "train", label: "Rail journeys", out: "public/maps/train/gateways.json", read: () => readJourneyAtlas("data/atlas/train/itinerary.json") },
  { atlas: "yacht", label: "Hotel yacht voyages", out: "public/maps/yacht/gateways.json", read: () => readVoyageAtlas("data/atlas/yacht/itinerary.json") },
  { atlas: "worldcruise", label: "World cruises", out: "public/maps/worldcruise/gateways.json", read: () => readVoyageAtlas("data/atlas/world/itinerary.json") },
  { atlas: "cruise", label: "Expedition sailings", out: "public/maps/cruise/gateways.json", read: readCruiseAtlas },
];

/** The hotels one gateway keeps: the nearest few, plus this atlas's houses. */
function pickForGateway(ll, housesWanted) {
  const near = [];
  for (const h of hotels) {
    const d = km(ll, h.at);
    if (d > RADIUS_KM) continue;
    near.push({ id: h.id, aff: h.aff, km: Math.round(d * 10) / 10 });
  }
  near.sort((a, b) => a.km - b.km || a.id.localeCompare(b.id));
  const kept = near.slice(0, PER_GATEWAY);
  const have = new Set(kept.map((x) => x.id));
  /*
   * The house pick, and it is why this list is not simply "the nearest four".
   * Aman Venice happens to be the second-nearest hotel to the Venice berth; the
   * Four Seasons at a gateway is routinely the ninth. A journey whose own house
   * has a hotel in the city and does not offer it has missed the easiest
   * recommendation in the product.
   */
  for (const house of housesWanted) {
    const hit = near.find((x) => x.aff === house && !have.has(x.id));
    if (hit) { kept.push(hit); have.add(hit.id); }
  }
  kept.sort((a, b) => a.km - b.km || a.id.localeCompare(b.id));
  return kept;
}

const results = [];

for (const c of COLLECTIONS) {
  if (only.length && !only.includes(c.atlas)) continue;
  const trips = c.read();

  // Which houses this collection actually sells, so a gateway is not carrying
  // a Belmond pick for a collection that has no Belmond journey in it.
  const housesWanted = [...new Set(
    trips.map((t) => HOUSES.find((h) => h.journey.test(t.houseText || ""))?.house).filter(Boolean),
  )].sort();

  const GATES = {};
  const BYTRIP = {};
  const HOTELS_OUT = {};
  let withPre = 0, withPost = 0, housed = 0;

  /*
   * Gateways are shared by name, and re-checked by coordinate.
   *
   * Sharing is the size argument: 4,311 expedition sailings leave from 113
   * places, and storing Ushuaia's hotels once instead of four hundred times is
   * the difference between a 440 KB file and a several-megabyte one. Two
   * journeys that both leave from "Kyoto" get the same gateway even where the
   * two feeds geocoded Kyoto 2km apart, and the hotels are then measured from
   * whichever coordinate defined it — noise, against a 40km radius.
   *
   * The coordinate check is what keeps that from becoming a lie. Stop names in
   * the jet and rail feeds are bare cities, and bare city names are not unique:
   * Victoria is in British Columbia and in the Seychelles, and a gateway that
   * pooled the two would offer a Canadian hotel for an Indian Ocean departure.
   * A name whose coordinate is more than CLUSTER_KM from the gateway already
   * holding it gets its own gateway instead of joining that one.
   */
  const variantsByName = new Map();
  const gate = (end) => {
    if (!end || !isPair(end.ll)) return null;
    const name = end.n || null;
    const variants = variantsByName.get(name ?? "") ?? [];
    const hit = variants.find((v) => km(v.ll, end.ll) <= CLUSTER_KM);
    // `null` is a gateway already searched and found empty — see below. The
    // check has to be here as well as at first use, or every journey after the
    // first is handed a key that was deleted from the shipped file.
    if (hit) return GATES[hit.key] ? hit.key : null;

    // First use of this name takes the name as its key; a genuinely different
    // place with the same name is disambiguated by its own coordinate. A stop
    // the feed never named is keyed by coordinate alone — it still locates a
    // hotel, and dropping it would cost the cruise atlas real embarkations.
    const key = name
      ? (variants.length ? `${name} @${end.ll[0].toFixed(2)},${end.ll[1].toFixed(2)}` : name)
      : `@${end.ll[0].toFixed(4)},${end.ll[1].toFixed(4)}`;
    variants.push({ key, ll: end.ll });
    variantsByName.set(name ?? "", variants);

    const picks = pickForGateway(end.ll, housesWanted);
    // Recorded either way: a gateway with no hotel within the radius — an
    // Antarctic base, a Pacific atoll — must not be searched again for every
    // one of the hundreds of sailings that leave from it.
    if (!picks.length) { GATES[key] = null; return null; }
    GATES[key] = { n: name, ll: [end.ll[0], end.ll[1]], h: picks.map((p) => [p.id, p.km]) };
    for (const p of picks) {
      if (!HOTELS_OUT[p.id]) HOTELS_OUT[p.id] = hotels.find((h) => h.id === p.id).rec;
    }
    return key;
  };

  for (const t of trips) {
    const pre = gate(t.ends[0]);
    const post = gate(t.ends[1]);
    const house = HOUSES.find((h) => h.journey.test(t.houseText || ""))?.house ?? null;
    if (!pre && !post) continue;
    const row = { pre, post };
    if (house) { row.house = house; housed++; }
    BYTRIP[t.id] = row;
    if (pre) withPre++;
    if (post) withPost++;
  }

  // Gateways that matched nothing are held as null above so the search is not
  // repeated; they have no business in the shipped file.
  for (const k of Object.keys(GATES)) if (!GATES[k]) delete GATES[k];

  const out = {
    _meta: {
      purpose:
        `Hotels from the hotel atlas within ${RADIUS_KM}km of where a ${c.label.toLowerCase()} journey begins and ends — the nights before and after. Built by scripts/build-gateway-hotels.mjs; do not hand-edit.`,
      built: "derived — see scripts/build-gateway-hotels.mjs",
      atlas: c.atlas,
      radiusKm: RADIUS_KM,
      clusterKm: CLUSTER_KM,
      journeysTotal: trips.length,
      journeysWithStays: Object.keys(BYTRIP).length,
      journeysWithHouse: housed,
      gateways: Object.keys(GATES).length,
      hotels: Object.keys(HOTELS_OUT).length,
      houses: housesWanted,
    },
    radiusKm: RADIUS_KM,
    clusterKm: CLUSTER_KM,
    HOTELS: HOTELS_OUT,
    GATES,
    BYTRIP,
  };

  const text = JSON.stringify(out, null, 1) + "\n";
  const file = path.join(ROOT, c.out);
  results.push({ c, out, text, file, withPre, withPost });
}

let stale = 0;
for (const r of results) {
  if (CHECK) {
    const current = fs.existsSync(r.file) ? fs.readFileSync(r.file, "utf8") : "";
    if (current !== r.text) {
      console.error(
        `build-gateway-hotels: ${r.c.out} is stale — run \`npm run build:gateway-hotels\``,
      );
      stale++;
      continue;
    }
    console.log(
      `build-gateway-hotels: ${r.c.atlas} up to date (${r.out._meta.journeysWithStays}/${r.out._meta.journeysTotal} journeys, ${r.out._meta.gateways} gateways)`,
    );
    continue;
  }
  fs.mkdirSync(path.dirname(r.file), { recursive: true });
  fs.writeFileSync(r.file, r.text);
  console.log(
    `build-gateway-hotels: ${r.c.atlas} — ${r.out._meta.hotels} hotels at ${r.out._meta.gateways} gateways, ` +
      `on ${r.out._meta.journeysWithStays} of ${r.out._meta.journeysTotal} journeys ` +
      `(${r.out._meta.journeysWithHouse} brand-matched) → ${path.relative(ROOT, r.file)}`,
  );
}
if (stale) process.exit(1);

#!/usr/bin/env node
// Rebuilds the five journey atlases from the Virtuoso feeds.
//
//   data/atlas/shared/virtuoso-cruises.json  -> expedition, yacht, world cruise
//   data/atlas/shared/virtuoso-tours.json    -> private jet, rail
//
// Each atlas keeps its curated half. BRANDS, REGIONS and the hand-written
// operator blurbs come from the `.base.json` beside each feed and are never
// regenerated — the API has no opinion about how we group or describe our
// suppliers. What it does own is the sailings and departures themselves, their
// dates, their ships, and above all their day-by-day stops.
//
// THE POINT OF THE EXERCISE IS COORDINATES. Every stop the API returns carries
// the operator's own latitude and longitude. Until now those were geocoded from
// scraped place names, with the misses patched by hand in port-overrides.json
// and 712 of 3,542 expedition sailings left untraceable. Routes are drawn from
// these numbers, so better numbers are better routes everywhere at once.
//
// Writes BOTH copies of every dual-copy file (data/atlas/… and public/maps/…),
// because the server reads one and the browser fetches the other — the same
// rule scripts/fix-port-locations.mjs follows.
//
//   node scripts/merge-virtuoso-journeys.mjs
//   node scripts/merge-virtuoso-journeys.mjs --atlas yacht
//   node scripts/merge-virtuoso-journeys.mjs --check

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/virtuoso/env.mjs';
import { cardImage, journeyPhotoKey } from '../lib/virtuoso/media.mjs';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const FORCE = args.includes('--force');
const ONLY = (() => { const i = args.indexOf('--atlas'); return i >= 0 ? args[i + 1] : null; })();

const read = rel => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
const exists = rel => fs.existsSync(path.join(repoRoot, rel));

const CRUISES = exists('data/atlas/shared/virtuoso-cruises.json')
  ? read('data/atlas/shared/virtuoso-cruises.json').cruises : [];
const TOURS = exists('data/atlas/shared/virtuoso-tours.json')
  ? read('data/atlas/shared/virtuoso-tours.json').tours : [];

const report = [];
const written = [];

/*
 * Hero photographs for the journeys the API supplies none for.
 *
 * Harvested by scripts/harvest-journey-photos.mjs from the operator's own page
 * — see data/atlas/shared/journey-photo-sources.json. Read here rather than
 * fetched here on purpose: the merge runs in `prebuild` and in a nightly
 * unattended Action, and neither may depend on a supplier's marketing site
 * being up. Missing file means no overlay, not a failure.
 */
const PHOTOS = exists('data/atlas/shared/journey-photos.json')
  ? (read('data/atlas/shared/journey-photos.json').photos ?? {})
  : {};

/**
 * The picture for a card: the supplier's, then the first of its gallery, then
 * ours.
 *
 * The gallery step is not padding. One rail journey ships a null
 * `defaultImageUrl` and three perfectly good brochure photographs right beside
 * it, so the only thing standing between that card and a picture was never
 * looking at the second field.
 */
function heroFor(record, trip) {
  const supplied = cardImage(record?.image) ?? cardImage((record?.images ?? [])[0]);
  if (supplied) return supplied;
  return PHOTOS[journeyPhotoKey(trip)]?.url ?? null;
}

/*
 * Two guards, both learned the hard way by overwriting five live atlases with a
 * half-finished crawl.
 *
 * The API goes into maintenance without warning, and a partial crawl looks
 * exactly like a complete one to a merge that only reads what it was given. So
 * the merge refuses an incomplete feed outright, and refuses again if any single
 * atlas would lose more than a quarter of its journeys. Departures genuinely
 * expire, so some shrink is real — a quarter of an atlas disappearing overnight
 * is not.
 */
const MIN_DETAIL_COVERAGE = 0.9;
const MAX_ATLAS_SHRINK = 0.25;

function requireCompleteFeed(label, records, hasDetail) {
  if (!records.length) return;
  const withDetail = records.filter(hasDetail).length;
  const coverage = withDetail / records.length;
  if (coverage >= MIN_DETAIL_COVERAGE || FORCE) return;
  const state = `the ${label} feed is incomplete — ${withDetail} of ${records.length} records ` +
    `(${Math.round(coverage * 100)}%) have a day-by-day itinerary`;
  if (CHECK) {
    // Nothing to verify yet is not the same as something being wrong. A crawl
    // still in progress must not turn `npm run verify` red for the whole repo.
    console.log(`  pending  ${state}; journey atlases not yet rebuilt`);
    process.exit(0);
  }
  console.error(`REFUSING: ${state}.`);
  console.error('Finish the crawl before merging, or pass --force if you really mean to publish a partial atlas.');
  process.exit(1);
}

// ---------- shared helpers ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-25" -> "25 Oct 2026", the format the existing feeds display. */
function prettyDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

const slugKey = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Match an API cruise line or tour company onto one of an atlas's brand keys. */
function brandMatcher(BRANDS) {
  const index = new Map();
  for (const [key, meta] of Object.entries(BRANDS)) {
    index.set(slugKey(key), key);
    if (meta?.short) index.set(slugKey(meta.short), key);
  }
  const NOISE = /(cruises|cruise|line|lines|collection|the|llc|usa|inc|ltd|group|expeditions|yachts|yacht)/g;
  const loose = s => slugKey(String(s ?? '').toLowerCase().replace(NOISE, ''));
  const looseIndex = new Map();
  for (const [key, meta] of Object.entries(BRANDS)) {
    looseIndex.set(loose(key), key);
    if (meta?.short) looseIndex.set(loose(meta.short), key);
  }
  return name => {
    if (!name) return null;
    const exact = index.get(slugKey(name));
    if (exact) return exact;
    const l = loose(name);
    if (looseIndex.has(l)) return looseIndex.get(l);
    // Longest containment wins: "Azamara Cruises" onto "azamara".
    let best = null;
    for (const [k, key] of looseIndex) {
      if (!k) continue;
      if ((l.includes(k) || k.includes(l)) && (!best || k.length > best.len)) best = { key, len: k.length };
    }
    return best?.key ?? null;
  };
}

const R = 6371;
const rad = d => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Which of an atlas's regions a set of stops touches.
 *
 * Each atlas defines its own regions with a representative coordinate, and a
 * journey is tagged with every region it actually calls at — so the rail atlas's
 * BRITAIN and the yacht atlas's ADRIATIC keep their own vocabularies rather than
 * being flattened into one shared list. A stop further than MAX_REGION_KM from
 * every region is left untagged instead of being forced into the least-wrong
 * bucket, which is how a Chilean fjord ends up filed under Norway.
 */
const MAX_REGION_KM = 2500;

/** The single region a stop sits in, or null if it is nowhere near one. */
function regionOf(point, REGIONS) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;
  let best = null, bestKm = Infinity;
  for (const [key, r] of Object.entries(REGIONS)) {
    if (!Array.isArray(r.coord)) continue;
    const km = haversine([point.lat, point.lng], r.coord);
    if (km < bestKm) { bestKm = km; best = key; }
  }
  return best && bestKm <= MAX_REGION_KM ? best : null;
}

function regionsFor(points, REGIONS) {
  const hits = new Set();
  for (const p of points) { const r = regionOf(p, REGIONS); if (r) hits.add(r); }
  // Keep the atlas's own declared order, not insertion order.
  return Object.keys(REGIONS).filter(k => hits.has(k));
}

/** Write a file and its public twin together. */
function writePair(rel, publicRel, value) {
  const json = JSON.stringify(value, null, 1);
  for (const target of [rel, publicRel].filter(Boolean)) {
    const full = path.join(repoRoot, target);
    if (CHECK) {
      /*
       * Existence, not byte-equality.
       *
       * These outputs are deliberately edited after the merge writes them —
       * fix-port-locations applies the override ledger to the very same files —
       * so a byte comparison against a fresh merge reports STALE on a perfectly
       * healthy tree, every time. What is worth checking in CI is that the merge
       * still runs against the current feeds and that its outputs exist; the
       * atlas verifiers check the contents properly.
       */
      if (!fs.existsSync(full)) { console.error(`MISSING: ${target}`); process.exitCode = 1; }
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, json);
    written.push(target);
  }
}

const wanted = name => !ONLY || ONLY === name;

/*
 * Entries that are not ports of call.
 *
 * Operators list mid-ocean markers as itinerary stops — "Pacific Ocean
 * (Cruising)", "International Dateline (Crossing)", "Day-at-Sea" — each with a
 * nominal position somewhere out in the water. Treated as calls they make the
 * ship detour thousands of kilometres to touch a point in the open sea. They
 * are days, not places, so they stay out of the port tables and the drawn route
 * and become the sea days they describe.
 */
const NON_PORT = /\((cruising|crossing)\)|day[- ]at[- ]sea|scenic cruising|at sea|air travel/i;
const isPort = name => Boolean(name) && !NON_PORT.test(name);

/** Refuse to shrink an atlas past the point where expiry explains it. */
function guardShrink(atlas, next, before) {
  if (FORCE || !before) return true;
  const shrink = (before - next) / before;
  if (shrink <= MAX_ATLAS_SHRINK) return true;
  console.error(`REFUSING ${atlas}: ${before} journeys would become ${next} ` +
    `(${Math.round(shrink * 100)}% smaller, limit ${MAX_ATLAS_SHRINK * 100}%). Left untouched.`);
  process.exitCode = 1;
  return false;
}

// ---------- yacht and world cruise ----------

/**
 * Both are the same shape: TRIPS of port calls over PORTS, differing only in
 * which sailings they draw and how long those sailings are.
 */
function buildSeaAtlas({ atlas, baseRel, outRel, publicRel }) {
  const base = read(baseRel);
  const BRANDS = base.BRANDS ?? {};
  const REGIONS = base.REGIONS ?? {};
  const toBrand = brandMatcher(BRANDS);

  const sailings = CRUISES.filter(c => c.atlases.includes(atlas));
  const PORTS = {};
  const TRIPS = [];
  let unmatchedBrand = 0, noItinerary = 0;

  for (const c of sailings) {
    const brand = toBrand(c.line);
    if (!brand) { unmatchedBrand++; continue; }
    if (!c.itinerary.length) { noItinerary++; continue; }

    for (const p of c.itinerary) {
      if (isPort(p.n) && Number.isFinite(p.lat) && Number.isFinite(p.lng)) PORTS[p.n] = [p.lat, p.lng];
    }

    /*
     * Days the ship is at sea are absent from the supplier's stop list, so they
     * are reconstructed from the gaps: walking the day numbers turns 1,2,3,5
     * into a call, a call, a call and one `{s:1}` sea day. The atlas draws sea
     * days as spacing in the itinerary column, so losing them shortens a voyage
     * on screen.
     */
    const byDay = new Map();
    for (const p of c.itinerary) if (p.d != null && !byDay.has(p.d)) byDay.set(p.d, p);
    const lastDay = Math.max(...byDay.keys(), 0);
    const itin = [];
    for (let d = 1; d <= lastDay; d++) {
      const p = byDay.get(d);
      if (p && isPort(p.n)) itin.push({ n: p.n, d });
      else if (p) itin.push({ s: 1 });
      else itin.push({ s: 1 });
    }

    const [sy, sm, sd] = (c.startDate ?? '').split('-').map(Number);
    TRIPS.push({
      title: c.days ? `${c.name} (${c.days + 1} days)` : c.name,
      ship: c.ship ?? null,
      brand,
      dates: [prettyDate(c.startDate), prettyDate(c.endDate)].filter(Boolean).join(' - '),
      startY: sy ?? null, startM: sm ?? null, startD: sd ?? null,
      monthKey: sy && sm ? `${sy}-${String(sm).padStart(2, '0')}` : null,
      ...(atlas === 'world' ? { days: (c.days ?? 0) + 1 } : {}),
      from: c.startPort ?? null,
      to: c.endPort ?? null,
      route: [c.startPort, c.endPort].filter(Boolean).join(' to ') || null,
      /*
       * The Virtuoso product id, not a counter.
       *
       * These feeds are rebuilt nightly, and a sequential id would be handed to
       * a different sailing every time the set changed — quietly repointing every
       * saved link and share URL at another voyage. The product id belongs to the
       * sailing for as long as it is sold.
       */
      id: c.id,
      g: regionsFor(c.itinerary, REGIONS),
      u: c.path ? `https://www.virtuoso.com/advisor/brianharris${c.path}` : null,
      image: cardImage(c.image) ?? null,
      description: c.description || null,
      promotions: c.promotions ?? [],
      itin,
    });
  }

  if (!guardShrink(atlas, TRIPS.length, base.TRIPS?.length ?? 0)) return;
  const out = { ...base, BRANDS, REGIONS, PORTS, TRIPS };
  writePair(outRel, publicRel, out);
  report.push(`${atlas}: ${TRIPS.length} trips (base had ${base.TRIPS?.length ?? 0}) · ${Object.keys(PORTS).length} ports` +
    `${unmatchedBrand ? ` · ${unmatchedBrand} skipped, brand unmatched` : ''}` +
    `${noItinerary ? ` · ${noItinerary} skipped, no itinerary yet` : ''}`);
}

// ---------- expedition cruise ----------

function buildExpedition() {
  const base = read('data/atlas/cruise/sailings.base.json');
  const sailings = CRUISES.filter(c => c.atlases.includes('expedition') && c.itinerary.length);

  if (!guardShrink('expedition', sailings.length, base.rows.length)) return;
  const rows = sailings.map(c => [
    c.id,
    c.line ?? '',
    c.name,
    c.startDate ?? '',
    c.days ?? 0,
    // The supplier's coarse marketing bucket. scripts/build-cruise-regions.mjs
    // overlays the real answer from the itinerary; this is only the seed.
    (c.destinationRegions ?? [])[0] ?? '',
    c.path ? String(c.path).split('/').pop() : '',
    '',
    c.ship ?? '',
    // The supplier's photograph, so the expedition cards can show one like the
    // other atlases. Appended rather than inserted: the schema is read by index.
    cardImage(c.image) ?? '',
  ]);

  writePair('data/atlas/cruise/sailings.json', 'public/maps/cruise/sailings.json',
    { schema: [...base.schema.filter(c => c !== 'image'), 'image'],
      urlBase: base.urlBase, productBase: base.productBase, rows });

  /*
   * The day-by-day route file the map draws from, now built straight out of the
   * supplier's coordinates rather than a geocoder. `s` marks a sea day and `p`
   * is the ordered stops for that day as [name, lat, lng].
   */
  const routes = {};
  let stops = 0, placed = 0;
  for (const c of sailings) {
    const byDay = new Map();
    for (const p of c.itinerary) {
      if (!byDay.has(p.d ?? 0)) byDay.set(p.d ?? 0, []);
      byDay.get(p.d ?? 0).push(p);
    }
    const lastDay = Math.max(...byDay.keys(), 0);
    const days = [];
    for (let d = 1; d <= lastDay; d++) {
      const pts = byDay.get(d) ?? [];
      stops += pts.length;
      placed += pts.filter(p => Number.isFinite(p.lat)).length;
      days.push({
        d,
        s: pts.length ? 0 : 1,
        p: pts.map(p => (isPort(p.n) && Number.isFinite(p.lat) && Number.isFinite(p.lng))
          ? [p.n, p.lat, p.lng]
          : [p.n, null, null]),
      });
    }
    routes[c.id] = days;
  }

  writePair(null, 'public/maps/cruise/data/itinerary-routes.json', {
    _meta: {
      generatedAt: new Date().toISOString(),
      sourceFile: 'data/atlas/shared/virtuoso-cruises.json',
      routeCount: Object.keys(routes).length,
      placedStops: placed,
      totalStops: stops,
      notes: [
        'Day-by-day stops for the expedition atlas, from the Virtuoso API.',
        'Coordinates are the operator\'s own, not geocoded from port names.',
      ],
    },
    routes,
  });

  report.push(`expedition: ${rows.length} sailings (base had ${base.rows.length}) · ` +
    `${placed}/${stops} stops carry coordinates (${Math.round((placed / Math.max(stops, 1)) * 100)}%)`);
}

// ---------- departures ----------

/*
 * WHEN a tour goes, in the supplier's own words.
 *
 * `travelDates` comes back in exactly three shapes across all 226 journeys, and
 * they mean three different things:
 *
 *   "Dates: 28 Jan 2028 - 12 Feb 2028"                55  one fixed departure
 *   "Valid for Departures: 16 Sep 2026 - 26 Oct 2026" 44  a season of departures
 *   "Valid for Departures Now Through: 01 Jun 2027"  127  open, book any time
 *
 * The distinction is the whole reason the jet and rail cards lost their dates.
 * `startDate`/`endDate` are populated on all three, so reading them blindly
 * publishes "16 Sep – 26 Oct" as the length of a fourteen-day journey, and
 * "1 Jun 2024 – 1 Jun 2027" as a private jet departure two years in the past.
 * Only the first shape is a departure and a return; in the second the pair is
 * the first and last departure of a season; in the third it is a shelf life.
 *
 * Only the first shape gets a departure date. A season and an open window are
 * both "no specific date yet" as far as a traveller is concerned, so both are
 * published as booking windows and both sort past everything that has a real
 * departure. Publishing the first day of a season as though it were THE
 * departure was the tempting middle road and it is a lie in both directions:
 * it puts a journey you can take in June among the September departures, and it
 * prints one date on a product sold across six weeks of them.
 */
function departureOf(tour) {
  const label = String(tour.travelDates ?? '').trim();
  const start = tour.startDate ?? null;
  const end = tour.endDate ?? null;
  if (/^dates\s*:/i.test(label)) return { kind: 'fixed', start, end };
  if (/^valid for departures\s*:/i.test(label)) return { kind: 'season', start: null, end: null, window: end };
  if (/^valid for departures now through/i.test(label)) return { kind: 'open', start: null, end: null, window: end };
  /*
   * No label at all. Trust the dates only if they read like one journey rather
   * than a window — a start and end more than a season apart is a shelf life
   * wearing a departure's clothes.
   */
  if (start && end) {
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
    if (Number.isFinite(days) && days >= 0 && days <= 120) return { kind: 'fixed', start, end };
  }
  return { kind: 'open', start: null, end: null };
}

/** "2026-09-16" -> "9/16/2026". Both journey atlases store US format. */
function usDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return `${m}/${d}/${y}`;
}

const MONTH_INDEX = new Map(
  ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december']
    .map((m, i) => [m, String(i + 1).padStart(2, '0')]),
);

/**
 * `departureMonths` ("August 2026") as the atlas's month keys ("2026-08").
 *
 * These drive the month filter, which is the only control that can find a
 * journey with no single departure date. A season running May through October
 * has to answer to all six months, not to whichever one its first departure
 * happens to fall in.
 */
function monthKeys(departureMonths) {
  const keys = [];
  for (const label of departureMonths ?? []) {
    const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(String(label).trim());
    if (!m) continue;
    const mm = MONTH_INDEX.get(m[1].toLowerCase());
    if (mm) keys.push(`${m[2]}-${mm}`);
  }
  return [...new Set(keys)].sort();
}

/*
 * Longitude actually covered, in degrees, walking the route as flown.
 *
 * Unrolled leg by leg rather than measured min-to-max on raw longitudes: a
 * journey Tokyo → Los Angeles → London reads as a 258° span on raw numbers and
 * as the 190° it really crosses once the dateline hop is unrolled. A journey
 * that circles the planet lands near 360.
 */
function routeLongitudeSpan(stops) {
  if (!Array.isArray(stops) || stops.length < 2) return 0;
  let prev = stops[0]?.ll?.[1];
  if (!Number.isFinite(prev)) return 0;
  let walked = 0, min = 0, max = 0;
  for (let i = 1; i < stops.length; i++) {
    const lng = stops[i]?.ll?.[1];
    if (!Number.isFinite(lng)) continue;
    let step = lng - prev;
    while (step > 180) step -= 360;
    while (step < -180) step += 360;
    walked += step;
    min = Math.min(min, walked);
    max = Math.max(max, walked);
    prev = lng;
  }
  return max - min;
}

/*
 * Round-the-world, for the jet atlas's "Around the World" view.
 *
 * Geometry first, because it is the honest test: a journey that crosses half
 * the planet's longitude is a global one whatever it calls itself, and 180° is
 * where the Four Seasons and TCS globe-circlers sit while the regional jet
 * charters sit far below it.
 *
 * The name is checked too, and not as a nicety. Aman's "Around the World in
 * Three Continents" spans 144° — genuinely three continents, genuinely sold as
 * a round-the-world journey — and a traveller who opens the Around the World
 * view is looking for it. When an operator says this is the round-the-world
 * trip, that is a fact about the product, not a marketing flourish to correct.
 */
const WORLD_NAME = /\baround the world\b|\bworld tour\b|seven continents|circumnavigat|\bgrandest tour\b|\bworld less traveled\b/i;
const WORLD_MIN_SPAN = 180;

function isRoundTheWorld(name, stops) {
  if (WORLD_NAME.test(String(name ?? ''))) return true;
  return routeLongitudeSpan(stops) >= WORLD_MIN_SPAN;
}

/*
 * The named trains behind rail's "Legendary Trains" view.
 *
 * The API has no field for which train a journey rides, so this is a curated
 * ledger — see data/atlas/train/legendary-trains.json for why, and why the
 * order of its entries matters.
 */
const LEGENDARY_TRAINS = (() => {
  if (!exists('data/atlas/train/legendary-trains.json')) return [];
  return (read('data/atlas/train/legendary-trains.json').trains ?? [])
    .map(t => ({ name: t.name, re: new RegExp(t.match, 'i') }))
    .filter(t => t.name);
})();

function trainFor(tour) {
  const haystack = [tour.name, tour.company, tour.description].filter(Boolean).join(' ');
  return LEGENDARY_TRAINS.find(t => t.re.test(haystack))?.name ?? null;
}

// ---------- private jet and rail ----------

function buildTourAtlas({ atlas, kind, baseRel, outRel, publicRel }) {
  const base = read(baseRel);
  const BRANDS = base.BRANDS ?? {};
  const REGIONS = base.REGIONS ?? {};
  const toBrand = brandMatcher(BRANDS);

  /*
   * Journeys of our own making stay put.
   *
   * The jet atlas carries 27 trips with no virtuoso.com link — 18 Safrans du
   * Monde and 9 National Geographic — that we built and the API has never heard
   * of. They are identified by that missing link rather than by a hard-coded
   * brand list, so anything else bespoke survives a rebuild automatically.
   */
  const bespokeRaw = (base.TRIPS ?? []).filter(t => !/virtuoso\.com/.test(t.u ?? ''));
  const bespokeIds = new Set(bespokeRaw.map(t => String(t.id)));

  /*
   * Staying put is not the same as being exempt.
   *
   * Five of the bespoke jet journeys are called "Around the World by Private
   * Jet" and carried no `world` flag, so the atlas's Around the World view —
   * the one place a traveller goes looking for exactly those — did not list
   * the trips whose titles are the name of the view. The base never had to say
   * so while the flag was scraped alongside it; now that the flag is derived,
   * the derivation has to reach these too.
   *
   * Filled in, never overwritten: where the base states a `world` value that
   * is our editorial call and it wins.
   */
  const bespoke = bespokeRaw.map(t => {
    const patch = {};
    if (kind !== 'rail' && t.world == null && isRoundTheWorld(t.n, (base.ROUTES ?? {})[t.route] ?? [])) {
      patch.world = true;
    }
    // The whole reason the photo overlay exists: these are the journeys with no
    // supplier record to take a picture from.
    if (!t.img) {
      const harvested = PHOTOS[journeyPhotoKey(t)]?.url;
      if (harvested) patch.img = harvested;
    }
    return Object.keys(patch).length ? { ...t, ...patch } : t;
  });

  /*
   * A place keeps the region the atlas already gave it.
   *
   * Nearest-coordinate is a crude classifier and it loses to editorial
   * judgement: Ulaanbaatar is 2,300km from the EASTASIA anchor and 2,800km from
   * SILK, so geometry files Mongolia under East Asia while this atlas has always
   * called it Silk Road. Worse, the bespoke routes we preserve still say SILK,
   * so the two disagreed about the same city. The existing assignment wins and
   * geometry only decides places the atlas has never seen — which is the same
   * rule the whole migration follows: the API owns facts, we own curation.
   */
  const inheritedRegion = new Map();
  for (const stops of Object.values(base.ROUTES ?? {})) {
    for (const stop of stops ?? []) if (stop?.n && stop.r) inheritedRegion.set(stop.n, stop.r);
  }
  const regionForStop = p => inheritedRegion.get(p.place) ?? regionOf(p, REGIONS);

  const tours = TOURS.filter(t => t.kinds.includes(kind) && t.itinerary.length);
  const ROUTES = { ...(base.ROUTES ?? {}) };
  const TRIPS = [...bespoke];
  let unmatchedBrand = 0;

  for (const t of tours) {
    const brand = toBrand(t.company);
    if (!brand) { unmatchedBrand++; continue; }
    if (bespokeIds.has(String(t.id))) continue;

    // One waypoint per distinct place, in order — consecutive repeats collapse.
    const waypoints = [];
    for (const p of t.itinerary) {
      if (!isPort(p.place) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const last = waypoints[waypoints.length - 1];
      if (last && last.n === p.place) continue;
      /*
       * Each stop carries the region it is actually in, not the journey's first.
       * verify-atlas-regions builds one global stop-name -> region table across
       * every route, so stamping a trip-level region onto each of its stops made
       * a shared city take whichever journey was processed last and put Cairo in
       * the Middle East on one route and Europe on another.
       */
      waypoints.push({ n: p.place, r: regionForStop(p), ll: [p.lat, p.lng] });
    }
    if (waypoints.length < 2) continue;

    // The journey's regions are exactly those its drawn stops carry.
    const g = Object.keys(REGIONS).filter(k => waypoints.some(w => w.r === k));
    ROUTES[t.id] = waypoints;

    /*
     * The listed itinerary and the drawn route describe the same stops.
     *
     * Building the itinerary from every entry while the route kept only the
     * placed ones let a coordinate-less stop be resolved through some other
     * journey's copy of that name — which is how a trip ended up "tagged CANADA"
     * with a South American stop the region tags never mentioned. Deriving both
     * from `waypoints` makes the two agree by construction.
     */
    const dayOf = new Map();
    for (const p of t.itinerary) if (p.place != null && !dayOf.has(p.place)) dayOf.set(p.place, p.day);
    const itin = waypoints.map((w, n) => ({ d: dayOf.get(w.n) ?? n + 1, n: w.n }));

    /*
     * Departure, month keys, and the two marketing views.
     *
     * `d`/`r` are what the whole atlas orders by — lib/atlas/dates.js reads
     * them through `departureKey`, and a trip without one sorts past every
     * dated trip as "no departure". The migration wrote neither, so all 95 API
     * jet journeys and all 127 rail journeys landed in that bucket at once and
     * the chronological sort had nothing left to order.
     *
     * `mks` is the month filter's answer for a journey that runs a season
     * rather than a single date, and `onDemand` is what keeps an open-ended
     * journey from being read as a departure that never happened — both
     * atlases treat it as "never past", which is the only reason a rail
     * journey bookable through 2029 is not filtered out for having a 2025
     * placeholder on its record.
     */
    const dep = departureOf(t);
    const mks = monthKeys(t.departureMonths);
    const world = kind === 'rail' ? null : isRoundTheWorld(t.name, waypoints);
    const train = kind === 'rail' ? trainFor(t) : null;

    TRIPS.push({
      id: t.id,
      n: t.name,
      b: brand,
      g,
      u: `https://www.virtuoso.com/advisor/brianharris/tours/${t.id}/${slugKey(t.name).slice(0, 60)}`,
      days: Number(String(t.lengthLabel ?? '').match(/\d+/)?.[0]) || itin.length,
      img: heroFor(t, { route: String(t.id), n: t.name }),
      from: t.embarkation ?? t.startLocation ?? null,
      to: t.disembarkation ?? null,
      country: (t.countries ?? [])[0] ?? null,
      /*
       * Rail's "world" is not jet's. The jet atlas's globe button says "Around
       * the World"; rail's says "Legendary Trains", and its flag has always
       * meant exactly "this journey rides a named train". Computing it from a
       * country count — which is what the migration did — answered a question
       * neither atlas asks, and took Legendary Trains from 75 journeys to 5.
       */
      ...(kind === 'rail' ? { train, world: Boolean(train) } : { world }),
      ...(dep.start ? { d: usDate(dep.start) } : {}),
      ...(dep.end ? { r: usDate(dep.end) } : {}),
      ...(mks.length ? { mks } : {}),
      /*
       * On demand covers both dateless shapes.
       *
       * It is the flag the whole stack already reads for "there is no departure
       * to be behind or ahead of": lib/atlas/dates.js gives it a null sort key
       * so it lands after every dated journey, and the past-date cutoff leaves
       * it alone rather than expiring a journey over a placeholder date. A
       * season answers to that description exactly — you choose your date inside
       * the window — so it is filed the same way rather than given a flag of its
       * own that every reader would then have to learn.
       */
      ...(dep.kind === 'fixed' ? {} : { onDemand: true }),
      win: t.travelDates ?? null,
      description: t.description || null,
      itin,
      route: String(t.id),
    });
  }

  if (!guardShrink(atlas, TRIPS.length, base.TRIPS?.length ?? 0)) return;

  /*
   * Drop routes no surviving journey points at.
   *
   * ROUTES starts as a copy of the base so bespoke journeys keep their geometry,
   * but that also carries forward keys for departures the API has retired. They
   * stay invisible until the port audit trips over one — a stale "Sao Paulo" in
   * a dead route disagreeing with the live one 2,090km away.
   */
  const live = new Set(TRIPS.map(t => String(t.route ?? t.id)));
  for (const key of Object.keys(ROUTES)) if (!live.has(String(key))) delete ROUTES[key];

  const out = { ...base, BRANDS, REGIONS, ROUTES, TRIPS };
  writePair(outRel, publicRel, out);
  report.push(`${atlas}: ${TRIPS.length} trips (base had ${base.TRIPS?.length ?? 0}, of which ${bespoke.length} bespoke kept)` +
    `${unmatchedBrand ? ` · ${unmatchedBrand} skipped, brand unmatched` : ''}`);
}

// ---------- run ----------

if (!CRUISES.length && !TOURS.length) {
  console.error('No Virtuoso journey feeds found. Run scripts/sync-virtuoso-cruises.mjs and scripts/sync-virtuoso-tours.mjs first.');
  process.exit(1);
}

requireCompleteFeed('cruises', CRUISES, c => c.itinerary.length > 0);
requireCompleteFeed('tours', TOURS, t => t.itinerary.length > 0);

if (wanted('yacht')) buildSeaAtlas({ atlas: 'yacht', baseRel: 'data/atlas/yacht/itinerary.base.json', outRel: 'data/atlas/yacht/itinerary.json', publicRel: 'public/maps/yacht/itinerary.json' });
if (wanted('world')) buildSeaAtlas({ atlas: 'world', baseRel: 'data/atlas/world/itinerary.base.json', outRel: 'data/atlas/world/itinerary.json', publicRel: 'public/maps/worldcruise/itinerary.json' });
if (wanted('expedition')) buildExpedition();
if (wanted('jet')) buildTourAtlas({ atlas: 'jet', kind: 'jet', baseRel: 'data/atlas/jet/itinerary.base.json', outRel: 'data/atlas/jet/itinerary.json', publicRel: 'public/maps/jet/itinerary.json' });
if (wanted('rail')) buildTourAtlas({ atlas: 'rail', kind: 'rail', baseRel: 'data/atlas/train/itinerary.base.json', outRel: 'data/atlas/train/itinerary.json', publicRel: 'public/maps/train/itinerary.json' });

for (const line of report) console.log(line);
if (!CHECK) console.log(`\nwrote ${written.length} files`);
else if (!process.exitCode) console.log('\nok — all journey atlases current');

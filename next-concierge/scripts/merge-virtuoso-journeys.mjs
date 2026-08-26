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
function regionsFor(points, REGIONS) {
  const entries = Object.entries(REGIONS).filter(([, r]) => Array.isArray(r.coord));
  if (!entries.length) return [];
  const hits = new Set();
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    let best = null, bestKm = Infinity;
    for (const [key, r] of entries) {
      const km = haversine([p.lat, p.lng], r.coord);
      if (km < bestKm) { bestKm = km; best = key; }
    }
    if (best && bestKm <= MAX_REGION_KM) hits.add(best);
  }
  // Keep the atlas's own declared order, not insertion order.
  return Object.keys(REGIONS).filter(k => hits.has(k));
}

/** Write a file and its public twin together. */
function writePair(rel, publicRel, value) {
  const json = JSON.stringify(value, null, 1);
  for (const target of [rel, publicRel].filter(Boolean)) {
    const full = path.join(repoRoot, target);
    if (CHECK) {
      const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
      if (current !== json) { console.error(`STALE: ${target}`); process.exitCode = 1; }
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, json);
    written.push(target);
  }
}

const wanted = name => !ONLY || ONLY === name;

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
      if (p.port && Number.isFinite(p.lat) && Number.isFinite(p.lng)) PORTS[p.port] = [p.lat, p.lng];
    }

    /*
     * Days the ship is at sea are absent from the supplier's stop list, so they
     * are reconstructed from the gaps: walking the day numbers turns 1,2,3,5
     * into a call, a call, a call and one `{s:1}` sea day. The atlas draws sea
     * days as spacing in the itinerary column, so losing them shortens a voyage
     * on screen.
     */
    const byDay = new Map();
    for (const p of c.itinerary) if (p.day != null && !byDay.has(p.day)) byDay.set(p.day, p);
    const lastDay = Math.max(...byDay.keys(), 0);
    const itin = [];
    for (let d = 1; d <= lastDay; d++) {
      const p = byDay.get(d);
      if (p) itin.push({ n: p.port, d });
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
      image: c.image ?? null,
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
  ]);

  writePair('data/atlas/cruise/sailings.json', 'public/maps/cruise/sailings.json',
    { schema: base.schema, urlBase: base.urlBase, productBase: base.productBase, rows });

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
      if (!byDay.has(p.day ?? 0)) byDay.set(p.day ?? 0, []);
      byDay.get(p.day ?? 0).push(p);
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
        p: pts.map(p => [p.port, Number.isFinite(p.lat) ? p.lat : null, Number.isFinite(p.lng) ? p.lng : null]),
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
  const bespoke = (base.TRIPS ?? []).filter(t => !/virtuoso\.com/.test(t.u ?? ''));
  const bespokeIds = new Set(bespoke.map(t => String(t.id)));

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
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const last = waypoints[waypoints.length - 1];
      if (last && last.n === p.place) continue;
      waypoints.push({ n: p.place, r: null, ll: [p.lat, p.lng] });
    }
    if (waypoints.length < 2) continue;

    const g = regionsFor(t.itinerary, REGIONS);
    for (const w of waypoints) w.r = g[0] ?? null;
    ROUTES[t.id] = waypoints;

    const itin = [];
    let lastPlace = null;
    for (const p of t.itinerary) {
      if (p.place === lastPlace) continue;
      lastPlace = p.place;
      itin.push({ d: p.day ?? itin.length + 1, n: p.place, ...(p.date ? { date: p.date } : {}) });
    }

    TRIPS.push({
      id: t.id,
      n: t.name,
      b: brand,
      g,
      u: `https://www.virtuoso.com/advisor/brianharris/tours/${t.id}/${slugKey(t.name).slice(0, 60)}`,
      days: Number(String(t.lengthLabel ?? '').match(/\d+/)?.[0]) || itin.length,
      img: t.image ?? null,
      from: t.embarkation ?? t.startLocation ?? null,
      to: t.disembarkation ?? null,
      country: (t.countries ?? [])[0] ?? null,
      ...(kind === 'rail' ? { train: null, world: (t.countries ?? []).length > 3, onDemand: !t.startDate } : {}),
      win: t.travelDates ?? null,
      description: t.description || null,
      itin,
      route: String(t.id),
    });
  }

  if (!guardShrink(atlas, TRIPS.length, base.TRIPS?.length ?? 0)) return;
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

#!/usr/bin/env node
/**
 * build-sea-routes — precompute every sea leg once, at build time.
 *
 * Before this, each of the cruise / yacht / worldcruise Leaflet atlases shipped
 * a 765 KB land mask to every visitor and ran A* in the main thread on demand.
 * That was survivable when one atlas showed one collection. On a unified globe
 * asking for 3,542 expedition sailings + 250 world cruises + 374 yacht voyages
 * at once, it is not.
 *
 * So: route here, ship geometry. The land mask never reaches the browser.
 *
 * The win is de-duplication. Many voyages share legs — Miami -> George Town is
 * sailed by dozens of ships. Keying on the router's own 2-decimal leg key
 * collapses 54,076 raw legs to ~8,335 unique ones, a 6.5x reduction, and the
 * survivors carry a tripIds list so a single voyage can still be picked out.
 *
 * Legs are grouped by collection type because AtlasShell paints one route layer
 * per overlay key (r_<key>_line), which is what makes the legend toggles work.
 *
 * Output: one file per collection, public/maps/shared/sea-routes-<type>.json
 * (+ the data/atlas/shared canonical copies, byte-identical per the repo's
 * dual-copy discipline). Split rather than combined because AtlasShell already
 * fetches and paints per overlay key, so /atlas/yacht pulls 47 KB instead of
 * the full 443.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createSeaRouter, rdp, gcPts, unroll, MASK_BYTES } from "../lib/atlas/sea-router.mjs";
import { steadyStamp } from "./lib/steady-stamp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASK = path.join(ROOT, "data/atlas/shared/landmask.bin");
const OUT_PUBLIC_DIR = path.join(ROOT, "public/maps/shared");
const OUT_DATA_DIR = path.join(ROOT, "data/atlas/shared");

/** Coordinate precision in the output. 3dp is ~110 m — far finer than a globe
 *  route line at ROUTE_ZOOM, and it roughly halves the file. */
const DP = 3;
const r3 = (n) => Math.round(n * 10 ** DP) / 10 ** DP;

/**
 * Output simplification, in degrees, applied to the finished polyline.
 *
 * Distinct from the rdp(0.12) inside legGeometry, which feeds chaikin and
 * therefore shapes the route. This one only drops points that sit within
 * 0.01 deg of the chord they span. At ROUTE_ZOOM = 5.5 the world is ~23,000 px
 * wide, i.e. ~64 px per degree, so 0.01 deg is about 0.6 px — under one pixel,
 * invisible, and it removes 61% of the points (230,890 -> 89,557).
 */
const SIMPLIFY_EPS = 0.01;

/**
 * A* search-box ceiling. The browser-safe default is sized for a visitor's main
 * thread; at build time we can afford far more, and the longest legs need it —
 * see sea-router.mjs.
 *
 * The number is in CELLS, so it does not mean the same amount of ocean at every
 * resolution: tripling the grid to 30 cells per degree made the same Yokohama-to-
 * Kodiak search box nine times as many cells, and 12M — which had been ample —
 * started turning transatlantic and transpacific legs into arcs drawn over the
 * Aleutians and Iberia. At 40M with the search's Float32 g-scores, the peak is
 * around 360 MB for the handful of legs that reach it.
 */
const CELL_BUDGET = 40000000;

/*
 * WHEN A ROUTED LEG IS NOT A VOYAGE.
 *
 * Two kinds of leg come out of the router looking like sea routes and are not:
 *
 *   - transfers. Expedition itineraries list the charter flight and the coach
 *     between ships as consecutive "ports": Seattle -> Nome on the same day,
 *     Santiago -> Buenos Aires, Cusco -> Ollantaytambo. The router dutifully
 *     sails them — 4,400 km up the Pacific coast, 5,900 km round Cape Horn,
 *     790 km out to the coast of Peru and back.
 *   - mask artefacts. A strait narrower than a cell that the passages ledger
 *     does not (yet) reopen: Hamburg -> Cuxhaven down the Elbe was routed 1,093
 *     km round Denmark. And a bad geocode (Laugarvatn, Iceland, in the middle of
 *     a Chilean fjord cruise) produces a 14,000 km leg in a day.
 *
 * Both are caught by asking what a ship could actually do. PACE: no cruise
 * ship covers more than ~1,000 km a day, so a leg needing much more than that
 * between the days it is scheduled is not one the ship sails. DETOUR: a leg ten
 * times longer than the straight line between its ports is the router going
 * the long way round something it cannot see through. A merely long way round
 * (Genoa -> Venice is seven times the chord, and real) is only suspect when it
 * would also need an implausible pace.
 *
 * Such a leg keeps its two ports and loses the invented voyage: it is drawn as
 * a "transfer", a plain great circle the client renders as a faint connector,
 * which is what a flight or a coach between two calls should look like.
 */
const MAX_KM_PER_DAY = 1500;       // no ship; a flight or a mask artefact
const SHIP_KM_PER_DAY = 900;       // ~20 knots for 24 hours
const DETOUR_MIN_EXTRA_KM = 300;   // below this a detour is coastline, not a problem
const DETOUR_SUSPECT = 4;          // routed / chord, suspicious if the pace is also high
const DETOUR_ABSURD = 10;          // routed / chord, wrong whatever the schedule

/*
 * A port is on a coast, so the segment from the port to the first water cell
 * crosses a little land by construction. When the nearest water the router
 * believes in is far away — a river port, an inland excursion, a fjord the mask
 * closes — that segment becomes a straight line over real country. Past this
 * much land it is tagged as a STUB and drawn as a faint connector, so the bold
 * line only ever claims water. Measured on the segment itself, not the snap
 * distance, because a long snap along a coast crosses no land at all.
 */
const STUB_LAND_KM = 10;

const R_EARTH_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;
/** Great-circle km between two [lat, lng]. */
function haversineKm(a, b) {
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}
/** Length of a [lng, lat] polyline in km. */
function lengthKm(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    km += haversineKm([coords[i - 1][1], coords[i - 1][0]], [coords[i][1], coords[i][0]]);
  }
  return km;
}

const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

// ── Collect every leg, grouped by collection type ──────────────────────────

/** @type {Map<string, {type: string, a: number[], b: number[], tripIds: Set, days: number}>} */
const legs = new Map();
const stats = {
  sources: {},
  rawLegs: 0,
  nullPorts: 0,
  missingPorts: 0,
};

/**
 * `days` is each point's itinerary day, parallel to `ptsLatLng`. A leg keeps
 * the MOST days any trip gives it, so the pace check below convicts a leg only
 * when no voyage that sails it has the time to.
 */
function addSequence(type, tripId, ptsLatLng, days) {
  for (let i = 0; i < ptsLatLng.length - 1; i++) {
    const a = ptsLatLng[i], b = ptsLatLng[i + 1];
    // A trip that calls the same port twice running produces a zero-length leg.
    if (a[0] === b[0] && a[1] === b[1]) continue;
    stats.rawLegs++;
    const key = `${type}|${a[0].toFixed(2)},${a[1].toFixed(2)}|${b[0].toFixed(2)},${b[1].toFixed(2)}`;
    let rec = legs.get(key);
    if (!rec) { rec = { type, a, b, tripIds: new Set(), days: 0 }; legs.set(key, rec); }
    rec.tripIds.add(tripId);
    const gap = Number(days?.[i + 1]) - Number(days?.[i]);
    // No usable day numbers means no evidence against the leg: assume a week.
    rec.days = Math.max(rec.days, Number.isFinite(gap) ? gap : 7);
  }
}

// yacht + worldcruise: itinerary.json -> TRIPS[].itin[] of {n: portName} or
// {s: 1} sea days, with PORTS: { name: [lat, lng] }.
for (const [type, file] of [["yacht", "public/maps/yacht/itinerary.json"], ["worldcruise", "public/maps/worldcruise/itinerary.json"]]) {
  const j = read(file);
  const PORTS = j.PORTS || {};
  let trips = 0;
  for (const trip of j.TRIPS || []) {
    const pts = [];
    const days = [];
    for (const stop of trip.itin || []) {
      if (!stop.n) continue; // sea day
      const ll = PORTS[stop.n];
      if (!Array.isArray(ll) || !Number.isFinite(Number(ll[0])) || !Number.isFinite(Number(ll[1]))) {
        stats.missingPorts++;
        continue;
      }
      pts.push([Number(ll[0]), Number(ll[1])]);
      days.push(stop.d);
    }
    if (pts.length >= 2) { addSequence(type, trip.id, pts, days); trips++; }
  }
  stats.sources[type] = { trips, ports: Object.keys(PORTS).length };
}

// cruise (expedition): data/itinerary-routes.json is
// { _meta, routes: { sailingId: [{d, s, p: [[portName, lat, lng], …]}] } }.
// NOTE this is NOT the { [slug]: [{n, ll}] } shape AtlasShell's old
// fetchRouteLines expected — that branch was dead. See STATE.md.
{
  const j = read("public/maps/cruise/data/itinerary-routes.json");
  let trips = 0;
  for (const [sailingId, days] of Object.entries(j.routes || {})) {
    const pts = [];
    const dayOf = [];
    for (const day of days) {
      for (const p of day.p || []) {
        const lat = p[1], lng = p[2];
        // ~14,500 ports in this file carry null coordinates. Number(null) is 0,
        // so a lazy guard plots them in the Gulf of Guinea. Drop them.
        if (lat === null || lng === null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
          stats.nullPorts++;
          continue;
        }
        pts.push([Number(lat), Number(lng)]);
        dayOf.push(day.d);
      }
    }
    if (pts.length >= 2) { addSequence("cruise", sailingId, pts, dayOf); trips++; }
  }
  stats.sources.cruise = { trips, sailings: Object.keys(j.routes || {}).length };
}

// ── Route ──────────────────────────────────────────────────────────────────

const maskBuf = fs.readFileSync(MASK);
if (maskBuf.length !== MASK_BYTES) {
  console.error(`landmask is ${maskBuf.length} bytes, expected ${MASK_BYTES}`);
  process.exit(1);
}
const router = createSeaRouter(maskBuf, { cellBudget: CELL_BUDGET });

const t0 = Date.now();
/** @type {Map<string, object[]>} type -> features */
const byTypeFeatures = new Map();
const modeCounts = { sea: 0, arc: 0, densified: 0, "arc-fallback": 0, transfer: 0 };
const failed = [];
const crossers = [];
const transfers = [];
let stubLegs = 0;
let simplifyBackoffs = 0;
let pointsBefore = 0;
let pointsAfter = 0;

for (const [key, rec] of legs) {
  // route() unrolls the pair before routing, so a trans-Pacific leg runs east
  // across the ocean rather than west around the world. Each leg is emitted in
  // its own frame — legs render independently, so no shared frame is needed.
  let { coordinates, modes } = router.route([rec.a, rec.b]);
  let mode = modes[0] || "none";
  if (!coordinates || coordinates.length < 2) {
    failed.push({ key, a: rec.a, b: rec.b });
    continue;
  }

  // Is this a voyage at all? See MAX_KM_PER_DAY.
  const routedKm = lengthKm(coordinates);
  const chordKm = haversineKm(rec.a, rec.b);
  const pace = routedKm / Math.max(1, rec.days);
  const detour = routedKm / Math.max(chordKm, 1);
  const extra = routedKm - chordKm;
  const why = pace > MAX_KM_PER_DAY ? `${Math.round(pace)} km/day`
    : extra > DETOUR_MIN_EXTRA_KM && detour > DETOUR_ABSURD ? `${detour.toFixed(0)}x the chord`
    : extra > DETOUR_MIN_EXTRA_KM && detour > DETOUR_SUSPECT && pace > SHIP_KM_PER_DAY ? `${detour.toFixed(1)}x the chord at ${Math.round(pace)} km/day`
    : null;
  if (why) {
    transfers.push({ key, a: rec.a, b: rec.b, routedKm, chordKm, days: rec.days, why, was: mode });
    const [ua, ub] = unroll([rec.a, rec.b]);
    coordinates = gcPts(ua, ub).map(([lat, lng]) => [lng, lat]);
    mode = "transfer";
  }
  modeCounts[mode] = (modeCounts[mode] || 0) + 1;
  pointsBefore += coordinates.length;

  // Audit the routed geometry, not our intent. Endpoints sit in land cells by
  // construction (a port is on a coast), so only the interior is checked.
  // A transfer is not claiming water, so it is not audited as if it were.
  const latLng = coordinates.map(([lng, lat]) => [lat, lng]);
  const interior = latLng.slice(1, -1);
  const crossesLand = mode !== "transfer" && interior.length >= 2 && router.polyHitsLand(interior);
  if (crossesLand) crossers.push({ key, mode, a: rec.a, b: rec.b });

  /*
   * Simplify as far as the coastline allows, not as far as the budget allows.
   *
   * Douglas-Peucker at 0.01 degrees moves a vertex by up to 1.1 km, and the
   * router deliberately hugs the coast — it sits a ship about one cell offshore
   * and no further. In open water that is invisible; threading the Dalmatian
   * islands or the Inside Passage it is enough to cut a corner across the very
   * headland A* just spent its search avoiding. So the epsilon is offered, and
   * withdrawn for the legs that cannot take it: about one leg in a hundred keeps
   * more points, and none of them gains a land crossing it did not arrive with.
   *
   * Checked AFTER rounding, because r3 is another 100 m of movement and there is
   * no sense auditing geometry that is not the geometry we ship.
   */
  const round = (pts) => pts.map(([lng, lat]) => [r3(lng), r3(lat)]);
  let shipped = round(rdp(coordinates, SIMPLIFY_EPS));
  if (!crossesLand) {
    for (const eps of [SIMPLIFY_EPS / 4, 0]) {
      const interiorOf = (pts) => pts.slice(1, -1).map(([lng, lat]) => [lat, lng]);
      const bad = interiorOf(shipped).length >= 2 && router.polyHitsLand(interiorOf(shipped));
      if (!bad) break;
      shipped = round(eps ? rdp(coordinates, eps) : coordinates);
      simplifyBackoffs++;
    }
  }
  pointsAfter += shipped.length;

  // The approach segments, port to first water and last water to port. See
  // STUB_LAND_KM. [head, tail] counts of segments to draw as connectors.
  let stub;
  if (mode !== "transfer" && !crossesLand && shipped.length >= 3) {
    const head = landKm(shipped[0], shipped[1]) > STUB_LAND_KM ? 1 : 0;
    const tail = landKm(shipped[shipped.length - 2], shipped[shipped.length - 1]) > STUB_LAND_KM ? 1 : 0;
    if (head || tail) { stub = [head, tail]; stubLegs++; }
  }

  const list = byTypeFeatures.get(rec.type) || [];
  list.push({
    type: "Feature",
    geometry: { type: "LineString", coordinates: shipped },
    properties: {
      type: rec.type,
      mode,
      crossesLand: crossesLand || undefined,
      stub,
      tripIds: [...rec.tripIds],
    },
  });
  byTypeFeatures.set(rec.type, list);
}
const routeMs = Date.now() - t0;

/** Km of land a straight [lng, lat] segment passes over, sampled every ~1 km. */
function landKm(p, q) {
  const km = haversineKm([p[1], p[0]], [q[1], q[0]]);
  const n = Math.max(2, Math.ceil(km));
  let land = 0;
  for (let i = 1; i < n; i++) {
    const f = i / n;
    if (router.isLandLL(p[1] + (q[1] - p[1]) * f, p[0] + (q[0] - p[0]) * f)) land++;
  }
  return (land / n) * km;
}
const features = [...byTypeFeatures.values()].flat();

// ── Emit ───────────────────────────────────────────────────────────────────

const written = [];
for (const [type, feats] of byTypeFeatures) {
  const collection = {
    type: "FeatureCollection",
    _meta: {
      generatedAt: null,        // filled by steadyStamp below, in this position
      generator: "scripts/build-sea-routes.mjs",
      collection: type,
      simplifyEps: SIMPLIFY_EPS,
      uniqueLegs: feats.length,
      source: stats.sources[type],
    },
    features: feats,
  };
  const name = `sea-routes-${type}.json`;
  // The stamp is taken from the first copy and used for both, so the two never
  // disagree by the millisecond between two writes — and stays put entirely when
  // the routes have not moved. See scripts/lib/steady-stamp.mjs.
  const json = `${JSON.stringify(steadyStamp(path.join(OUT_PUBLIC_DIR, name), collection))}\n`;
  for (const dir of [OUT_PUBLIC_DIR, OUT_DATA_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), json);
  }
  written.push({ name, raw: json.length, gz: zlib.gzipSync(Buffer.from(json)).length });
}

// ── Coverage report ────────────────────────────────────────────────────────

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log("");
console.log("sea-routes coverage");
console.log("=".repeat(70));
for (const [t, s] of Object.entries(stats.sources)) {
  console.log(`  ${t.padEnd(12)} ${String(s.trips).padStart(5)} trips routed`);
}
console.log("");
console.log(`  raw legs            ${stats.rawLegs.toLocaleString()}`);
console.log(`  unique legs         ${features.length.toLocaleString()}  (${(stats.rawLegs / features.length).toFixed(1)}x dedupe)`);
console.log(`  routed in           ${(routeMs / 1000).toFixed(1)}s`);
console.log(`  points              ${pointsBefore.toLocaleString()} -> ${pointsAfter.toLocaleString()}  (rdp eps ${SIMPLIFY_EPS}, backed off on ${simplifyBackoffs} legs that it pushed onto land)`);
console.log("");
console.log("  by mode:");
console.log(`    sea (A* around land)   ${String(modeCounts.sea || 0).padStart(6)}`);
console.log(`    arc (open water)       ${String(modeCounts.arc || 0).padStart(6)}`);
console.log(`    densified (arc bulged) ${String(modeCounts.densified || 0).padStart(6)}`);
console.log(`    arc fallback (A* found nothing) ${String(modeCounts["arc-fallback"] || 0).padStart(5)}`);
console.log(`    transfer (not sailable) ${String(modeCounts.transfer || 0).padStart(6)}`);
console.log(`  approach stubs over land ${String(stubLegs).padStart(6)}  (drawn as connectors)`);
console.log("");
console.log("  files:");
for (const w of written) {
  console.log(`    ${w.name.padEnd(28)} ${kb(w.raw).padStart(8)} raw   ${kb(w.gz).padStart(7)} gzipped`);
}
console.log(`    ${"TOTAL".padEnd(28)} ${kb(written.reduce((n, w) => n + w.raw, 0)).padStart(8)} raw   ${kb(written.reduce((n, w) => n + w.gz, 0)).padStart(7)} gzipped`);
console.log("");
if (stats.nullPorts) console.log(`  ! ${stats.nullPorts.toLocaleString()} cruise ports had null coordinates — skipped`);
if (stats.missingPorts) console.log(`  ! ${stats.missingPorts.toLocaleString()} itinerary stops referenced an unknown port — skipped`);
if (failed.length) {
  console.log(`  ! ${failed.length} legs produced no geometry at all:`);
  for (const f of failed.slice(0, 20)) console.log(`      ${f.key}`);
  if (failed.length > 20) console.log(`      … and ${failed.length - 20} more`);
}
if (transfers.length) {
  console.log(`  ! ${transfers.length} legs no ship could sail as routed, drawn as transfers:`);
  for (const t of transfers.sort((x, y) => y.routedKm - x.routedKm).slice(0, 25)) {
    console.log(`      ${t.a[0].toFixed(2)},${t.a[1].toFixed(2)} -> ${t.b[0].toFixed(2)},${t.b[1].toFixed(2)}  ${Math.round(t.routedKm)} km routed / ${Math.round(t.chordKm)} km apart in ${t.days} d — ${t.why}  (${t.key.split("|")[0]})`);
  }
  if (transfers.length > 25) console.log(`      … and ${transfers.length - 25} more`);
}
if (crossers.length) {
  console.log(`  ! ${crossers.length} legs cross land (interior segments), tagged crossesLand in the output:`);
  for (const c of crossers.slice(0, 25)) {
    console.log(`      [${c.mode}] ${c.a[0].toFixed(2)},${c.a[1].toFixed(2)} -> ${c.b[0].toFixed(2)},${c.b[1].toFixed(2)}  (${c.key.split("|")[0]})`);
  }
  if (crossers.length > 25) console.log(`      … and ${crossers.length - 25} more`);
} else {
  console.log("  No leg crosses land.");
}
console.log("");

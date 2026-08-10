#!/usr/bin/env node
/**
 * verify-route-order — prove a traced route is drawn in itinerary order.
 *
 *   node scripts/verify-route-order.mjs
 *
 * ── What this is defending ─────────────────────────────────────────────────
 *
 * A traced route is not just a shape, it is a SEQUENCE: Monte-Carlo on day 1
 * through to Barcelona on day 8. The dash animation marches along that
 * sequence to show the direction of travel, and the camera frames its bounding
 * box, so both depend on frameRoute() handing back legs in the order the ship
 * sails them, each oriented the way it sails.
 *
 * That ordering used to be inferred from the geometry — start at the first
 * port, then repeatedly take the nearest unused leg-end — with the itinerary
 * consulted only to choose the first leg. It could not work, because the
 * distance threshold it leaned on had to be loose enough to forgive the gap
 * between a port's listed coordinate and where its leg actually begins, while
 * also being tight enough to tell two adjacent ports apart. Those ports can be
 * 5km apart (Nice and Villefranche-sur-Mer; Valletta and St. Julian's), so no
 * single value does both.
 *
 * The failure was not subtle. Yacht trip 243, Monte-Carlo to Barcelona, drew
 * days 3-8 and then appended days 1-2 running backwards; 46 of 362 yacht
 * itineraries did not begin on day 1 at all. frameRoute() now walks the
 * itinerary hop by hop instead of inferring it, and these assertions hold that
 * line: they are written against the SHIPPED data, so a regeneration of the sea
 * geometry that breaks the day-by-day fails here rather than on the map.
 *
 * The corpus assertions state the contract directly rather than inferring it
 * from whether the drawn line happens to be continuous: build the hops the
 * itinerary implies, keep those the geometry file can actually serve, and
 * require the route to open with exactly those, in that order, each oriented
 * the way the ship sails. Legs that match no hop are appended so geometry is
 * never dropped; they are counted and reported, not asserted on, because there
 * is no correct position for a leg the itinerary never asked for.
 */

import { readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, ".adapters-build");

/**
 * Compile the REAL module, so this tests shipped code rather than a
 * transcription of it that could drift. route-frame.ts imports nothing, so
 * unlike the adapters it needs no alias or extension rewriting afterwards.
 */
if (!existsSync(join(BUILD, "route-frame.js"))) {
  execFileSync("npx", ["tsc", "-p", "tsconfig.adapters.json"], { cwd: ROOT, stdio: "inherit" });
}
const { frameRoute, wrapLng } = await import(pathToFileURL(join(BUILD, "route-frame.js")).href);

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

let failures = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { console.log(`✓ ${label}`); return true; }
  failures++;
  console.log(`✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  return false;
};

/** Squared distance, longitude scaled by latitude — mirrors route-frame's own. */
function d2(a, b) {
  const dLng = wrapLng(a[0] - b[0]);
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return dLng * k * (dLng * k) + (a[1] - b[1]) * (a[1] - b[1]);
}
/** Endpoints that should coincide, allowing for the file's 2dp rounding. */
const JOINED = 0.01;

// ── Synthetic cases: the ordering contract, independent of any shipped file ──

{
  // Four ports in a line. The legs arrive shuffled and some run backwards —
  // which is exactly how the deduplicated file stores them, since a leg is
  // kept in whichever direction the first trip to need it happened to draw it.
  const A = [0, 0], B = [1, 0], C = [2, 0], D = [3, 0];
  const legs = [
    { mode: "primary", coordinates: [C, B] },   // backwards
    { mode: "primary", coordinates: [C, D] },
    { mode: "primary", coordinates: [B, A] },   // backwards
  ];
  const out = frameRoute(legs, [A, B, C, D]);
  ok(out.length === 3, "a shuffled, part-reversed route keeps every leg");
  const runsAtoD = out.every((l, i) => d2(l.coordinates[0], [i, 0]) < JOINED
    && d2(l.coordinates[l.coordinates.length - 1], [i + 1, 0]) < JOINED);
  ok(runsAtoD, "…and is reordered and reoriented to run A→B→C→D",
    out.map((l) => `${l.coordinates[0]}→${l.coordinates[l.coordinates.length - 1]}`).join("  "));
}

{
  // Two adjacent ports 5km apart, then a long hop — the Nice/Villefranche
  // shape that any distance-threshold approach mistakes for one port.
  const nice = [7.27, 43.7], villefranche = [7.31, 43.7], portofino = [9.21, 44.3];
  const out = frameRoute([
    { mode: "primary", coordinates: [villefranche, portofino] },
    { mode: "primary", coordinates: [nice, villefranche] },
  ], [nice, villefranche, portofino]);
  ok(d2(out[0].coordinates[0], nice) < JOINED,
    "ports 5km apart are still two ports, so the route starts at the first");
}

{
  // An out-and-back. The file deduplicates, so A→B→A ships ONE leg for two
  // crossings; the ship really does sail it twice and it should draw twice.
  const A = [0, 0], B = [1, 0];
  const out = frameRoute([{ mode: "primary", coordinates: [A, B] }], [A, B, A]);
  ok(out.length === 2, "an out-and-back draws its one shared leg twice");
  ok(out.length === 2 && d2(out[1].coordinates[0], B) < JOINED,
    "…with the return leg oriented back toward the start");
}

{
  // Consecutive days in the same port are not a hop and have no leg.
  const A = [0, 0], B = [1, 0];
  const out = frameRoute([{ mode: "primary", coordinates: [A, B] }], [A, A, B]);
  ok(out.length === 1, "two nights in one port do not invent a leg");
}

{
  // Yacht #96, Naples to Salerno: two consecutive nights in Capri, with
  // Sorrento only 14km away. Under a SUMMED endpoint score the Capri→Capri
  // hop scores 0 on one side and claims the Sorrento→Capri leg, drawing it
  // twice. Both ends have to reach.
  const sorrento = [14.24, 40.55], capri = [14.37, 40.63], salerno = [14.76, 40.68];
  const out = frameRoute([
    { mode: "primary", coordinates: [sorrento, capri] },
    { mode: "primary", coordinates: [capri, salerno] },
  ], [sorrento, capri, capri, salerno]);
  ok(out.length === 2, "a second night in port cannot claim the leg that arrived there",
    out.map((l) => `${l.coordinates[0]}→${l.coordinates[l.coordinates.length - 1]}`).join("  "));
}

{
  // The other side of that coin. Some itineraries name one place twice —
  // "Westmann Islands" and "Heimaey" are the same Icelandic harbour 1.1km
  // apart, as are "East Greenland" and "Tasiilaq" at 2km — and the geometry
  // carries a real, tiny leg between the two spellings. A same-port guard
  // loose enough to fold those together orphans that leg, which then draws as
  // a stray jump after the route has finished.
  const westmann = [-20.27, 63.44], heimaey = [-20.27, 63.43], reykjavik = [-21.94, 64.15];
  const out = frameRoute([
    { mode: "primary", coordinates: [heimaey, reykjavik] },
    { mode: "primary", coordinates: [westmann, heimaey] },
  ], [westmann, heimaey, reykjavik]);
  ok(out.length === 2 && d2(out[0].coordinates[0], westmann) < JOINED,
    "two names for one harbour keep their short leg in sequence",
    out.map((l) => `${l.coordinates[0]}→${l.coordinates[l.coordinates.length - 1]}`).join("  "));
}

{
  // No itinerary at all (a bare cloud of legs) must still return geometry.
  const out = frameRoute([{ mode: "primary", coordinates: [[0, 0], [1, 0]] }]);
  ok(out.length === 1, "a route with no itinerary still falls back to a chain");
}

// ── The shipped corpus ──────────────────────────────────────────────────────

/** Legs from the shared geometry file, grouped by the trips that use them. */
function legsByTrip(geo) {
  const m = new Map();
  for (const f of geo.features)
    for (const id of f.properties?.tripIds || []) {
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(f);
    }
  return m;
}

/** Itinerary stops as [lng, lat], skipping sea days — as the voyage adapter does. */
const stopsOf = (trip, PORTS) => (trip.itin || [])
  .filter((e) => e?.n && PORTS[e.n])
  .map((e) => { const p = PORTS[e.n]; return [p[1], p[0]]; });

for (const [name, itinPath, geoPath] of [
  ["yacht", "data/atlas/yacht/itinerary.json", "data/atlas/shared/sea-routes-yacht.json"],
  ["world cruise", "data/atlas/world/itinerary.json", "data/atlas/shared/sea-routes-worldcruise.json"],
]) {
  const d = read(itinPath);
  const byTrip = legsByTrip(read(geoPath));
  let routed = 0, wrongStart = 0, outOfOrder = 0, orphans = 0;
  const examples = [];

  for (const trip of d.TRIPS) {
    const feats = byTrip.get(trip.id);
    if (!feats || feats.length < 2) continue;
    const stops = stopsOf(trip, d.PORTS);
    if (stops.length < 2) continue;
    routed++;

    const out = frameRoute(feats.map((f) => ({ mode: "primary", coordinates: f.geometry.coordinates })), stops);

    // The route begins where the traveller does.
    if (d2(out[0].coordinates[0], stops[0]) > JOINED) {
      wrongStart++;
      if (examples.length < 3) examples.push(`#${trip.id} ${String(trip.title || "").slice(0, 40)} starts off-itinerary`);
      continue;
    }

    /*
     * Then the day-by-day itself, asserted directly rather than inferred from
     * continuity: build the hops the itinerary implies, keep the ones the file
     * actually has geometry for, and require the drawn route to open with
     * exactly those, in that order, each oriented the way the ship sails.
     *
     * Legs no hop claims are appended afterwards so that geometry is never
     * silently dropped. They are counted, not asserted on — there is no
     * "correct" order for a leg the itinerary never asked for.
     */
    const expected = [];
    for (let i = 1; i < stops.length; i++) {
      const from = stops[i - 1], to = stops[i];
      // No same-port guard, mirroring route-frame: a hop counts exactly when
      // the geometry has a leg for it. Two nights in one port have none.
      const has = feats.some((f) => {
        const c = f.geometry.coordinates;
        const h = c[0], t = c[c.length - 1];
        // Per-endpoint, mirroring route-frame's HOP_MATCH: both ends must
        // reach, so a same-port hop cannot claim a leg by scoring 0 on one side.
        return Math.min(Math.max(d2(h, from), d2(t, to)), Math.max(d2(t, from), d2(h, to))) <= 0.01;
      });
      if (has) expected.push([from, to]);
    }

    const walked = out.slice(0, expected.length);
    const inOrder = walked.length === expected.length && walked.every((l, i) =>
      d2(l.coordinates[0], expected[i][0]) <= JOINED
      && d2(l.coordinates[l.coordinates.length - 1], expected[i][1]) <= JOINED);
    if (!inOrder) {
      outOfOrder++;
      if (examples.length < 3) examples.push(`#${trip.id} ${String(trip.title || "").slice(0, 40)} drifts from itinerary order`);
    }
    orphans += out.length - expected.length;
  }

  ok(wrongStart === 0, `${name}: all ${routed} routed trips begin on day 1`, examples.join("; "));
  ok(outOfOrder === 0, `${name}: every routed trip draws its hops in itinerary order`, examples.join("; "));
  console.log(`      (${orphans} leg(s) across ${routed} trips matched no itinerary hop and were appended)`);
}

// ── The reported regression, named ──────────────────────────────────────────

{
  const d = read("data/atlas/yacht/itinerary.json");
  const geo = read("data/atlas/shared/sea-routes-yacht.json");
  const trip = d.TRIPS.find((t) => t.id === 243);
  const feats = geo.features.filter((f) => (f.properties?.tripIds || []).includes(243));
  const stops = stopsOf(trip, d.PORTS);
  const out = frameRoute(feats.map((f) => ({ mode: "primary", coordinates: f.geometry.coordinates })), stops);

  // Each drawn leg should run from one itinerary port to the NEXT distinct one.
  const wanted = [];
  for (let i = 1; i < stops.length; i++) if (d2(stops[i], stops[i - 1]) > JOINED) wanted.push([stops[i - 1], stops[i]]);
  const matches = out.length === wanted.length && out.every((l, i) =>
    d2(l.coordinates[0], wanted[i][0]) < JOINED
    && d2(l.coordinates[l.coordinates.length - 1], wanted[i][1]) < JOINED);

  ok(matches, "yacht #243 Monte-Carlo→Barcelona draws day 1 through day 8, in order",
    out.map((l) => `${l.coordinates[0]}→${l.coordinates[l.coordinates.length - 1]}`).join("  "));
}

rmSync(BUILD, { recursive: true, force: true });

console.log("");
console.log(failures ? `${failures} assertion(s) failed` : "route order verified");
process.exit(failures ? 1 : 0);

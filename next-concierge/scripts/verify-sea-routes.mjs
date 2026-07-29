#!/usr/bin/env node
/**
 * verify-sea-routes — prove the extracted router (lib/atlas/sea-router.mjs)
 * still behaves like the Leaflet original before anything renders from it.
 *
 *   node scripts/verify-sea-routes.mjs           summary table
 *   node scripts/verify-sea-routes.mjs --geojson dump legs as GeoJSON to stdout
 *
 * The six reference legs are the ones the work order calls out, each chosen
 * because it breaks a different naive implementation:
 *
 *   Lisbon -> Barcelona     must round Gibraltar, not cut across Iberia
 *   Miami -> Los Angeles    must round (or transit) Central America
 *   Tokyo -> Napa           antimeridian: cross the Pacific, not circle the globe
 *   Alexandria -> Barcelona open Mediterranean: should be a clean arc
 *   Ushuaia -> Antarctica   Drake Passage
 *   Reykjavik -> Tromso     above 60N, exercising the cosine-latitude correction
 *
 * Assertions per leg: geometry exists; no INTERIOR segment crosses land;
 * longitude never jumps more than 180 degrees between consecutive points; the
 * routed distance is not absurdly longer than the great-circle distance.
 *
 * "Interior" matters. A route starts and ends at a port, and at the mask's 0.1
 * degree resolution a port sits in a land cell — Lisbon (38.72N, 9.14W) is a
 * land cell, because the city is. So the first and last segments always "hit
 * land" by construction; that is the approach into the berth, not a ship
 * sailing over Portugal. Only the open-water middle is asserted on. The
 * original Leaflet code has the same property: legGeometry returns
 * [a, ...body, b] with a and b the raw port coordinates.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSeaRouter, MASK_BYTES } from "../lib/atlas/sea-router.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MASK = join(ROOT, "data/atlas/shared/landmask.bin");

// [lat, lng] — the order every upstream feed uses.
const LEGS = [
  { name: "Lisbon -> Barcelona",        a: [38.7223, -9.1393],   b: [41.3851, 2.1734],     expect: "sea",  note: "around Gibraltar" },
  { name: "Miami -> Los Angeles",       a: [25.7617, -80.1918],  b: [33.7292, -118.2620],  expect: "sea",  note: "around/through Central America" },
  { name: "Tokyo -> Napa (SF Bay)",     a: [35.6528, 139.8394],  b: [38.2975, -122.2869],  expect: "any",  note: "antimeridian" },
  // The work order calls this one "open Mediterranean — should be a clean arc",
  // but the straight Alexandria->Barcelona line clips southern Sardinia near
  // Cagliari (38.9N, 9E), and legGeometry tests the STRAIGHT line, not the
  // bezier, when deciding whether to route. So A* is correct here, and the
  // expectation was the thing that was wrong.
  { name: "Alexandria -> Barcelona",    a: [31.2001, 29.9187],   b: [41.3851, 2.1734],     expect: "sea",  note: "Mediterranean, clips Sardinia" },
  { name: "Ushuaia -> Antarctic Pen.",  a: [-54.8019, -68.3030], b: [-64.8500, -62.6667],  expect: "any",  note: "Drake Passage" },
  { name: "Reykjavik -> Tromso",        a: [64.1466, -21.9426],  b: [69.6492, 18.9553],    expect: "any",  note: ">60N, cosine correction" },
];

const R_EARTH_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;
function haversine([lat1, lng1], [lat2, lng2]) {
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

const buf = readFileSync(MASK);
if (buf.length !== MASK_BYTES) {
  console.error(`landmask is ${buf.length} bytes, expected ${MASK_BYTES}`);
  process.exit(1);
}
const router = createSeaRouter(buf);

const geojson = process.argv.includes("--geojson");
const features = [];
let failures = 0;

console.log("");
console.log("Reference legs — extracted router vs. the Leaflet original's rules");
console.log("=".repeat(78));

for (const leg of LEGS) {
  // route(), not leg(): the port sequence must be unrolled before any leg is
  // routed, or a trans-Pacific leg draws itself westward around the world.
  const { coordinates, modes } = router.route([leg.a, leg.b]);
  const mode = modes[0];
  const problems = [];

  if (!coordinates || coordinates.length < 2) problems.push("no geometry");

  // No INTERIOR segment may cross land — see the header note on why the first
  // and last segments are exempt.
  const latLng = coordinates.map(([lng, lat]) => [lat, lng]);
  const interior = latLng.slice(1, -1);
  if (interior.length >= 2 && router.polyHitsLand(interior)) problems.push("CROSSES LAND");

  // No consecutive pair may jump more than 180 deg of longitude — that is the
  // signature of a line taking the long way round the world.
  let maxJump = 0;
  for (let i = 1; i < coordinates.length; i++) {
    maxJump = Math.max(maxJump, Math.abs(coordinates[i][0] - coordinates[i - 1][0]));
  }
  if (maxJump > 180) problems.push(`antimeridian wrap (${maxJump.toFixed(1)} deg jump)`);

  // Routed length vs great-circle. A detour is expected; 4x is not.
  let routed = 0;
  for (let i = 1; i < latLng.length; i++) routed += haversine(latLng[i - 1], latLng[i]);
  const direct = haversine(leg.a, leg.b);
  const ratio = direct > 0 ? routed / direct : 0;
  if (ratio > 4) problems.push(`detour ${ratio.toFixed(1)}x great-circle`);
  if (leg.expect !== "any" && mode !== leg.expect && !(leg.expect === "arc" && mode === "densified")) {
    problems.push(`mode ${mode}, expected ${leg.expect}`);
  }

  const ok = problems.length === 0;
  if (!ok) failures++;

  console.log("");
  console.log(`${ok ? "PASS" : "FAIL"}  ${leg.name}`);
  console.log(`      ${leg.note}`);
  console.log(`      mode=${mode}  points=${coordinates.length}  direct=${direct.toFixed(0)}km  routed=${routed.toFixed(0)}km  (${ratio.toFixed(2)}x)`);
  console.log(`      lng range ${Math.min(...coordinates.map((c) => c[0])).toFixed(1)} .. ${Math.max(...coordinates.map((c) => c[0])).toFixed(1)}   max step ${maxJump.toFixed(1)} deg`);
  // A coarse waypoint sample, so a human can eyeball the shape against the
  // live Leaflet atlas without opening a map.
  const step = Math.max(1, Math.floor(coordinates.length / 6));
  const sample = coordinates.filter((_, i) => i % step === 0 || i === coordinates.length - 1);
  console.log(`      via ${sample.map(([lng, lat]) => `${lat.toFixed(1)},${lng.toFixed(1)}`).join("  ")}`);
  if (!ok) console.log(`      >>> ${problems.join("; ")}`);

  features.push({
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: { name: leg.name, mode, ok, problems },
  });
}

console.log("");
console.log("=".repeat(78));
console.log(`${LEGS.length - failures}/${LEGS.length} legs pass  ·  ${router.cacheSize()} legs cached`);
console.log("");

if (geojson) {
  console.log(JSON.stringify({ type: "FeatureCollection", features }, null, 2));
}

process.exit(failures ? 1 : 0);

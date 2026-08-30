#!/usr/bin/env node
/**
 * verify-gateway-hotels — prove the pre/post hotel join says what it claims.
 *
 *   npm run verify:gateway-hotels
 *
 * `build-gateway-hotels.mjs --check` already gates STALENESS: it rebuilds the
 * files and fails if the shipped bytes differ. That catches a feed that moved
 * and nothing else. Everything below is about whether the file is RIGHT, and
 * every check here exists because the equivalent mistake has been shipped in
 * this repo before:
 *
 *   1  Structure. A journey pointing at a gateway that is not in the file, or a
 *      gateway pointing at a hotel that is not, renders an empty block.
 *
 *   2  Geometry, recomputed. The safari routes drew on the wrong continent for
 *      a release because `ll` is [lat, lng] and the renderer reads [lng, lat],
 *      and the check of the day asserted a line existed rather than where it
 *      was. So this recomputes every stored distance from the two coordinates
 *      and fails on a disagreement — a transposed pair moves Venice to the
 *      Indian Ocean and the arithmetic notices.
 *
 *   3  Identity, against the REAL adapters. The file is keyed by trip id, and
 *      each atlas keys its dossier records differently (`String(t.id ?? index)`
 *      for the journey family, because 27 jet trips have no id at all). A key
 *      convention that drifts from the component's produces a file the UI
 *      silently never reads — no error, no empty state, just a block that
 *      never appears. This imports the shipped adapters and compares.
 *
 *   4  Ends, derived independently. The builder walks the feed itself; this
 *      takes the ADAPTED offering's own `path` — which journey.ts, voyage.ts
 *      and cruise.ts each produce by their own route resolution — and asserts
 *      the gateway sits on its first and last point. Reintroducing a
 *      first/last mix-up, or a route resolved by the wrong key, turns this red.
 *
 *   5  The affinity, end to end. Runs the shipped indexGateways() and asserts
 *      that where a journey's own house has a hotel at its gateway, that hotel
 *      comes back FIRST — the one behaviour the whole brand table exists for.
 *
 *   6  Coverage floors. A feed refresh that halves the join should fail loudly
 *      rather than quietly ship an atlas with no stays on it. Same argument as
 *      the shrink guards on the other feeds.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { buildAdapters } from "./lib/adapters-build.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, ".adapters-build");

const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

buildAdapters(ROOT);
const mod = (n) => import(pathToFileURL(join(BUILD, n)).href);
const { adaptJet } = await mod("adapters/jet.js");
const { adaptTrain } = await mod("adapters/train.js");
const { adaptYacht } = await mod("adapters/yacht.js");
const { adaptWorldCruise } = await mod("adapters/worldcruise.js");
const { adaptCruise } = await mod("adapters/cruise.js");
const { indexGateways } = await mod("gateway-hotels.js");

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

/*
 * The floors, as fractions of each collection's journeys.
 *
 * Set well under what ships today (jet 0.98, rail 0.96, yacht 1.00, world 0.98,
 * cruise 0.85) so ordinary feed churn is quiet, and high enough that losing a
 * route file or a coordinate convention is not.
 *
 * Cruise's is lowest, and NOT because its routes are missing — all 668 of the
 * sailings without a gateway carry one. They leave from 49 places where the
 * hotel atlas holds nothing within the radius: Puerto Baquerizo Moreno, Sitka,
 * Juneau, Longyearbyen, Sorong, Tromsø, Puerto Williams. That is the expedition
 * business, and it is a gap in the hotel inventory rather than in this join —
 * so the floor accommodates it instead of pretending it away.
 */
const ATLASES = [
  {
    atlas: "jet",
    file: "public/maps/jet/gateways.json",
    floor: 0.9,
    offerings: () => adaptJet(read("public/maps/jet/itinerary.json")),
  },
  {
    atlas: "train",
    file: "public/maps/train/gateways.json",
    floor: 0.85,
    offerings: () => adaptTrain(read("public/maps/train/itinerary.json")),
  },
  {
    atlas: "yacht",
    file: "public/maps/yacht/gateways.json",
    floor: 0.9,
    offerings: () => adaptYacht(read("public/maps/yacht/itinerary.json")),
  },
  {
    atlas: "worldcruise",
    file: "public/maps/worldcruise/gateways.json",
    floor: 0.9,
    offerings: () => adaptWorldCruise(read("public/maps/worldcruise/itinerary.json")),
  },
  {
    atlas: "cruise",
    file: "public/maps/cruise/gateways.json",
    floor: 0.7,
    offerings: () =>
      adaptCruise(
        read("public/maps/cruise/sailings.json"),
        read("public/maps/cruise/atlas-meta.json"),
        read("public/maps/cruise/data/itinerary-routes.json"),
        read("public/maps/cruise/region-overrides.json"),
      ),
  },
];

const fail = [];
const note = (atlas, msg) => fail.push(`${atlas}: ${msg}`);

/**
 * How far a gateway may sit from the journey's own end and still be that end.
 *
 * Not zero, and the reason is in the builder: gateways are shared by NAME, so
 * two journeys whose feeds geocoded "Kyoto" 2km apart share one, measured from
 * whichever defined it. The tolerance is therefore the builder's own clustering
 * radius — the file states it — and a gateway further away than that is a
 * different place, which is exactly what this is looking for.
 */
const nearEnough = (a, b, tol) => km(a, b) <= tol + 0.05;

let houseChecked = 0;
let houseAtlases = 0;

for (const spec of ATLASES) {
  if (!existsSync(join(ROOT, spec.file))) {
    note(spec.atlas, `${spec.file} is missing — run \`npm run build:gateway-hotels\``);
    continue;
  }
  const g = read(spec.file);
  const radius = g.radiusKm;
  if (!(radius > 0)) { note(spec.atlas, "no radiusKm"); continue; }

  // ── 1. structure ────────────────────────────────────────────────────────
  const usedHotels = new Set();
  for (const [key, gate] of Object.entries(g.GATES || {})) {
    if (!Array.isArray(gate?.ll) || !gate.h?.length) {
      note(spec.atlas, `gateway ${key} has no coordinate or no hotels`);
      continue;
    }
    for (const [id, dist] of gate.h) {
      const h = g.HOTELS?.[id];
      if (!h) { note(spec.atlas, `gateway ${key} names hotel ${id}, which is not in HOTELS`); continue; }
      usedHotels.add(id);
      // ── 2. geometry, recomputed from the two coordinates ────────────────
      const actual = km(gate.ll, h.ll);
      if (actual > radius + 0.05) {
        note(spec.atlas, `${h.n} is ${actual.toFixed(1)}km from ${key}, past the ${radius}km radius`);
      }
      if (Math.abs(actual - dist) > 0.11) {
        note(spec.atlas, `${h.n} at ${key}: file says ${dist}km, coordinates say ${actual.toFixed(1)}km`);
      }
    }
  }
  for (const id of Object.keys(g.HOTELS || {})) {
    if (!usedHotels.has(id)) note(spec.atlas, `hotel ${id} is in HOTELS but at no gateway`);
  }

  // ── 3 + 4. identity and ends, against the shipped adapters ──────────────
  const offerings = spec.offerings();
  const byId = new Map(offerings.map((o) => [String(o.id), o]));
  const rows = Object.entries(g.BYTRIP || {});
  if (!rows.length) { note(spec.atlas, "BYTRIP is empty"); continue; }

  let strays = 0;
  let endMismatch = 0;
  let firstStray = null;
  let firstEnd = null;
  for (const [id, row] of rows) {
    const o = byId.get(id);
    if (!o) { strays++; firstStray ??= id; continue; }
    for (const [side, idx] of [["pre", 0], ["post", "last"]]) {
      const key = row[side];
      if (!key) continue;
      const gate = g.GATES?.[key];
      if (!gate) { note(spec.atlas, `journey ${id} points at gateway ${key}, which is not in GATES`); continue; }
      if (!o.path?.length) continue;
      // The adapted path is [lng, lat]; the gateway is [lat, lng]. Transposing
      // one of them is the mistake this comparison is here to catch.
      const p = idx === 0 ? o.path[0] : o.path[o.path.length - 1];
      if (!nearEnough(gate.ll, [p[1], p[0]], g.clusterKm ?? 15)) {
        endMismatch++;
        firstEnd ??= `journey ${id} ${side} gateway ${key} at ${gate.ll} is ${km(gate.ll, [p[1], p[0]]).toFixed(0)}km from its ${side === "pre" ? "first" : "last"} plotted stop ${[p[1], p[0]]}`;
      }
    }
  }
  if (strays) {
    note(spec.atlas, `${strays} of ${rows.length} journeys in the file have no offering with that id (first: ${firstStray}) — the key convention has drifted from the adapter`);
  }
  if (endMismatch) note(spec.atlas, `${endMismatch} gateways are not the journey's own first/last plotted stop — ${firstEnd}`);

  // ── 5. the affinity, through the shipped read side ──────────────────────
  const index = indexGateways(g);
  let checkedHere = 0;
  for (const [id, row] of rows) {
    if (!row.house) continue;
    const stays = index.forTrip(id);
    if (!stays) { note(spec.atlas, `journey ${id} is in BYTRIP but forTrip() returns nothing`); continue; }
    for (const side of ["pre", "post"]) {
      const gate = row[side] ? g.GATES[row[side]] : null;
      if (!gate) continue;
      const hasHouse = gate.h.some(([hid]) => g.HOTELS[hid]?.aff === row.house);
      if (!hasHouse) continue;
      const first = stays[side]?.stays?.[0];
      if (!first?.sameHouse) {
        note(spec.atlas, `journey ${id} is a ${row.house} journey and its ${side} gateway holds a ${row.house} hotel, but ${first?.name ?? "nothing"} came back first`);
      }
      checkedHere++;
    }
  }
  houseChecked += checkedHere;
  if (checkedHere) houseAtlases++;

  // ── 6. coverage ─────────────────────────────────────────────────────────
  const covered = rows.length / offerings.length;
  if (covered < spec.floor) {
    note(
      spec.atlas,
      `only ${rows.length} of ${offerings.length} journeys (${(covered * 100).toFixed(0)}%) have a gateway, under the ${(spec.floor * 100).toFixed(0)}% floor`,
    );
  }
  console.log(
    `verify-gateway-hotels: ${spec.atlas} — ${rows.length}/${offerings.length} journeys ` +
      `(${(covered * 100).toFixed(0)}%), ${Object.keys(g.GATES).length} gateways, ` +
      `${Object.keys(g.HOTELS).length} hotels, ${checkedHere} house placements checked`,
  );
}

/*
 * The brand affinity has to be exercised SOMEWHERE.
 *
 * Every assertion above is conditional — on a journey having a house, on that
 * house having a hotel at that gateway — so a table that stopped matching
 * anything at all would pass all of them in silence. Two collections have to
 * have produced at least one placement between them: yacht, whose four brands
 * are hotel houses, and jet, whose Four Seasons and Aman expeditions are the
 * case that motivated the table.
 */
if (houseChecked === 0 || houseAtlases < 2) {
  fail.push(
    `brand affinity: only ${houseChecked} house placements across ${houseAtlases} collections — the HOUSES table in build-gateway-hotels.mjs has stopped matching`,
  );
}

if (fail.length) {
  console.error(`\nverify-gateway-hotels: ${fail.length} problem(s)`);
  for (const f of fail.slice(0, 40)) console.error(`  ✗ ${f}`);
  if (fail.length > 40) console.error(`  … and ${fail.length - 40} more`);
  process.exit(1);
}
console.log(`verify-gateway-hotels: OK — ${houseChecked} house placements verified across ${houseAtlases} collections.`);

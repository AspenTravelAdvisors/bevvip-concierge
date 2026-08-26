#!/usr/bin/env node
/**
 * verify-landmask — prove the committed mask still knows where the land is.
 *
 * This exists because the failure it guards against is SILENT. The mask that
 * shipped before this check could not see Brac, Capri, Cape Cod or Santorini,
 * and every route drawn straight through them came back from the router
 * labelled "sea" — A* had honestly routed around every obstacle it was given.
 * Nothing in the build went red. The only way anyone found out was by looking
 * at a map of the Adriatic and seeing a yacht sail over an island.
 *
 * So the assertions here are about GROUND TRUTH, not about the file:
 *
 *   land        26 points that are unambiguously on land, chosen because a
 *               coarse or point-sampled mask misses exactly these — long thin
 *               islands, small islands and peninsulas.
 *   ocean       9 points that are unambiguously open water, so a mask that
 *               simply marked everything as land could not pass.
 *   passages    the ports that are only reachable through a channel narrower
 *               than a cell. Delete data/atlas/shared/sea-passages.json and the
 *               entire Black Sea fails here rather than in production.
 *   coverage    a land fraction in a plausible band, catching a truncated or
 *               half-written file that happens to be the right length.
 *
 * Byte-equality against a fresh rasterisation is a different question and lives
 * in `node scripts/build-landmask.mjs --check`, which needs the Natural Earth
 * sources cached. This one needs nothing but the committed mask, so it can run
 * anywhere.
 *
 *   node scripts/verify-landmask.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSeaRouter, MASK_BYTES, MASK_RES, MASK_W, MASK_H } from "../lib/atlas/sea-router.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MASK = join(ROOT, "data/atlas/shared/landmask.bin");

/**
 * Land the old 0.1-degree mask could not see, plus a few it could.
 *
 * Fourteen of these read as open ocean before the rebuild. They are kept
 * together, passing and failing alike, so the table stays a description of the
 * world rather than a list of things that once went wrong.
 */
const LAND = [
  ["Dugi Otok, Croatia", 44.05, 15.05], ["Brac, Croatia", 43.32, 16.62],
  ["Peljesac, Croatia", 42.95, 17.35], ["Korcula, Croatia", 42.95, 16.95],
  ["Cres, Croatia", 44.85, 14.40], ["Krk, Croatia", 45.05, 14.60],
  ["Long Island, USA", 40.85, -72.90], ["Cape Cod, USA", 41.95, -70.05],
  ["Baja California tip", 24.50, -111.50], ["Kyushu, Japan", 32.50, 131.00],
  ["Bali, Indonesia", -8.35, 115.15], ["Phuket, Thailand", 8.00, 98.35],
  ["Corsica", 42.15, 9.10], ["Sardinia", 40.10, 9.10],
  ["Crete", 35.25, 24.80], ["Rhodes", 36.20, 28.00],
  ["Santorini", 36.40, 25.43], ["Mykonos", 37.45, 25.35],
  ["Capri", 40.55, 14.24], ["Elba", 42.78, 10.30],
  ["Isle of Skye", 57.30, -6.20], ["Jersey", 49.21, -2.13],
  ["Bornholm", 55.13, 14.92], ["Lofoten", 68.20, 13.90],
  ["East Falkland", -51.75, -58.60], ["Tierra del Fuego", -54.00, -68.50],
];

const OCEAN = [
  ["open Adriatic", 43.30, 15.30], ["mid Atlantic", 30.00, -40.00],
  ["Gulf of Lion", 42.80, 4.50], ["open Aegean", 37.00, 25.00],
  ["English Channel", 50.20, -1.00], ["open Caribbean", 15.00, -70.00],
  ["open Pacific", 0, -150], ["open Baltic", 56.50, 18.50],
  ["Drake Passage", -58.00, -65.00],
];

/**
 * Ports that exist only because a passage was carved.
 *
 * Every one of these sits behind water narrower than a cell, so an honest
 * rasterisation walls it off and sea-passages.json lets it back in. 25 km is
 * the tolerance: a berth is inland of the fairway by a few kilometres almost
 * everywhere, and the router snaps to the nearest connected ocean anyway.
 */
const BEHIND_A_PASSAGE = [
  ["Istanbul, through the Bosphorus", 41.01, 28.95],
  ["Odessa, through the Turkish Straits", 46.49, 30.74],
  ["Constanta, Black Sea", 44.17, 28.65],
  ["Port Said, Suez Canal north", 31.26, 32.30],
  ["Aqaba, through Suez", 29.53, 35.00],
  ["Colon, Panama Canal Atlantic", 9.36, -79.90],
  ["Balboa, Panama Canal Pacific", 8.95, -79.56],
  ["Messina, through the strait", 38.19, 15.55],
  ["Stockholm, through the archipelago", 59.33, 18.07],
  ["Singapore Strait", 1.26, 103.82],
  ["Venice", 45.44, 12.33],
];

const SEA_ACCESS_KM = 25;

/** Land as a share of the grid. Earth is ~29%; conservative marking adds a few. */
const LAND_FRACTION = [0.28, 0.38];

if (!existsSync(MASK)) {
  console.error(`MISSING: data/atlas/shared/landmask.bin — build it: npm run build:landmask`);
  process.exit(1);
}
const buf = readFileSync(MASK);
if (buf.length !== MASK_BYTES) {
  console.error(`landmask is ${buf.length} bytes, expected ${MASK_BYTES} (${MASK_W}x${MASK_H} at ${MASK_RES} cells/deg). Rebuild it: npm run build:landmask`);
  process.exit(1);
}

const router = createSeaRouter(buf, {});
let failures = 0;

console.log(`landmask  ${MASK_W}x${MASK_H} at ${MASK_RES} cells/deg (~${(111 / MASK_RES).toFixed(1)} km)`);
console.log("=".repeat(78));

const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];
let landCells = 0;
for (const byte of buf) landCells += POPCOUNT[byte];
const fraction = landCells / (MASK_W * MASK_H);
const coverageOk = fraction >= LAND_FRACTION[0] && fraction <= LAND_FRACTION[1];
if (!coverageOk) failures++;
console.log(`  ${coverageOk ? "ok  " : "FAIL"}  land coverage ${(fraction * 100).toFixed(1)}%  (expected ${(LAND_FRACTION[0] * 100).toFixed(0)}–${(LAND_FRACTION[1] * 100).toFixed(0)}%)`);

let landMisses = 0;
for (const [name, lat, lng] of LAND) {
  if (!router.isLandLL(lat, lng)) { landMisses++; console.log(`  FAIL  ${name} reads as open ocean`); }
}
if (landMisses) failures++;
console.log(`  ${landMisses ? "FAIL" : "ok  "}  ${LAND.length - landMisses}/${LAND.length} known land points are land`);

let oceanMisses = 0;
for (const [name, lat, lng] of OCEAN) {
  if (router.isLandLL(lat, lng)) { oceanMisses++; console.log(`  FAIL  ${name} reads as land`); }
}
if (oceanMisses) failures++;
console.log(`  ${oceanMisses ? "FAIL" : "ok  "}  ${OCEAN.length - oceanMisses}/${OCEAN.length} known ocean points are water`);

let stranded = 0;
for (const [name, lat, lng] of BEHIND_A_PASSAGE) {
  const km = router.seaAccessKm(lat, lng);
  if (!(Number.isFinite(km) && km <= SEA_ACCESS_KM)) {
    stranded++;
    console.log(`  FAIL  ${name} is ${Number.isFinite(km) ? `${km.toFixed(0)} km` : "infinitely far"} from connected ocean`);
  }
}
if (stranded) failures++;
console.log(`  ${stranded ? "FAIL" : "ok  "}  ${BEHIND_A_PASSAGE.length - stranded}/${BEHIND_A_PASSAGE.length} ports behind a carved passage can reach the sea`);

console.log("=".repeat(78));
if (failures) {
  console.error(`\n${failures} check${failures > 1 ? "s" : ""} failed. If the mask or sea-passages.json changed on purpose, rebuild and re-read the diff: npm run build:landmask`);
  process.exit(1);
}
console.log("\nthe landmask knows where the land is");

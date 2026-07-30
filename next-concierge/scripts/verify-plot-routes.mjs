/**
 * Can the home globe find a route for what the Guide plots?
 *
 * This covers the one failure in the plot path that is INVISIBLE. If a
 * collection's ids stop matching the keys in its geometry index, pins still
 * plot, the camera still moves, nothing throws — the routes simply never
 * appear. Nobody would notice from a stack trace; you'd have to be looking at
 * the right region of the map at the right moment.
 *
 * So rather than trust it, resolve EVERY offering in every routed collection
 * through the real shipped lookup (lib/atlas/adapters/plot-routes.ts) and
 * assert coverage. `fetch` is stubbed onto the public/ directory so the actual
 * module runs, rather than a transcription of it that could drift.
 *
 *   node scripts/verify-plot-routes.mjs
 */

import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, ".adapters-build");

// Serve public/ to the modules under test, so loadSeaRoutes / loadRailGeometry
// run exactly as they do in the browser.
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^\//, "");
  const path = join(ROOT, "public", rel);
  if (!existsSync(path)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, "utf8")) };
};

rmSync(BUILD, { recursive: true, force: true });
execFileSync("npx", ["tsc", "-p", "tsconfig.adapters.json"], { cwd: ROOT, stdio: "inherit" });
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []);
for (const file of walk(BUILD)) {
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/from "@\/lib\/atlas\/geo"/g, 'from "../geo.js"')
    .replace(/from "(\.\/[a-zA-Z-]+)"/g, 'from "$1.js"'));
}

const mod = (n) => import(pathToFileURL(join(BUILD, "adapters", n)).href);
const { legsForResults, idCandidates, ROUTED_COLLECTIONS } = await mod("plot-routes.js");
const { adaptYacht, YACHT_DESCRIPTOR } = await mod("yacht.js");
const { adaptWorldCruise } = await mod("worldcruise.js");
const { adaptCruise } = await mod("cruise.js");
const { adaptTrain } = await mod("train.js");

const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

// Same sources the collection pages load.
const collections = {
  yacht: () => adaptYacht(readJson("public/maps/yacht/itinerary.json")),
  worldcruise: () => adaptWorldCruise(readJson("public/maps/worldcruise/itinerary.json")),
  cruise: () => adaptCruise(
    readJson("public/maps/cruise/sailings.json"),
    readJson("public/maps/cruise/atlas-meta.json"),
    readJson("public/maps/cruise/data/itinerary-routes.json"),
  ),
  train: () => adaptTrain(readJson("public/maps/train/itinerary.json")),
};

/** Coverage floors. Not 100%: some trips genuinely ship no geometry. */
const FLOOR = { yacht: 0.9, worldcruise: 0.9, cruise: 0.5, train: 0.9 };

console.log("\nRoute geometry reachable from a Guide result id\n");
let failed = false;

for (const [name, build] of Object.entries(collections)) {
  if (!ROUTED_COLLECTIONS.has(name)) { console.log(`  ${name}: not routed, skipped`); continue; }
  let offerings;
  try {
    offerings = build();
  } catch (e) {
    console.log(`  ${name.padEnd(12)} SKIP (source unavailable: ${e.message})`);
    continue;
  }

  // Resolve through the real lookup, exactly as tracePlottedRoutes does — and
  // with the PREFIXED alias, which is the form Guide deep links carry.
  const rawIds = offerings.map((o) => o.id);
  const prefixed = offerings.map((o) => o.idAliases.find((a) => a !== o.id) ?? o.id);

  const byRaw = await legsForResults(new Map([[name, rawIds]]));
  const byPrefixed = await legsForResults(new Map([[name, prefixed]]));

  // Per-offering hit rate, so a partial failure can't hide behind a big total.
  let hits = 0;
  for (const o of offerings) {
    const one = await legsForResults(new Map([[name, [o.id]]]));
    if (one.length) hits++;
  }
  const rate = offerings.length ? hits / offerings.length : 0;
  const floor = FLOOR[name] ?? 0.5;
  const ok = rate >= floor && byRaw.length > 0;

  // The prefixed form MUST resolve to the same geometry as the raw one — this
  // is the assertion that would have caught a bad idCandidates().
  const aliasOk = byPrefixed.length === byRaw.length;

  console.log(
    `  ${ok && aliasOk ? " ok  " : "FAIL "} ${name.padEnd(12)} ` +
    `${hits}/${offerings.length} offerings resolve (${(rate * 100).toFixed(1)}%, floor ${(floor * 100).toFixed(0)}%)  ` +
    `· raw ${byRaw.length} legs · prefixed ${byPrefixed.length} legs`,
  );
  if (!ok) { console.error(`         ↳ coverage below floor, or no geometry at all`); failed = true; }
  if (!aliasOk) {
    console.error(`         ↳ PREFIXED ids resolve differently from raw ids — idCandidates() is wrong`);
    failed = true;
  }
}

// idCandidates itself, on the shapes that actually occur.
const cases = [
  ["yc_123", ["yc_123", "123"]],
  ["wc_9", ["wc_9", "9"]],
  ["cr_abc", ["cr_abc", "abc"]],
  ["rj_15694760", ["rj_15694760", "15694760"]],
  ["jt_7", ["jt_7", "7"]],
  ["h_00001", ["h_00001", "00001"]],
  ["15694760", ["15694760"]],            // already raw
  ["nc_5", ["nc_5"]],                    // unknown prefix: left alone
];
let unitFail = 0;
for (const [input, want] of cases) {
  const got = idCandidates(input);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`  FAIL idCandidates(${input}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    unitFail++;
  }
}
console.log(`\n  ${unitFail ? "FAIL " : " ok  "} idCandidates: ${cases.length - unitFail}/${cases.length} id shapes`);
if (unitFail) failed = true;

console.log(failed ? "\nFAILED\n" : "\nPlot routes resolve for every routed collection\n");
process.exit(failed ? 1 : 0);

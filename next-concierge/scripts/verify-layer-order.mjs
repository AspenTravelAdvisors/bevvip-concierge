/**
 * Does the globe stack the collections in the order the agency sells them?
 *
 * The Atlas draws eight collections on one map. Their z-order is a commercial
 * decision, not a rendering detail: we sell private aviation, so a private jet
 * expedition's glowing white marker must never be masked by one of the 2,240
 * hotel pins it happens to sit on top of. lib/atlas-config's `order` is where
 * that decision lives — rank 1 on top, rank 8 at the bottom — and AtlasShell
 * derives the stack from it.
 *
 * The reason this needs a test rather than a careful read is arrival order.
 * Overlay pins paint ON ARRIVAL, one fetch per collection, all in flight at
 * once. Before `stackBefore` the z-order was therefore whichever feed the
 * network happened to return first: the jets could sit over the hotels on a
 * fast connection and under them on a slow one, on the same build, with
 * nothing in the code to point at. That is invisible to tsc, invisible in a
 * screenshot taken on a warm cache, and it is the exact property the ordering
 * work was for.
 *
 * So: slice the real ranking code out of AtlasShell.tsx, drive it with a map
 * stub that models Mapbox's insert-before semantics, and run EVERY arrival
 * order (all 40,320 of them) through it.
 *
 *   node scripts/verify-layer-order.mjs
 */

import { readFileSync, writeFileSync, copyFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = mkdtempSync(join(tmpdir(), "layer-order-"));
const SRC = readFileSync(join(ROOT, "components/AtlasShell.tsx"), "utf8");

// ── Slice the real thing ────────────────────────────────────────────────────
// Anchored on declarations, not line numbers, and loud when an anchor moves.
function between(open, close) {
  const a = SRC.indexOf(open);
  const b = SRC.indexOf(close, a + 1);
  if (a < 0 || b < 0) {
    throw new Error(`verify-layer-order: anchor moved — could not find ${a < 0 ? open : close}`);
  }
  return SRC.slice(a, b);
}

// Z_ORDER, collectionOfLayer and stackBefore are one block by construction:
// they are the ranking, the id parser and the scan, and splitting them would
// let two of the three drift.
const ranking = between("const Z_ORDER:", "// Selectable Mapbox basemaps");
// The real inserter, including its fall back to the top when a beforeId has
// gone. A stub of this would be the one line most worth getting wrong. Sliced
// from AUTHORED because addLayer records into it on the way past; the muting
// helpers that come along in the range are inert here (verify-legend-focus is
// where they are exercised) and cost only the two constants they close over.
const inserter = between("const AUTHORED = new Map<", "function setFog(");
const muteConsts = ["MUTE_OPACITY", "MUTE_MS"].map((n) => {
  const m = new RegExp(`^const ${n} = [\\d.]+;$`, "m").exec(SRC);
  if (!m) throw new Error(`verify-layer-order: ${n} moved or changed shape`);
  return m[0];
}).join("\n");

copyFileSync(join(ROOT, "lib/atlas-config.ts"), join(OUT, "atlas-config.ts"));
copyFileSync(join(ROOT, "lib/types.ts"), join(OUT, "types.ts"));
writeFileSync(
  join(OUT, "stack.ts"),
  `/* eslint-disable */\n` +
    `import { COLLECTIONS } from "./atlas-config.js";\n` +
    `type MBMap = any;\n` +
    `${muteConsts}\n${ranking}\n${inserter}\n` +
    `export { Z_ORDER, collectionOfLayer, stackBefore, addLayer, COLLECTIONS };\n`,
);

execFileSync("npx", [
  "tsc", join(OUT, "stack.ts"),
  "--outDir", join(OUT, "js"), "--module", "esnext", "--target", "es2022",
  "--moduleResolution", "bundler", "--skipLibCheck",
], { cwd: ROOT, stdio: "inherit" });

const { Z_ORDER, collectionOfLayer, stackBefore, addLayer, COLLECTIONS } =
  await import(pathToFileURL(join(OUT, "js/stack.js")).href);

// ── A map that stacks the way Mapbox stacks ─────────────────────────────────
// addLayer(spec) appends to the top; addLayer(spec, beforeId) inserts BELOW
// that layer and throws if it is not there. Both halves matter: the throw is
// what the fallback in the real addLayer exists for.
function makeMap(base = ["background", "water", "settlement-label"]) {
  const layers = base.map((id) => ({ id }));
  return {
    layers,
    getLayer: (id) => layers.find((l) => l.id === id),
    getStyle: () => ({ layers }),
    setPaintProperty() {},
    setLayoutProperty() {},
    addLayer(spec, before) {
      if (before != null) {
        const i = layers.findIndex((l) => l.id === before);
        if (i < 0) throw new Error("no layer " + before);
        layers.splice(i, 0, spec);
        return;
      }
      layers.push(spec);
    },
  };
}

/**
 * What AtlasShell's painters do, in miniature: one stackBefore read per
 * collection, then every layer that collection owns inserted at it.
 *
 * The ranking is the real code; only this call shape is restated, and it is
 * restated because the point of the test is to vary the ORDER it is called in,
 * which is the one thing the component itself never controls.
 */
function paint(map, key, withRoutes) {
  const at = stackBefore(map, key);
  const ids = key === "hotel"
    ? ["hotel-heat", "hotel-dots"]
    : ["t_" + key + "_glow", "t_" + key + "_dot"];
  for (const id of ids) addLayer(map, { id, type: "circle" }, at);
  if (withRoutes && key !== "hotel" && key !== "villa") {
    const rAt = stackBefore(map, key);
    for (const id of ["r_" + key + "_shadow", "r_" + key + "_line"]) {
      addLayer(map, { id, type: "line" }, rAt);
    }
  }
}

/** The collection ranks the finished style carries, bottom of the map upward. */
function stackRanks(map) {
  return map.layers
    .map((l) => collectionOfLayer(l.id))
    .filter(Boolean)
    .map((k) => Z_ORDER[k]);
}

/** Bottom-up ranks must never increase: 8 at the floor, 1 at the ceiling. */
function wellStacked(ranks) {
  return ranks.every((r, i) => i === 0 || ranks[i - 1] >= r);
}

function* permutations(xs) {
  if (xs.length <= 1) { yield xs; return; }
  for (let i = 0; i < xs.length; i++) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest)) yield [xs[i], ...p];
  }
}

const checks = [];
const keys = COLLECTIONS.map((c) => c.type);

// ── 1. The order itself, pinned ─────────────────────────────────────────────
// The commercial ranking is the deliverable, so it is asserted literally
// rather than left as whatever the registry happens to say. Changing the house
// order is a one-line edit here AND there, on purpose: it is a business
// decision and should not be reachable by accident.
const HOUSE_ORDER = [
  "jet",         // 1 — the primary revenue driver
  "yacht",       // 2 — ultra-luxury nautical, same clientele
  "safari",      // 3 — high-ACV experiential, pairs with charters
  "cruise",      // 4 — high-yield expedition adventure
  "worldcruise", // 5 — long-form, huge lifetime value, low density
  "train",       // 6 — iconic scenic journeys
  "villa",       // 7 — high-value stays, 3,900+ pins
  "hotel",       // 8 — foundational base layer, 2,240+ pins
];
checks.push([
  "the collections rank in house order",
  keys.length === HOUSE_ORDER.length && keys.every((k, i) => k === HOUSE_ORDER[i]),
  keys.join(" › "),
]);
checks.push([
  "ranks are 1..8 with no gaps or ties",
  new Set(Object.values(Z_ORDER)).size === keys.length &&
    COLLECTIONS.every((c) => c.order >= 1 && c.order <= keys.length),
  COLLECTIONS.map((c) => `${c.type}:${c.order}`).join(" "),
]);

// ── 2. Every arrival order lands the same stack ─────────────────────────────
let worst = null;
let n = 0;
for (const arrival of permutations(keys)) {
  n++;
  const map = makeMap();
  for (const k of arrival) paint(map, k, false);
  if (!wellStacked(stackRanks(map))) { worst = arrival; break; }
}
checks.push([
  "every arrival order stacks jets over hotels",
  worst === null,
  worst ? `broken by ${worst.join(" → ")}` : `${n.toLocaleString()} orders, all identical`,
]);

// The failure this was written for, named on its own so a regression reads as
// itself rather than as "one of 40,320".
{
  const map = makeMap();
  paint(map, "jet", false);   // small feed, lands first
  paint(map, "hotel", false); // the 2,240-pin field, lands last
  const ids = map.layers.map((l) => l.id);
  checks.push([
    "a late hotel field goes UNDER the jets, not over them",
    ids.indexOf("hotel-dots") < ids.indexOf("t_jet_dot"),
    ids.filter((i) => collectionOfLayer(i)).join(" ‹ "),
  ]);
}

// ── 3. Routes ride at their collection's rank ───────────────────────────────
{
  const map = makeMap();
  for (const k of ["hotel", "villa", "train", "worldcruise", "cruise", "safari", "yacht", "jet"]) {
    paint(map, k, true);
  }
  const ranks = stackRanks(map);
  checks.push([
    "pins and routes stack as one band per collection",
    wellStacked(ranks),
    ranks.join(" ‹ "),
  ]);
  const ids = map.layers.map((l) => l.id);
  checks.push([
    "a rail line does not cross the jet expeditions",
    ids.indexOf("r_train_line") < ids.indexOf("t_jet_glow"),
    `rail at ${ids.indexOf("r_train_line")}, jets at ${ids.indexOf("t_jet_glow")}`,
  ]);
}

// ── 4. Plotted results outrank everything ───────────────────────────────────
// What the Guide just answered with must stay on top, including when a slow
// ambient feed lands after the plot.
{
  const map = makeMap();
  paint(map, "hotel", false);
  for (const id of ["featured-pulse", "featured-glow", "featured-dot"]) {
    addLayer(map, { id, type: "circle" });
  }
  paint(map, "jet", false); // the late arrival that used to cover the answer
  const ids = map.layers.map((l) => l.id);
  checks.push([
    "a late feed cannot cover the plotted results",
    ids.indexOf("t_jet_dot") < ids.indexOf("featured-pulse"),
    ids.join(" ‹ "),
  ]);
}

// ── 5. A vanished beforeId falls back rather than dropping the layer ────────
// stackBefore reads the style; a restyle can remove that layer before the
// insert lands. Mapbox throws there, and a thrown layer is an invisible
// collection — worse than a mis-stacked one.
{
  const map = makeMap();
  addLayer(map, { id: "t_jet_dot", type: "circle" });
  const at = stackBefore(map, "hotel");
  map.layers.length = 0; // the restyle, mid-flight
  addLayer(map, { id: "hotel-dots", type: "circle" }, at);
  checks.push([
    "a layer whose anchor vanished is still drawn",
    !!map.getLayer("hotel-dots"),
    at ? `anchor was ${at}` : "no anchor",
  ]);
}

console.log("\nAtlas layer order\n");
let bad = false;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? " ok  " : "FAIL "} ${name}  (${detail})`);
  if (!ok) bad = true;
}
console.log("\n  Top of the map down:");
for (const c of COLLECTIONS) {
  console.log(`      ${String(c.order)}. ${c.nav.padEnd(24)} ${c.count.toLocaleString().padStart(6)}`);
}
rmSync(OUT, { recursive: true, force: true });
console.log(bad ? "\nFAILED\n" : "\nThe globe stacks the way the agency sells\n");
process.exit(bad ? 1 : 0);

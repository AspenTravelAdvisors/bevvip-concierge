/**
 * Clicking a legend row: does it mute the rest, or delete them?
 *
 * The legend is a focus control — press "Luxury Hotel Yachts" and that
 * collection comes forward while the other seven fall back. It used to do that
 * by hiding them, which answered "which pins are yachts" and destroyed the
 * answer to "near what": 467 dots on an empty ocean with nothing to place them
 * against. Focus now fades instead, and the focused collection's pins ring.
 *
 * Both halves are easy to get subtly wrong in ways nothing else catches:
 *
 *   - A mute that cannot be undone. Un-muting has to restore the exact paint
 *     the layer was born with, and several of those are zoom interpolations
 *     nothing else remembers. Restoring a flat 1 instead would look fine on the
 *     globe and quietly destroy the hotel field's zoom ramp.
 *   - A mute that Mapbox rejects. `["*", <interpolate>, 0.16]` is the obvious
 *     way to scale an opacity and is INVALID for camera-only properties like
 *     heatmap-opacity, where zoom must be the input of the outermost
 *     interpolate. It fails at runtime, inside a try/catch, silently.
 *   - Anything at all still being hidden. One `visibility: none` survivor and
 *     the gesture is back to deleting the map.
 *
 * So: slice the real muting code out of AtlasShell.tsx and drive it.
 *
 *   node scripts/verify-legend-focus.mjs
 */

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = mkdtempSync(join(tmpdir(), "legend-focus-"));
const SRC = readFileSync(join(ROOT, "components/AtlasShell.tsx"), "utf8");

function between(open, close) {
  const a = SRC.indexOf(open);
  const b = SRC.indexOf(close, a + 1);
  if (a < 0 || b < 0) {
    throw new Error(`verify-legend-focus: anchor moved — could not find ${a < 0 ? open : close}`);
  }
  return SRC.slice(a, b);
}

// AUTHORED, DIM_PROPS, scaleOpacity, dimLayer and addLayer are one block: the
// record and the restore have to be read from the same source or a test proves
// nothing about whether they agree.
const muting = between("const AUTHORED = new Map<", "function setFog(");
// The two constants, grabbed individually so retuning the mute does not need
// an edit here as well.
const consts = ["MUTE_OPACITY", "MUTE_MS"].map((n) => {
  const m = new RegExp(`^const ${n} = [\\d.]+;$`, "m").exec(SRC);
  if (!m) throw new Error(`verify-legend-focus: ${n} moved or changed shape`);
  return m[0];
}).join("\n");
const MUTE = Number(/^const MUTE_OPACITY = ([\d.]+);$/m.exec(SRC)[1]);

writeFileSync(
  join(OUT, "mute.ts"),
  `/* eslint-disable */\ntype MBMap = any;\n${consts}\n${muting}\n` +
    `export { AUTHORED, scaleOpacity, dimLayer, restPaint, addLayer, MUTE_OPACITY };\n`,
);
execFileSync("npx", [
  "tsc", join(OUT, "mute.ts"), "--outDir", join(OUT, "js"),
  "--module", "esnext", "--target", "es2022",
  "--moduleResolution", "bundler", "--skipLibCheck",
], { cwd: ROOT, stdio: "inherit" });

const { AUTHORED, scaleOpacity, dimLayer, restPaint, addLayer } =
  await import(pathToFileURL(join(OUT, "js/mute.js")).href);

// ── A map that records paint the way Mapbox applies it ──────────────────────
function makeMap() {
  const layers = new Map();
  return {
    layers,
    getLayer: (id) => layers.get(id),
    getStyle: () => ({ layers: [...layers.values()] }),
    addLayer(spec) { layers.set(spec.id, { ...spec, paint: { ...(spec.paint ?? {}) } }); },
    setLayoutProperty(id, prop, val) {
      const l = layers.get(id);
      if (l) (l.layout ??= {})[prop] = val;
    },
    setPaintProperty(id, prop, val) {
      const l = layers.get(id);
      if (!l) throw new Error("no layer " + id);
      l.paint[prop] = val;
    },
  };
}

/** The real hotel-dots ramp, as authored. Muting must survive a round trip. */
const RAMP = ["interpolate", ["linear"], ["zoom"], 2.45, 0.18, 3.2, 0.62, 7, 0.92];

const checks = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. Scaling keeps the expression an expression ───────────────────────────
{
  const dimmed = scaleOpacity(RAMP, MUTE);
  checks.push([
    "a zoom ramp scales to a zoom ramp, not a product",
    Array.isArray(dimmed) && dimmed[0] === "interpolate" && eq(dimmed.slice(0, 3), RAMP.slice(0, 3)),
    Array.isArray(dimmed) ? String(dimmed[0]) : typeof dimmed,
  ]);
  // The failure this shape exists to avoid: heatmap-opacity is camera-only, so
  // ["*", <interpolate>, f] is rejected outright and the mute silently no-ops.
  checks.push([
    "…so zoom stays the input of the outermost interpolate",
    Array.isArray(dimmed) && eq(dimmed[2], ["zoom"]),
    JSON.stringify(dimmed?.[2]),
  ]);
  const stops = dimmed.filter((_, i) => i >= 3 && i % 2 === 0);
  const want = RAMP.filter((_, i) => i >= 3 && i % 2 === 0).map((v) => v * MUTE);
  checks.push([
    "…with every stop scaled and every zoom left alone",
    eq(stops, want) && eq(dimmed.filter((_, i) => i >= 3 && i % 2), RAMP.filter((_, i) => i >= 3 && i % 2)),
    stops.map((v) => v.toFixed(3)).join(", "),
  ]);
  checks.push([
    "a constant opacity scales to a constant",
    scaleOpacity(0.8, MUTE) === 0.8 * MUTE,
    String(scaleOpacity(0.8, MUTE)),
  ]);
}

// ── 2. A mute is exactly reversible ─────────────────────────────────────────
{
  const map = makeMap();
  addLayer(map, {
    id: "hotel-dots", type: "circle", source: "s",
    paint: { "circle-opacity": RAMP, "circle-color": "#f7e6a0" },
  });
  addLayer(map, {
    id: "hotel-heat", type: "heatmap", source: "s",
    paint: { "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.36, 4.3, 0] },
  });
  addLayer(map, {
    id: "r_yacht_line", type: "line", source: "s",
    paint: { "line-opacity": 0.82, "line-color": "#e0b84a" },
  });
  const before = JSON.parse(JSON.stringify([...map.layers.values()].map((l) => l.paint)));

  for (const id of ["hotel-dots", "hotel-heat", "r_yacht_line"]) dimLayer(map, id, true);
  const muted = [...map.layers.values()].map((l) => l.paint);
  checks.push([
    "muting actually changes every opacity it owns",
    !eq(muted, before),
    `${muted.length} layers`,
  ]);
  checks.push([
    "…and nothing else — colour, radius and the rest are untouched",
    map.getLayer("hotel-dots").paint["circle-color"] === "#f7e6a0" &&
      map.getLayer("r_yacht_line").paint["line-color"] === "#e0b84a",
    "paint keys held",
  ]);

  for (const id of ["hotel-dots", "hotel-heat", "r_yacht_line"]) dimLayer(map, id, false);
  const after = [...map.layers.values()].map((l) => l.paint);
  checks.push([
    "un-muting restores the authored ramp, not a flat 1",
    eq(map.getLayer("hotel-dots").paint["circle-opacity"], RAMP),
    JSON.stringify(map.getLayer("hotel-dots").paint["circle-opacity"]).slice(0, 60),
  ]);
  // Compared against what was AUTHORED, key by key. Two things are expected to
  // differ and neither is a restore failure: the transitions set on the way in,
  // and an opacity the layer never declared, which comes back written out at
  // the Mapbox default it was already using (asserted on its own below).
  const restored = after.every((paint, i) =>
    Object.entries(before[i]).every(([k, v]) => eq(paint[k], v)));
  checks.push([
    "…for every layer, property by property",
    restored,
    "round trip clean",
  ]);
}

// ── 3. A stroke the layer never authored still mutes, and comes back to 1 ───
{
  const map = makeMap();
  addLayer(map, { id: "t_jet_dot", type: "circle", source: "s", paint: { "circle-radius": 5 } });
  dimLayer(map, "t_jet_dot", true);
  const dimmed = map.getLayer("t_jet_dot").paint["circle-stroke-opacity"];
  dimLayer(map, "t_jet_dot", false);
  checks.push([
    "an unset stroke opacity mutes from its default and returns to it",
    dimmed === MUTE && map.getLayer("t_jet_dot").paint["circle-stroke-opacity"] === 1,
    `${dimmed} → ${map.getLayer("t_jet_dot").paint["circle-stroke-opacity"]}`,
  ]);
}

// ── 4. Nothing is ever hidden ───────────────────────────────────────────────
{
  const map = makeMap();
  for (const id of ["t_yacht_glow", "t_yacht_dot", "hotel-dots"]) {
    addLayer(map, { id, type: "circle", source: "s", paint: { "circle-opacity": 1 } });
  }
  for (const id of ["t_yacht_glow", "t_yacht_dot"]) dimLayer(map, id, true);
  const invisible = [...map.layers.values()].filter((l) => l.layout?.visibility === "none");
  checks.push([
    "focusing a collection hides nothing",
    invisible.length === 0,
    invisible.length ? invisible.map((l) => l.id).join(", ") : "0 layers switched off",
  ]);
  const dim = map.getLayer("t_yacht_dot").paint["circle-opacity"];
  checks.push([
    "…the muted ones are visible but clearly behind",
    dim > 0 && dim <= 0.25,
    `muted to ${dim}`,
  ]);
}

// ── 5. The record survives a map that stores the spec by reference ──────────
// Mapbox deep-copies a layer spec; the headless stub does not, and neither
// promise is one this should depend on. If AUTHORED holds the live object, the
// first mute rewrites the value the restore reads and "Show all" leaves the map
// faded — which is exactly what a browser drive caught after the unit checks
// here passed against a harness that happened to copy.
{
  const aliasing = {
    layers: new Map(),
    getLayer(id) { return this.layers.get(id); },
    addLayer(spec) { this.layers.set(spec.id, spec); }, // no copy, on purpose
    setPaintProperty(id, prop, val) { (this.layers.get(id).paint ??= {})[prop] = val; },
  };
  addLayer(aliasing, { id: "t_jet_dot", type: "circle", source: "s", paint: { "circle-opacity": 0.9 } });
  dimLayer(aliasing, "t_jet_dot", true);
  dimLayer(aliasing, "t_jet_dot", false);
  const back = aliasing.getLayer("t_jet_dot").paint["circle-opacity"];
  checks.push([
    "the authored paint is a snapshot, not a live view of the layer",
    back === 0.9,
    `restored to ${back} (authored 0.9)`,
  ]);
}

// ── 6. A layer that fades in remembers where it came to rest ────────────────
// The hotel field is authored at `circle-opacity: 0` and breathes up to its
// zoom ramp a frame later. Record the spec and nothing else, and the first
// un-mute restores the field to invisible — 2,240 pins gone, from a gesture
// whose entire promise is that it puts everything back.
{
  const map = makeMap();
  addLayer(map, {
    id: "hotel-dots", type: "circle", source: "s",
    paint: { "circle-opacity": 0, "circle-stroke-opacity": 0 }, // the fade-in
  });
  restPaint(map, "hotel-dots", "circle-opacity", RAMP);         // …and its rest
  restPaint(map, "hotel-dots", "circle-stroke-opacity", 1);
  dimLayer(map, "hotel-dots", true);
  dimLayer(map, "hotel-dots", false);
  checks.push([
    "a faded-in layer restores to its resting ramp, not to the 0 it started at",
    eq(map.getLayer("hotel-dots").paint["circle-opacity"], RAMP),
    JSON.stringify(map.getLayer("hotel-dots").paint["circle-opacity"]).slice(0, 48),
  ]);
}

// ── 7. Muting a layer that has gone is survivable ───────────────────────────
// A restyle drops every layer we own between the legend click and the repaint.
{
  const map = makeMap();
  addLayer(map, { id: "t_jet_dot", type: "circle", source: "s", paint: { "circle-opacity": 1 } });
  map.layers.clear();
  let threw = false;
  try { dimLayer(map, "t_jet_dot", true); } catch { threw = true; }
  checks.push([
    "a mute during a restyle is a no-op, not a crash",
    !threw,
    "survived",
  ]);
}

// ── 8. The pulse is gated, and gated on what actually arrived ───────────────
// Read off the source rather than re-run: the gate lives inside the map
// closure, but the shape of it — a cap compared against the fetched feed, and
// a reduced-motion bail — is exactly what a regression would drop.
{
  const start = between("function startSoloPulse(key: string)", "\n        }\n");
  checks.push([
    "the pulse declines when a feed is too dense to ring",
    /feats\.length > SOLO_PULSE_MAX_PINS/.test(start),
    /SOLO_PULSE_MAX_PINS/.test(start) ? "capped on the arrived feed" : "NO CAP",
  ]);
  checks.push([
    "…and declines entirely under prefers-reduced-motion",
    /prefers-reduced-motion/.test(start),
    "honoured",
  ]);
  const stop = between("function stopSoloPulse()", "function startSoloPulse");
  checks.push([
    "stopping the pulse removes its ring and hands the glow back",
    /removeLayer/.test(stop) && /dimLayer\(/.test(stop),
    "ring removed, glow restored",
  ]);
}

console.log("\nLegend focus\n");
let bad = false;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? " ok  " : "FAIL "} ${name}  (${detail})`);
  if (!ok) bad = true;
}
rmSync(OUT, { recursive: true, force: true });
console.log(bad ? "\nFAILED\n" : `\nFocus mutes to ${MUTE} and puts everything back\n`);
process.exit(bad ? 1 : 0);

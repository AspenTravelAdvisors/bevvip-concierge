/**
 * Does a route get framed the same way wherever on the globe it is?
 *
 * The atlas fits a route by arithmetic — how many pixels does this span of
 * degrees cover, and what zoom makes that the size of the box — and that
 * arithmetic was mercator's, whatever projection was on screen. Near the
 * equator the two agree and nobody noticed for a year. At 78°N they do not:
 * mercator stretches latitude toward the poles, so a Svalbard voyage of 19°
 * by 20° measured as a route no zoom could hold, landed on minZoom, and was
 * then read from 40°N by a polar guard that correctly saw a whole-globe
 * framing. The itinerary drew at 4% of the frame's width. The same span on the
 * Amazon framed perfectly — which is what made it read as "the routes go small
 * the further north they are" rather than as a broken map.
 *
 * This file is the ground truth for the arithmetic that replaced it. Every
 * expectation below was MEASURED, by loading mapbox-gl 3.7.0 in a real browser
 * over an empty style and asking the live transform where things land:
 *
 *   - `map.project()` two points a twentieth of a degree apart, at the centre
 *     of the frame, for the scale a degree actually gets;
 *   - `map.project()` the corners of a span, for the pixels it actually covers;
 *   - `map.project([0, 89.9])` for whether the pole is actually on screen.
 *
 * The browser is not here — this sandbox cannot reach api.mapbox.com and CI
 * has no GPU — so the measurements are baked in as a table rather than re-run.
 * They are properties of mapbox's globe at a pinned version (see
 * lib/mapbox-cdn.ts), not of this repo, so they change when that version does:
 * if this file starts failing after a mapbox bump, re-measure before retuning.
 *
 *   node scripts/verify-route-framing.mjs
 */

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = mkdtempSync(join(tmpdir(), "framing-"));
const SRC = readFileSync(join(ROOT, "components/AtlasShell.tsx"), "utf8");

// ── Slice the real thing, the way verify-route-flight does ──────────────────
function between(open, close) {
  const a = SRC.indexOf(open);
  const b = SRC.indexOf(close, a + 1);
  if (a < 0 || b < 0) {
    throw new Error(`verify-route-framing: anchor moved — could not find ${a < 0 ? open : close}`);
  }
  return SRC.slice(a, b);
}
const body = between(
  "        /** The bounding box of some geometry, in its own unrolled frame. */",
  "        function markFocusPlace",
);
const constDecls = [
  "SPAN_FLAT_LNG", "SPAN_FLAT_LAT", "FLY_ARRIVE_MS", "FLY_SETTLE_MS",
  "FLY_DWELL_MS", "FLY_LEG_BASE_MS", "FLY_LEG_PER_ZOOM_MS", "FLY_LEG_MIN_MS",
  "FLY_LEG_MAX_MS", "FLY_VOYAGE_MS", "FLY_MAX_CALLS", "FLY_STOP_ZOOM_MIN",
  "FLY_STOP_ZOOM_MAX", "FLY_CRUISE_PAD", "FLY_MIN_CLIMB", "FLY_PACE",
  "FLY_PAN_MIN_MS", "FLY_RAMP", "FLY_PITCH", "FLY_CRUISE_PITCH",
  "FLY_FULL_CLIMB", "FLY_MAX_LAT", "FLY_WEEK_DAYS", "FLY_MAX_WEEKS",
  "FLY_WEEK_CLIMB", "FLY_SAMPLES", "FLY_SMOOTH", "FLY_SMOOTH_MAX",
];
const decls = constDecls
  .map((name) => {
    const m = new RegExp(`^\\s*const ${name} = [\\d.]+;(?:\\s*//.*)?$`, "m").exec(SRC);
    if (!m) throw new Error(`verify-route-framing: ${name} moved or changed shape`);
    return m[0].trim().replace(/\s*\/\/.*$/, "");
  })
  .join("\n");
const FS_NOW_NONE_DECL = /^const FS_NOW_NONE.*$/m.exec(SRC);
if (!FS_NOW_NONE_DECL) throw new Error("verify-route-framing: FS_NOW_NONE moved");

const DEPS = [
  "node", "map", "mapboxgl", "escapeHtml", "addLayer", "fitPad", "stopSpin", "type",
  "setAmbientMuted", "setIs3D", "setTilted", "setFlyingRoute", "setHasRoute",
  "lastFocusLegs", "lastFocusStops", "flyingRef", "stopPopup", "stopPinned",
  "window", "performance", "requestAnimationFrame", "cancelAnimationFrame", "clearTimeout",
];

writeFileSync(
  join(OUT, "framing.ts"),
  `/* eslint-disable */\n` +
    `type MapboxModule = any;\n` +
    `${FS_NOW_NONE_DECL[0].replace(": unknown[]", ": any")}\n${decls}\n` +
    `export function makeFraming(dep: any) {\n` +
    `  const { ${DEPS.join(", ")} } = dep;\n` +
    `  const routePalette: () => any = dep.routePalette;\n` +
    `  let projGlobe: boolean = dep.projGlobe;\n` +
    `${body}\n` +
    `  return { spanOf, spanPixels, globeScale, globeHalfFrame, halfFrameLat,\n` +
    `    framingLat, fitZoom, zoomToFitBox, mercatorFitZoom, canFrameFlat, frameSpan };\n` +
    `}\n`,
);

execFileSync("npx", [
  "tsc", join(OUT, "framing.ts"),
  "--outDir", OUT, "--module", "esnext", "--target", "es2022",
  "--moduleResolution", "bundler", "--skipLibCheck",
], { cwd: ROOT, stdio: "inherit" });

const { makeFraming } = await import(pathToFileURL(join(OUT, "framing.js")).href);

// ── A fake map, which is all the arithmetic needs ───────────────────────────
function framing(box, { projGlobe = true, pad = 78 } = {}) {
  const camera = { center: [0, 0], zoom: 1.25 };
  const writes = [];
  const map = {
    getMinZoom: () => 0.6,
    getZoom: () => camera.zoom,
    getPitch: () => 0,
    getBearing: () => 0,
    getCenter: () => ({ lng: camera.center[0], lat: camera.center[1] }),
    getLayer: () => true,
    addLayer: () => {},
    addSource: () => {},
    getSource: () => ({ setData: () => {} }),
    setPaintProperty: () => {},
    setFilter: () => {},
    setProjection: () => {},
    flyTo: (o) => writes.push(o),
    jumpTo: () => {},
    easeTo: (o) => writes.push(o),
    fitBounds: () => {},
  };
  const api = makeFraming({
    node: { clientWidth: box.w, clientHeight: box.h },
    map,
    mapboxgl: { LngLatBounds: class { extend() {} } },
    escapeHtml: (s) => s,
    addLayer: () => {},
    fitPad: () => pad,
    type: "cruise",
    stopSpin: () => {},
    setAmbientMuted: () => {},
    setIs3D: () => {},
    setTilted: () => {},
    setFlyingRoute: () => {},
    setHasRoute: () => {},
    projGlobe,
    routePalette: () => ({}),
    lastFocusLegs: { current: [] },
    lastFocusStops: { current: [] },
    flyingRef: { current: false },
    stopPopup: { setLngLat() { return this; }, setHTML() { return this; }, addTo() { return this; }, remove() {} },
    stopPinned: false,
    window: { setTimeout: () => 1 },
    performance: { now: () => 0 },
    requestAnimationFrame: (fn) => { fn(0); return 1; },
    cancelAnimationFrame: () => {},
    clearTimeout: () => {},
  });
  return { api, writes, box };
}

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`   ok   ${label}${detail ? `  (${detail})` : ""}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`); }
}

const PHONE = { w: 348, h: 340 };   // the phone's split map band
const DESKTOP = { w: 1100, h: 760 }; // a collection page on a laptop

/* ── 1. A degree of the globe is not a degree of mercator ────────────────────
 *
 * MEASURED on a 1100x760 globe: pixels per degree at the centre of the frame,
 * as a multiple of mercator's own at the same zoom. Longitude and latitude
 * share the ratio — both projections are conformal, so their difference at a
 * point is one number — and it is 1 above the blend band, which is why routes
 * that fit at zoom 5 and closer were never framed wrongly.
 */
{
  const { api } = framing(DESKTOP);
  const merc = (lat) => 1 / Math.cos((lat * Math.PI) / 180); // mercator's own stretch
  const MEASURED = [
    // zoom, lat, measured globe:mercator ratio
    [2, 0, 1.414], [2, 45, 1.0], [2, 57, 0.770], [2, 78, 0.294],
    [3, 0, 1.414], [3, 45, 1.0], [3, 57, 0.770], [3, 78, 0.294],
    [4, 0, 1.207], [4, 45, 1.0], [4, 57, 0.885], [4, 78, 0.647],
    [5, 0, 1.0], [5, 45, 1.0], [5, 57, 1.0], [5, 78, 1.0],
    [7, 0, 1.0], [7, 45, 1.0], [7, 57, 1.0], [7, 78, 1.0],
  ];
  const worst = MEASURED.reduce((acc, [zoom, lat, want]) => {
    const got = api.globeScale(lat, zoom) / merc(lat);
    return Math.max(acc, Math.abs(got / want - 1));
  }, 0);
  check("globe scale matches the projection mapbox actually draws",
    worst < 0.02, `worst ${(worst * 100).toFixed(1)}% off across 20 measured points`);
}

/* ── 2. A span covers the pixels it is measured to cover ─────────────────────
 *
 * MEASURED: project the corners of a span and take the bounding box. Only
 * spans near the size of the box are listed, because that is the only case a
 * fit ever asks about — a span many times the viewport runs off round the limb,
 * where a flat measure of a sphere stops meaning anything and the flatten gate
 * takes over.
 */
{
  const cases = [
    // box, span, zoom, measured w x h
    [PHONE, { lo: 0, hi: 19.2, latLo: 58.0, latHi: 78.3 }, 1, [40, 81]],
    [PHONE, { lo: 0, hi: 19.2, latLo: 58.0, latHi: 78.3 }, 2, [94, 188]],
    [PHONE, { lo: 0, hi: 48.3, latLo: 64.2, latHi: 79.0 }, 2, [198, 154]],
    [PHONE, { lo: 0, hi: 3.7, latLo: 56.1, latHi: 58.5 }, 4, [87, 101]],
    [PHONE, { lo: 0, hi: 3.8, latLo: -12.1, latHi: -3.7 }, 3, [46, 101]],
    [DESKTOP, { lo: 0, hi: 19.2, latLo: 58.0, latHi: 78.3 }, 3, [161, 323]],
    [DESKTOP, { lo: 0, hi: 48.3, latLo: 64.2, latHi: 79.0 }, 3, [323, 250]],
    [DESKTOP, { lo: 0, hi: 3.8, latLo: -12.1, latHi: -3.7 }, 5, [173, 383]],
    [DESKTOP, { lo: 0, hi: 40, latLo: -8, latHi: 8 }, 2, [308, 128]],
  ];
  let worst = 0;
  let where = "";
  for (const [box, span, zoom, [w, h]] of cases) {
    const { api } = framing(box);
    const px = api.spanPixels(span, zoom);
    const err = Math.max(Math.abs(px.w / w - 1), Math.abs(px.h / h - 1));
    if (err > worst) { worst = err; where = `${span.latLo}..${span.latHi}° at zoom ${zoom}`; }
  }
  check("a span is measured at the size it actually draws",
    worst < 0.11, `worst ${(worst * 100).toFixed(0)}% (${where}) over 9 measured spans`);

  // …and the error that remains is the safe one: a sphere curves away from the
  // centre, so a span reaching the edge draws SMALLER than a flat measure of
  // it. Over-measuring leaves the route inside its frame; under-measuring runs
  // it off the edge, which is the failure this file exists to prevent.
  const { api } = framing(DESKTOP);
  const wide = { lo: 0, hi: 40, latLo: -8, latHi: 8 };
  check("…and what error is left leaves the route inside the frame",
    api.spanPixels(wide, 2).w >= 308,
    `${api.spanPixels(wide, 2).w.toFixed(0)}px measured against 308px drawn`);
}

/* ── 3. The polar guard fires on the frames the pole is really in ────────────
 *
 * MEASURED by projecting [0, 89.9] and asking whether it lands on screen.
 */
{
  const cases = [
    // box, centre latitude, zoom, is the pole on screen?
    [PHONE, 50, 2, false], [PHONE, 50, 3, false],
    [PHONE, 68, 1.5, true], [PHONE, 68, 2, false], [PHONE, 68, 3, false],
    [PHONE, 78, 1.5, true], [PHONE, 78, 2, true], [PHONE, 78, 3, false],
    [DESKTOP, 50, 3, false], [DESKTOP, 68, 3, true], [DESKTOP, 68, 4, false],
    [DESKTOP, 78, 3, true], [DESKTOP, 78, 4, false],
  ];
  const wrong = cases.filter(([box, lat, zoom, poleIn]) => {
    const { api } = framing(box);
    // The guard's own question: does the frame reach the pole from here?
    return lat + api.halfFrameLat(lat, zoom) >= 90 !== poleIn;
  });
  check("the frame knows which pictures the pole is in",
    wrong.length === 0,
    wrong.length ? wrong.map((c) => `${c[1]}° z${c[2]}`).join(", ") : "13 measured frames");
}

/* ── 4. The report itself: an Arctic route is framed like an equatorial one ──
 *
 * The two itineraries named in the bug, at their shipped spans. Both are a
 * regional voyage; neither should be a dot on a globe. The floor is expressed
 * against the box the fit is allowed to use — full box less the padding a
 * framing always leaves — because that, not the whole viewport, is what a fit
 * is trying to fill.
 */
{
  const SPANS = {
    "Svalbard (78°N)": { lo: 0, hi: 19.2, latLo: 58.0, latHi: 78.3 },
    "Amazon (4°S)": { lo: 0, hi: 3.8, latLo: -12.1, latHi: -3.7 },
    "Alaska (57°N)": { lo: 0, hi: 3.7, latLo: 56.1, latHi: 58.5 },
  };
  for (const [box, name] of [[DESKTOP, "desktop"], [PHONE, "phone"]]) {
    const usable = { w: box.w - 156, h: box.h - 156 };
    for (const [label, span] of Object.entries(SPANS)) {
      const { api, writes } = framing(box);
      api.frameSpan(span, { duration: 900 });
      const cam = writes[writes.length - 1];
      const px = api.spanPixels(span, cam.zoom);
      const fill = Math.max(px.w / usable.w, px.h / usable.h);
      check(`${label} fills the frame it is given, on a ${box === PHONE ? "phone" : "desktop"}`,
        fill >= 0.5, `${(fill * 100).toFixed(0)}% of the usable box at zoom ${cam.zoom.toFixed(2)}`);
    }
  }
}

/* ── 5. …and the flatten gate still asks mercator's question ─────────────────
 *
 * canFrameFlat exists to decide whether to LEAVE the globe, so it is the one
 * caller that must keep measuring in mercator however round the world is now.
 */
{
  const world = { lo: -180, hi: 180, latLo: -50, latHi: 60 };
  const { api: phone } = framing(PHONE);
  const { api: desktop } = framing(DESKTOP);
  check("a phone cannot hold a world route flat either, so it keeps the globe",
    !phone.canFrameFlat(world));
  check("…and a desktop can, so it flattens", desktop.canFrameFlat(world));
  const onGlobe = desktop.mercatorFitZoom(world, 944, 604);
  const onFlat = framing(DESKTOP, { projGlobe: false }).api.mercatorFitZoom(world, 944, 604);
  check("the flatten gate answers in mercator, not in whatever is on screen",
    onGlobe === onFlat, `zoom ${onGlobe.toFixed(3)} either way`);
}

console.log("");
if (failures) {
  console.log(`${failures} framing check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("A route is framed the same way wherever on the globe it is");

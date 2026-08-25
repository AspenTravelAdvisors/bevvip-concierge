/**
 * The route flight: does it actually fly the itinerary, and give the map back?
 *
 * A round-the-world itinerary does not fit on a phone at any zoom in either
 * projection (see the FLY_* constants in AtlasShell.tsx for the arithmetic), so
 * the atlas stops trying to frame one and flies it instead: the camera drops
 * onto the first call, tilts, follows the route in travel order naming each
 * call as it passes, and pulls back at the end.
 *
 * That makes it the second thing in the atlas that drives the camera on a timer
 * — the ambient tour is the first, and verify-ambient-tour.mjs exists for the
 * same reason this does. Three properties are invisible to the type checker and
 * miserable to check by hand:
 *
 *   1. It flies the ROUTE. Legs arrive deduplicated, unordered and split across
 *      longitude frames (see lib/atlas/route-frame.ts); if the flight ever gets
 *      raw geometry instead of the framed chain, the camera crosses the Pacific
 *      four times and nobody notices until it is on a screen recording.
 *
 *   2. It stays inside the reel. The whole brief is "a few routes in one reel",
 *      which is a hard budget: retuning the pace by eye is how a nine-second
 *      pass quietly becomes a twenty-second one.
 *
 *   3. It gives everything back. The flight borrows the camera, dims the route,
 *      draws a trail and lights a call. An interruption is someone's hand on
 *      the globe, and every one of those has to be returned without the camera
 *      answering by easing somewhere else.
 *
 * And one decision underneath all of it: when to flatten. Flattening a wide
 * route is right on a desktop and wrong on a phone, where mercator's own floor
 * cannot hold the route either — that gate is pixels, not breakpoints, so it is
 * checked here at both sizes.
 *
 * Rather than restate the logic, this slices the real framing-and-flight block
 * out of AtlasShell.tsx, compiles it, and runs it against a fake map and a fake
 * clock.
 *
 *   node scripts/verify-route-flight.mjs
 */

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = mkdtempSync(join(tmpdir(), "flight-"));
const SRC = readFileSync(join(ROOT, "components/AtlasShell.tsx"), "utf8");

// ── Slice the real thing ────────────────────────────────────────────────────
function between(open, close) {
  const a = SRC.indexOf(open);
  const b = SRC.indexOf(close, a + 1);
  if (a < 0 || b < 0) {
    throw new Error(`verify-route-flight: anchor moved — could not find ${a < 0 ? open : close}`);
  }
  return SRC.slice(a, b);
}

// From the span helpers (which the flatten gate is built on) to the end of the
// flight. One slice, because the two are one decision: what a viewport can
// frame is exactly what decides whether flying it is the only answer left.
const body = between(
  "        /** The bounding box of some geometry, in its own unrolled frame. */",
  "        function markFocusPlace",
);

const constDecls = [
  "SPAN_FLAT_LNG", "SPAN_FLAT_LAT", "FLY_PACE", "FLY_TARGET_MS", "FLY_MIN_MS",
  "FLY_MAX_MS", "FLY_ARRIVE_MS", "FLY_SETTLE_MS", "FLY_WINDOW_MIN",
  "FLY_WINDOW_MAX", "FLY_PITCH", "FLY_RAMP", "FLY_SAMPLES", "FLY_MAX_LAT",
  "FLY_LABEL_MS",
];
// SPAN_FLAT_* live inside the map effect and the FLY_* ones at module scope, so
// each is grabbed by name rather than by a range that would swallow the file.
const decls = constDecls
  .map((name) => {
    const m = new RegExp(`^\\s*const ${name} = [\\d.]+;$`, "m").exec(SRC);
    if (!m) throw new Error(`verify-route-flight: ${name} moved or changed shape`);
    return m[0].trim();
  })
  .join("\n");
const K = Object.fromEntries(
  constDecls.map((n) => [n, Number(new RegExp(`^\\s*const ${n} = ([\\d.]+);$`, "m").exec(SRC)[1])]),
);
const FS_NOW_NONE_DECL = /^const FS_NOW_NONE.*$/m.exec(SRC);
if (!FS_NOW_NONE_DECL) throw new Error("verify-route-flight: FS_NOW_NONE moved");

const DEPS = [
  "node", "map", "mapboxgl", "escapeHtml", "addLayer", "fitPad", "stopSpin",
  "setAmbientMuted", "setIs3D", "setTilted", "setFlyingRoute", "setHasRoute",
  "lastFocusLegs", "lastFocusStops", "flyingRef", "stopPopup", "stopPinned",
  "window", "performance", "requestAnimationFrame", "cancelAnimationFrame",
  "clearTimeout",
];

writeFileSync(
  join(OUT, "flight.ts"),
  `/* eslint-disable */\n` +
    `type MapboxModule = any;\n` +
    `${FS_NOW_NONE_DECL[0].replace(": unknown[]", ": any")}\n${decls}\n` +
    `export function makeFlight(dep: any) {\n` +
    `  const { ${DEPS.join(", ")} } = dep;\n` +
    `  const routePalette: () => any = dep.routePalette;\n` +
    `  let projGlobe: boolean = dep.projGlobe;\n` +
    `${body}\n` +
    `  return { flyRoute, endFlight, flattenIfCircumnavigation, canFrameFlat, spanOf,\n` +
    `    state: () => ({ projGlobe, flying: flyingRef.current }) };\n` +
    `}\n`,
);

execFileSync("npx", [
  "tsc", join(OUT, "flight.ts"),
  "--outDir", OUT, "--module", "esnext", "--target", "es2022",
  "--moduleResolution", "bundler", "--skipLibCheck",
], { cwd: ROOT, stdio: "inherit" });

const { makeFlight } = await import(pathToFileURL(join(OUT, "flight.js")).href);

// ── Itineraries ─────────────────────────────────────────────────────────────
/** Straight legs between stops, unrolled — what paintFocusRoute leaves behind. */
function route(stops) {
  const legs = [];
  for (let i = 1; i < stops.length; i++) {
    const [aLng, aLat] = stops[i - 1].at;
    const [bLng, bLat] = stops[i].at;
    const coords = [];
    for (let k = 0; k <= 24; k++) {
      coords.push([aLng + ((bLng - aLng) * k) / 24, aLat + ((bLat - aLat) * k) / 24]);
    }
    legs.push({ mode: "primary", coordinates: coords });
  }
  return legs;
}
const stopsOf = (pairs) => pairs.map(([name, lng, lat], i) => ({ name, at: [lng, lat], day: i * 3 + 1 }));

// A real round-the-world jet itinerary, unrolled eastward past +180 the way
// route-frame.ts leaves it: Seattle → … → Seattle, one continuous frame.
const RTW = stopsOf([
  ["Seattle", -122.3, 47.6], ["Kyoto", 135.8 - 360, 35.0], ["Ulaanbaatar", 106.9 - 360, 47.9],
  ["Kathmandu", 85.3 - 360, 27.7], ["Agra", 78.0 - 360, 27.2], ["Serengeti", 34.8 - 360, -2.3],
  ["Marrakesh", -8.0 - 360, 31.6], ["Seville", -6.0 - 360, 37.4], ["Seattle", -122.3 - 360, 47.6],
]);
// …and a regional one that any viewport can frame.
const MED = stopsOf([
  ["Nice", 7.3, 43.7], ["Rome", 12.5, 41.9], ["Athens", 23.7, 38.0], ["Istanbul", 29.0, 41.0],
]);

// ── A fake map and a fake clock ─────────────────────────────────────────────
function harness(opts = {}) {
  const box = opts.box ?? { w: 348, h: 340 }; // the phone's map band
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const log = [];
  const camera = { center: [0, 0], zoom: 1.25, pitch: 0, bearing: 0 };
  /** Every camera position the flight actually wrote, in order. */
  const track = [];
  const paint = new Map();
  const filters = new Map();
  const sources = new Map();
  const layers = new Set(["fr_rail", "fr_ties", "fr_arrow", "fs_dot", "fs_now"]);
  const labels = [];
  let frames = [];

  const setTimeout_ = (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; };
  const clearTimeout_ = (id) => timers.delete(id);

  const map = {
    getMinZoom: () => 0.6,
    getZoom: () => camera.zoom,
    getPitch: () => camera.pitch,
    getBearing: () => camera.bearing,
    getCenter: () => ({ lng: camera.center[0], lat: camera.center[1] }),
    getLayer: (id) => layers.has(id),
    addLayer: (spec) => layers.add(spec.id),
    addSource: (id, s) => sources.set(id, s.data),
    getSource: (id) => (sources.has(id) ? { setData: (d) => sources.set(id, d) } : undefined),
    setPaintProperty: (id, prop, val) => paint.set(`${id}.${prop}`, val),
    setFilter: (id, f) => filters.set(id, JSON.stringify(f)),
    setProjection: (name) => log.push(`projection ${name}`),
    flyTo: (o) => {
      camera.center = [...o.center]; camera.zoom = o.zoom;
      camera.pitch = o.pitch ?? camera.pitch; camera.bearing = o.bearing ?? camera.bearing;
      log.push("flyTo"); track.push({ t: now, at: [...o.center] });
    },
    jumpTo: (o) => {
      camera.center = [...o.center]; camera.zoom = o.zoom ?? camera.zoom;
      camera.pitch = o.pitch ?? camera.pitch; camera.bearing = o.bearing ?? camera.bearing;
      track.push({ t: now, at: [...o.center], bearing: o.bearing });
    },
    easeTo: (o) => {
      if (o.center) camera.center = [...o.center];
      camera.zoom = o.zoom ?? camera.zoom;
      camera.pitch = o.pitch ?? camera.pitch; camera.bearing = o.bearing ?? camera.bearing;
      log.push("easeTo");
    },
    fitBounds: (b, o) => {
      camera.pitch = o.pitch ?? camera.pitch; camera.bearing = o.bearing ?? camera.bearing;
      log.push("fitBounds");
    },
  };

  const flyingRef = { current: false };
  const api = makeFlight({
    node: { clientWidth: box.w, clientHeight: box.h },
    map,
    mapboxgl: { LngLatBounds: class { extend() {} } },
    escapeHtml: (s) => s,
    addLayer: (m, spec) => m.addLayer(spec),
    fitPad: () => 78,
    stopSpin: () => { log.push("stopSpin"); api.endFlight(); },
    setAmbientMuted: (on) => log.push(`mute ${on}`),
    setIs3D: () => {},
    setTilted: (on) => log.push(`tilted ${on}`),
    setFlyingRoute: () => {},
    setHasRoute: () => {},
    projGlobe: opts.projGlobe !== false,
    routePalette: () => ({
      casing: "#000", casingW: 3, casingO: 0.3, line: "#c9a84c", lineW: 2, lineO: 0.92,
      tie: "#e8d9a0", tieO: 0.8, conn: "#c9a84c", connO: 0.6, connW: 1.4,
    }),
    lastFocusLegs: { current: opts.legs ?? [] },
    lastFocusStops: { current: opts.stops ?? [] },
    flyingRef,
    stopPopup: {
      setLngLat(at) { this._at = at; return this; },
      setHTML(h) { labels.push(/>([^<]*)<\/div><\/div>/.exec(h)[1]); return this; },
      addTo() { log.push("label"); return this; },
      remove() { log.push("label off"); },
    },
    stopPinned: false,
    window: { setTimeout: setTimeout_ },
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => { frames = []; },
    clearTimeout: clearTimeout_,
  });

  return {
    api, log, camera, track, labels, paint, filters, flyingRef,
    trail: () => {
      const d = sources.get("fly-trail");
      return d?.features?.[0]?.geometry?.coordinates ?? [];
    },
    pending: () => timers.size,
    /** Advance the clock, firing timers and one animation frame per 16ms. */
    tick(ms) {
      const end = now + ms;
      while (now < end) {
        const step = Math.min(16, end - now);
        now += step;
        for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
        const due = frames; frames = [];
        for (const fn of due) fn(now);
      }
      now = end;
    },
    at: () => now,
  };
}

// ── Scenarios ───────────────────────────────────────────────────────────────
const results = [];
const check = (name, cond, detail = "") => results.push([name, !!cond, detail]);
const RUN = 30000;

const flat = (legs) => legs.flatMap((l) => l.coordinates);
/** Distance in degrees, longitude scaled by latitude — the flight's own metric. */
const dist = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), a[1] - b[1]);

{
  // A full circumnavigation, on the phone band that started all this.
  const legs = route(RTW);
  const h = harness({ legs, stops: RTW });
  h.api.flyRoute();
  h.tick(RUN);

  const path = flat(legs);
  const total = path.slice(1).reduce((s, p, i) => s + dist(path[i], p), 0);
  const track = h.track;

  // Follows the route: every camera position sits on the itinerary, and the
  // distance travelled along it only ever increases.
  let offRoute = 0, backwards = 0, lastProgress = -1;
  for (const { at } of track) {
    let best = Infinity, bestI = 0;
    for (let i = 0; i < path.length; i++) {
      const d = dist(at, path[i]);
      if (d < best) { best = d; bestI = i; }
    }
    if (best > 6) offRoute++;
    if (bestI < lastProgress - 2) backwards++;
    lastProgress = Math.max(lastProgress, bestI);
  }
  check("flies the itinerary itself, not a bounding box", offRoute === 0,
    `${track.length} camera writes, ${offRoute} off route`);
  check("…forwards, in travel order", backwards === 0, `${backwards} steps back`);
  check("…starting at the first call", dist(track[0].at, path[0]) < 3);
  check("…and reaching the last", dist(track[track.length - 1].at, path[path.length - 1]) < 6);

  // The reel budget.
  const done = h.log.lastIndexOf("easeTo") >= 0 || h.log.lastIndexOf("fitBounds") >= 0;
  const travel = track[track.length - 1].t - track[0].t;
  check("fits the reel: a circumnavigation inside ten seconds",
    done && travel + K.FLY_ARRIVE_MS + K.FLY_SETTLE_MS <= 10600,
    `${Math.round(travel)}ms of travel + ${K.FLY_ARRIVE_MS} arrive + ${K.FLY_SETTLE_MS} settle`);
  check("…and long enough to read as travel", travel >= K.FLY_MIN_MS);

  // Pace: never more than about one frame-width of ground per second, which is
  // the whole reason altitude is chosen from the route's length.
  const win = Math.max(K.FLY_WINDOW_MIN, Math.min(K.FLY_WINDOW_MAX, total / ((K.FLY_TARGET_MS / 1000) * K.FLY_PACE)));
  let fastest = 0;
  for (let i = 1; i < track.length; i++) {
    const dt = (track[i].t - track[i - 1].t) / 1000;
    if (dt > 0) fastest = Math.max(fastest, dist(track[i - 1].at, track[i].at) / dt);
  }
  // The cruise is flat, so the peak is only the ramp's overshoot — about
  // 1/(1-FLY_RAMP) of the average. An ease-in-out peaked at twice it, which at
  // this frame width is two and a half screens a second: a whip pan.
  const budget = K.FLY_PACE * win * (1 / (1 - K.FLY_RAMP)) * 1.12;
  check("holds a watchable pace at the altitude it picked",
    fastest <= budget,
    `${fastest.toFixed(0)}°/s peak vs ${budget.toFixed(0)}°/s allowed, frame ${win.toFixed(0)}° wide`);

  // The calls.
  check("names every call, in order, once",
    h.labels.length === RTW.length &&
      h.labels.every((l, i) => l.startsWith(`${i + 1}. Day ${RTW[i].day} · ${RTW[i].name}`)),
    h.labels.join(" → "));


  // The landing has to be the last word. An earlier version put the pitch back
  // in the flight's own teardown, which runs one tick after the settle is
  // issued — a second camera command in the same breath, cancelling the
  // pull-back it was meant to follow.
  const moves = h.log.filter((l) => ["flyTo", "easeTo", "fitBounds"].includes(l));
  check("the landing is the last camera command, not the second to last",
    moves.length === 2 && moves[0] === "flyTo" && moves[1] !== "flyTo",
    moves.join(" → "));
  check("tilts hard on the way in, and levels out at the end",
    h.log.indexOf("tilted true") >= 0 && h.log.lastIndexOf("tilted false") > h.log.indexOf("tilted true") &&
      h.camera.pitch === 0);
  check("hands the route back at full strength", h.paint.get("fr_rail.line-opacity") === 0.92);
  check("leaves nothing lit", h.filters.get("fs_now") === JSON.stringify(["==", ["get", "n"], "—"]));
  check("leaves no timer or frame running", h.pending() === 0 && !h.flyingRef.current);
}

{
  // The trail, which only exists while the flight does: it is cleared on the
  // way out, because by then the route itself is back at full strength and a
  // second copy of it under the first is just a heavier line.
  const legs = route(RTW);
  const h = harness({ legs, stops: RTW });
  h.api.flyRoute();
  h.tick(K.FLY_ARRIVE_MS + 3000);
  const mid = h.trail();
  const camera = [...h.camera.center];
  h.tick(RUN);
  check("the trail grows behind the camera, not ahead of it",
    mid.length > 1 && dist(mid[mid.length - 1], camera) < 2,
    `${mid.length} points, ${dist(mid[mid.length - 1], camera).toFixed(1)}° behind`);
  check("…and is put away once the route is back at full strength", h.trail().length === 0);
}

{
  // Interruption: a hand on the globe, half way round.
  const legs = route(RTW);
  const h = harness({ legs, stops: RTW });
  h.api.flyRoute();
  h.tick(4000);
  const where = [...h.camera.center];
  const flownTo = h.track.length;
  h.api.endFlight();
  h.tick(RUN);
  check("an interruption stops the camera where it is",
    h.track.length === flownTo && h.camera.center[0] === where[0] && h.camera.center[1] === where[1],
    "no answering ease");
  check("…gives the route its opacity back", h.paint.get("fr_rail.line-opacity") === 0.92);
  check("…empties the trail", h.trail().length === 0);
  check("…puts the call label away", h.log.lastIndexOf("label off") > h.log.lastIndexOf("label"));
  check("…leaves the tilt where it was caught, rather than levelling uninvited",
    h.camera.pitch === K.FLY_PITCH, `pitch ${h.camera.pitch}`);
  check("…and ends the flight", !h.flyingRef.current && h.pending() === 0);
}

{
  // Interrupted during the drop-in, before the travel starts.
  const h = harness({ legs: route(RTW), stops: RTW });
  h.api.flyRoute();
  h.tick(K.FLY_ARRIVE_MS / 2);
  const before = h.track.length;
  h.api.endFlight();
  h.tick(RUN);
  check("an interruption during the arrival cancels the flight outright",
    h.track.length === before && !h.flyingRef.current, `${h.track.length - before} extra writes`);
}

{
  // A regional route: same machinery, flown low and close.
  const legs = route(MED);
  const h = harness({ legs, stops: MED });
  h.api.flyRoute();
  h.tick(RUN);
  const travel = h.track[h.track.length - 1].t - h.track[0].t;
  check("a regional route still gets a real flight, not a twitch", travel >= K.FLY_MIN_MS,
    `${Math.round(travel)}ms`);
  check("…flown closer than a circumnavigation", h.camera.zoom > 3,
    `zoom ${h.camera.zoom.toFixed(2)}`);
  check("…and framed at the end rather than left on the last stop",
    h.log.includes("fitBounds"));
}

{
  // Nothing traced: the Fly control must be inert rather than throw.
  const h = harness({ legs: [], stops: [] });
  h.api.flyRoute();
  h.tick(RUN);
  check("nothing traced, nothing flown", h.track.length === 0 && !h.flyingRef.current);
}

{
  // The flatten gate, in pixels.
  const wide = [{ coordinates: flat(route(RTW)) }];
  const phone = harness({ legs: route(RTW), stops: RTW });
  const desk = harness({ legs: route(RTW), stops: RTW, box: { w: 1180, h: 700 } });
  check("a phone band keeps the globe: flat cannot hold a world route either",
    phone.api.flattenIfCircumnavigation(wide) === false && phone.api.state().projGlobe === true);
  check("a desktop map still flattens one — there, flat CAN hold it",
    desk.api.flattenIfCircumnavigation(wide) === true && desk.api.state().projGlobe === false);
  const regional = [{ coordinates: flat(route(MED)) }];
  check("a regional route is never flattened, at either size",
    harness({ box: { w: 348, h: 340 } }).api.flattenIfCircumnavigation(regional) === false &&
      harness({ box: { w: 1180, h: 700 } }).api.flattenIfCircumnavigation(regional) === false);
  check("a flight puts a flattened map back on the globe",
    (() => {
      const h = harness({ legs: route(RTW), stops: RTW, projGlobe: false });
      h.api.flyRoute();
      return h.log.includes("projection globe");
    })());
}

rmSync(OUT, { recursive: true, force: true });

console.log("\nRoute flight\n");
let bad = false;
for (const [name, ok, detail] of results) {
  console.log(`  ${ok ? " ok  " : "FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) bad = true;
}
console.log(bad ? "\nFAILED\n" : "\nThe flight follows the route, fits the reel, and gives the map back\n");
process.exit(bad ? 1 : 0);

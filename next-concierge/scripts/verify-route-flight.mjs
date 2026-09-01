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
  "SPAN_FLAT_LNG", "SPAN_FLAT_LAT", "FLY_ARRIVE_MS", "FLY_SETTLE_MS",
  "FLY_DWELL_MS", "FLY_LEG_BASE_MS", "FLY_LEG_PER_ZOOM_MS", "FLY_LEG_MIN_MS",
  "FLY_LEG_MAX_MS", "FLY_VOYAGE_MS", "FLY_MAX_CALLS", "FLY_STOP_ZOOM_MIN",
  "FLY_STOP_ZOOM_MAX", "FLY_CRUISE_PAD", "FLY_MIN_CLIMB",
  "FLY_PACE", "FLY_PAN_MIN_MS", "FLY_RAMP", "FLY_PITCH", "FLY_CRUISE_PITCH", "FLY_FULL_CLIMB", "FLY_MAX_LAT",
  "FLY_WEEK_DAYS", "FLY_MAX_WEEKS", "FLY_WEEK_CLIMB", "FLY_SAMPLES", "FLY_SMOOTH", "FLY_SMOOTH_MAX",
];
// SPAN_FLAT_* live inside the map effect and the FLY_* ones at module scope, so
// each is grabbed by name rather than by a range that would swallow the file.
const decls = constDecls
  .map((name) => {
    const m = new RegExp(`^\\s*const ${name} = [\\d.]+;(?:\\s*//.*)?$`, "m").exec(SRC);
    if (!m) throw new Error(`verify-route-flight: ${name} moved or changed shape`);
    return m[0].trim().replace(/\s*\/\/.*$/, "");
  })
  .join("\n");
const K = Object.fromEntries(
  constDecls.map((n) => [n, Number(new RegExp(`^\\s*const ${n} = ([\\d.]+);(?:\\s*//.*)?$`, "m").exec(SRC)[1])]),
);
const FS_NOW_NONE_DECL = /^const FS_NOW_NONE.*$/m.exec(SRC);
if (!FS_NOW_NONE_DECL) throw new Error("verify-route-flight: FS_NOW_NONE moved");

const DEPS = [
  "node", "map", "mapboxgl", "escapeHtml", "addLayer", "fitPad", "stopSpin", "type",
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
    `    framingLat, frameSpan, routeHops, readingZoom, departurePoint,\n` +
    `    framesFromDeparture, frameDeparture, departureZoom, halfFrameLng,\n` +
    `    globeFitZoom,\n` +
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
/**
 * Legs the way paintFocusRoute leaves them: one per itinerary hop, tagged with
 * the hop it IS (see route-frame.ts). `bow` bends a leg off the straight line
 * between its stops, the way a great circle or a real sea lane does, so
 * "follows the drawn route" is a claim with something to fail on.
 */
function route(stops, opts = {}) {
  const legs = [];
  for (let i = 1; i < stops.length; i++) {
    const [aLng, aLat] = stops[i - 1].at;
    const [bLng, bLat] = stops[i].at;
    const coords = [];
    for (let k = 0; k <= 24; k++) {
      const f = k / 24;
      const bow = (opts.bow ?? 0) * Math.sin(Math.PI * f);
      coords.push([aLng + (bLng - aLng) * f, aLat + (bLat - aLat) * f + bow]);
    }
    legs.push({ mode: "primary", coordinates: coords, hop: i });
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
  const clock = () => now;
  const timers = new Map();
  let nextId = 1;
  const log = [];
  const camera = { center: [0, 0], zoom: 1.25, pitch: 0, bearing: 0 };
  /** Every camera position the flight actually wrote, in order. */
  const track = [];
  /** Every options object handed to the camera, for the undefined-key check. */
  const cameraOpts = [];
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
      cameraOpts.push(o);
      camera.center = [...o.center]; camera.zoom = o.zoom;
      camera.pitch = o.pitch ?? camera.pitch; camera.bearing = o.bearing ?? camera.bearing;
      log.push("flyTo"); track.push({ t: now, at: [...o.center], zoom: camera.zoom, pitch: camera.pitch });
    },
    jumpTo: (o) => {
      cameraOpts.push(o);
      camera.center = [...o.center]; camera.zoom = o.zoom ?? camera.zoom;
      camera.pitch = o.pitch ?? camera.pitch; camera.bearing = o.bearing ?? camera.bearing;
      track.push({ t: now, at: [...o.center], zoom: camera.zoom, pitch: camera.pitch });
    },
    easeTo: (o) => {
      cameraOpts.push(o);
      if (o.center) camera.center = [...o.center];
      camera.zoom = o.zoom ?? camera.zoom;
      camera.pitch = o.pitch ?? camera.pitch; camera.bearing = o.bearing ?? camera.bearing;
      log.push("easeTo");
    },
    fitBounds: (b, o) => {
      cameraOpts.push(o);
      camera.pitch = o.pitch ?? camera.pitch; camera.bearing = o.bearing ?? camera.bearing;
      log.push("fitBounds");
    },
  };

  const flyingRef = { current: false };
  const dep = {
    node: { clientWidth: box.w, clientHeight: box.h },
    map,
    mapboxgl: { LngLatBounds: class { extend() {} } },
    escapeHtml: (s) => s,
    addLayer: (m, spec) => m.addLayer(spec),
    fitPad: () => 78,
    // The collection, which is what decides whether a flight may shed calls.
    type: opts.type ?? "jet",
    // Models haltSpin: it yields the ambient spin and NOTHING else. Ending a
    // flight from here is the bug this scenario exists to catch — see
    // "a repaint does not kill a flight in progress".
    stopSpin: () => { log.push("stopSpin"); },
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
      setHTML(h) { this._html = /(?:>)([^<]*)<\/div><\/div>/.exec(h)[1]; return this; },
      addTo() { labels.push({ text: this._html, at: [...(this._at ?? [])], t: clock() }); log.push("label"); return this; },
      remove() { log.push("label off"); },
    },
    stopPinned: false,
    window: { setTimeout: setTimeout_ },
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => { frames = []; },
    clearTimeout: clearTimeout_,
  };
  const api = makeFlight(dep);

  return {
    api, dep, log, camera, track, labels, paint, filters, flyingRef, cameraOpts,
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
const RUN = 120000;

const flat = (legs) => legs.flatMap((l) => l.coordinates);
/** Distance in degrees, longitude scaled by latitude — the flight's own metric. */
const dist = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), a[1] - b[1]);
/** Degrees of longitude across the frame at this zoom — what "too fast" is measured in. */
const frameDeg = (zoom, w) => (w * 360) / (512 * 2 ** zoom);
/**
 * How far the furthest camera position strays from the drawn line.
 *
 * Measured to the nearest point on a SEGMENT, not to the nearest vertex: the
 * drawn route is a polyline, a camera correctly half way along one of its
 * segments is exactly on the route, and scoring it against vertices alone
 * would call that half the segment's length of error.
 */
function furthestFromLine(points, legs) {
  const segs = [];
  for (const l of legs) {
    for (let i = 1; i < l.coordinates.length; i++) segs.push([l.coordinates[i - 1], l.coordinates[i]]);
  }
  let worst = 0;
  for (const p of points) {
    let best = Infinity;
    for (const [a, b] of segs) {
      const k = Math.cos((p[1] * Math.PI) / 180);
      const ax = (a[0] - p[0]) * k, ay = a[1] - p[1];
      const bx = (b[0] - p[0]) * k, by = b[1] - p[1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

{
  // A full circumnavigation, on the phone band that started all this.
  const legs = route(RTW);
  const h = harness({ legs, stops: RTW });
  h.api.flyRoute();
  h.tick(RUN);

  const path = flat(legs);
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
  check("…starting at the first call", dist(track[0].at, path[0]) < 0.01);
  check("…and reaching the last", dist(track[track.length - 1].at, path[path.length - 1]) < 0.01);

  /*
   * THE PACE, measured the way the complaint was made: not in degrees per
   * second, which is meaningless without an altitude, but in how much of the
   * FRAME goes past per second. The first version held one altitude and paid
   * for distance with speed, which put the middle of every long leg past at
   * two and a half frame-widths a second. The hop pays with altitude instead.
   */
  let fastest = 0, sumScreens = 0, n = 0;
  for (let i = 1; i < track.length; i++) {
    const dt = (track[i].t - track[i - 1].t) / 1000;
    if (dt <= 0) continue;
    const screens = dist(track[i - 1].at, track[i].at) / dt / frameDeg(track[i].zoom, 348);
    fastest = Math.max(fastest, screens);
    sumScreens += screens; n++;
  }
  check("never moves faster than about one frame-width a second",
    fastest <= 1.15, `${fastest.toFixed(2)} screens/s peak`);
  check("…and averages a good deal less than that while moving",
    sumScreens / n <= 0.55, `${(sumScreens / n).toFixed(2)} screens/s mean`);

  // It stops at every call. A "dwell" is a stretch with no camera write at all.
  const gaps = [];
  for (let i = 1; i < track.length; i++) {
    const gap = track[i].t - track[i - 1].t;
    if (gap > 200) gaps.push({ ms: gap, at: track[i - 1].at });
  }
  check("holds still at every call, long enough to read it",
    gaps.length === RTW.length - 1 && gaps.every((g) => g.ms >= K.FLY_DWELL_MS),
    `${gaps.length} holds of ${Math.round(Math.min(...gaps.map((g) => g.ms)))}ms+`);
  check("…with the camera on the call itself, not near it",
    gaps.every((g, i) => dist(g.at, RTW[i].at) < 0.01));

  // The reading altitude the flight chose for this route — every landing is
  // read from it, and every climb is measured against it.
  const readZoom = track[0].zoom;

  // It climbs between them: the whole reason the empty middle can go past
  // quickly while the ends stay legible.
  let climbed = 0;
  for (let i = 1; i < track.length; i++) {
    if (track[i].t - track[i - 1].t > 200) continue; // a dwell, not a leg
    if (track[i].zoom < readZoom - K.FLY_MIN_CLIMB + 0.01) climbed++;
  }
  check("climbs out between calls rather than crossing at city zoom", climbed > 0,
    `${climbed} frames above the minimum climb`);
  // Every call is read from the same height, arrival included — a flight whose
  // altitude drifted between calls would make one city look more important
  // than the next for no reason anyone chose.
  const atCalls = [track[0], ...track.filter((p, i) => i > 0 && track[i].t - track[i - 1].t > 200)
    .map((_, k) => track[track.findIndex((q, i) => i > 0 && track[i].t - track[i - 1].t > 200 && k-- === 0) - 1])];
  check("…and reads every call from the same height",
    atCalls.every((p) => Math.abs(p.zoom - readZoom) < 0.01) &&
      readZoom >= K.FLY_STOP_ZOOM_MIN && readZoom <= K.FLY_STOP_ZOOM_MAX,
    `${atCalls.length} landings at zoom ${readZoom.toFixed(2)}`);
  check("…tilting hard at the calls and flattening at cruise",
    track[0].pitch === K.FLY_PITCH &&
      Math.min(...track.filter((p) => p.zoom < readZoom - 0.5).map((p) => p.pitch)) < K.FLY_PITCH - 10);

  // The names.
  check("names every call, in order, once",
    h.labels.length === RTW.length &&
      h.labels.every((l, i) => l.text.startsWith(`${i + 1}. Day ${RTW[i].day} · ${RTW[i].name}`)),
    h.labels.map((l) => l.text.split(" · ")[1]).join(" → "));
  check("…each one up before its hold, so there is something to read during it",
    h.labels.every((l, i) => i === 0 || l.t <= gaps[i - 1].ms + l.t));

  // The budget.
  const end = track[track.length - 1].t + K.FLY_DWELL_MS + K.FLY_SETTLE_MS;
  check("a nine-call world tour runs to a watchable length",
    end <= K.FLY_VOYAGE_MS, `${(end / 1000).toFixed(1)}s`);

  const moves = h.log.filter((l) => ["flyTo", "easeTo", "fitBounds"].includes(l));
  check("the landing is the last camera command, not the second to last",
    moves.length === 2 && moves[0] === "flyTo" && moves[1] !== "flyTo", moves.join(" → "));
  check("levels out at the end", h.camera.pitch === 0);
  check("hands the route back at full strength", h.paint.get("fr_rail.line-opacity") === 0.92);
  check("leaves nothing lit", h.filters.get("fs_now") === JSON.stringify(["==", ["get", "n"], "—"]));
  check("leaves no timer or frame running", h.pending() === 0 && !h.flyingRef.current);
}

{
  /*
   * ── The departure view ──────────────────────────────────────────────────
   *
   * A jet expedition that circles the planet has no whole-route framing worth
   * showing: fitting its box is the world at minimum zoom, the route off both
   * edges, nothing on screen to say where the journey starts. So the view stays
   * wide and the GLOBE is turned instead, until the departure sits in frame off
   * to one side with the journey running away across the face of it.
   *
   * Centring on the departure is the mistake this replaced: every round-the-
   * world itinerary leaves from North America, so every one of them opened on
   * the same picture of the United States.
   *
   * Read on a desktop-sized box, because the thing under test is where a wide
   * view is pointed and a phone band is at minimum zoom whatever you do.
   */
  const DESK = { w: 1200, h: 700 };
  const depart = RTW[0].at;
  const h = harness({ legs: route(RTW), stops: RTW, box: DESK });
  check("a round-the-world jet route is one no frame can hold",
    h.api.framesFromDeparture(h.api.spanOf([{ coordinates: flat(route(RTW)) }])));
  check("…and a Mediterranean one is not",
    !h.api.framesFromDeparture(h.api.spanOf([{ coordinates: flat(route(MED)) }])));

  // The view a traced route rests at, before anything is flown.
  h.api.frameDeparture(2400);
  const zoom = h.camera.zoom;
  const half = h.api.halfFrameLng(zoom);
  const off = Math.abs(h.camera.center[0] - depart[0]);
  check("tracing it stays wide — a step in from the whole globe, not a country",
    zoom > h.api.globeFitZoom() + 0.5 && zoom < K.FLY_STOP_ZOOM_MIN - 1,
    `zoom ${zoom.toFixed(2)} against a whole globe at ${h.api.globeFitZoom().toFixed(2)}`);
  check("…with the departure in frame, well clear of the limb",
    off < half * 0.8, `${off.toFixed(0)}° off centre, half a frame is ${half.toFixed(0)}°`);
  check("…and NOT centred on it, so nine itineraries do not open on one view",
    off > half * 0.2, `${off.toFixed(0)}° off centre`);
  check("…pushed the way the journey goes, so the route fills the frame",
    h.camera.center[0] < depart[0],
    `Seattle at ${depart[0]}° leaves westward, centre at ${h.camera.center[0].toFixed(0)}°`);
  check("…and level, because this is a view to read rather than a shot",
    h.camera.pitch === 0);

  // …and the view it comes back to when the flight is over.
  const f = harness({ legs: route(RTW), stops: RTW, box: DESK });
  f.api.flyRoute();
  f.tick(RUN);
  check("the flight lands back on the view it was traced at",
    dist(f.camera.center, h.camera.center) < 0.01 && Math.abs(f.camera.zoom - zoom) < 0.01,
    `ended at ${f.camera.center.map((n) => n.toFixed(1)).join(", ")} zoom ${f.camera.zoom.toFixed(2)}, traced at ${h.camera.center.map((n) => n.toFixed(1)).join(", ")} zoom ${zoom.toFixed(2)}`);
  check("…which is wider than the height it read its calls from",
    f.camera.zoom < f.track[0].zoom - 1,
    `settled at ${f.camera.zoom.toFixed(2)}, read at ${f.track[0].zoom.toFixed(2)}`);

  // The collections that do want the whole journey back still get it.
  const many = stopsOf(
    Array.from({ length: 20 }, (_, i) => [`Port ${i + 1}`, -170 + i * 17, 20 * Math.sin(i / 2)]),
  );
  const w = harness({ legs: route(many), stops: many, type: "worldcruise", box: DESK });
  check("a world cruise still pulls back to the whole voyage",
    !w.api.framesFromDeparture(w.api.spanOf([{ coordinates: flat(route(many)) }])));
  w.api.flyRoute();
  w.tick(RUN);
  check("…and its flight ends on the voyage, not beside its first port",
    dist(w.camera.center, many[0].at) > 20,
    `ended ${dist(w.camera.center, many[0].at).toFixed(0)}° from ${many[0].name}`);
}

{
  // The trail, which only exists while the flight does: it is cleared on the
  // way out, because by then the route itself is back at full strength and a
  // second copy of it under the first is just a heavier line.
  const legs = route(RTW);
  const h = harness({ legs, stops: RTW });
  h.api.flyRoute();
  h.tick(K.FLY_ARRIVE_MS + K.FLY_DWELL_MS + 900);
  const mid = h.trail();
  const camera = [...h.camera.center];
  h.tick(RUN);
  check("the trail grows behind the camera, not ahead of it",
    mid.length > 1 && dist(mid[mid.length - 1], camera) < 2,
    `${mid.length} points, ${dist(mid[mid.length - 1], camera).toFixed(1)}° behind`);
  check("…and is put away once the route is back at full strength", h.trail().length === 0);
}

{
  // Interruption: a hand on the globe, mid-leg.
  const legs = route(RTW);
  const h = harness({ legs, stops: RTW });
  h.api.flyRoute();
  h.tick(K.FLY_ARRIVE_MS + K.FLY_DWELL_MS + 600);
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
    h.camera.pitch > 0, `pitch ${h.camera.pitch.toFixed(0)}`);
  check("…and ends the flight", !h.flyingRef.current && h.pending() === 0);
}

{
  // Interrupted during the drop-in, before the first call.
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
  // A regional route: same beats, a shorter climb, a shorter flight.
  const legs = route(MED);
  const h = harness({ legs, stops: MED });
  h.api.flyRoute();
  h.tick(RUN);
  const end = h.track[h.track.length - 1].t + K.FLY_DWELL_MS + K.FLY_SETTLE_MS;
  const world = harness({ legs: route(RTW), stops: RTW });
  world.api.flyRoute();
  world.tick(RUN);
  const worldEnd = world.track[world.track.length - 1].t;
  check("a four-call regional route is a short flight, not a world tour's worth",
    end < worldEnd / 1.6, `${(end / 1000).toFixed(1)}s vs ${(worldEnd / 1000).toFixed(1)}s`);
  check("…and never climbs as far, because it never has to",
    Math.min(...h.track.map((p) => p.zoom)) > Math.min(...world.track.map((p) => p.zoom)),
    `zoom ${Math.min(...h.track.map((p) => p.zoom)).toFixed(1)} vs ${Math.min(...world.track.map((p) => p.zoom)).toFixed(1)}`);
  // The landing pulls back to the whole route: wider than the reading height it
  // was just at, and centred on the itinerary rather than on its last call.
  const routeSpan = { lo: Math.min(...MED.map((st) => st.at[0])), hi: Math.max(...MED.map((st) => st.at[0])) };
  check("…and is framed at the end rather than left on the last call",
    h.camera.zoom < Math.min(...h.track.map((p) => p.zoom)) + 0.01 ||
      h.camera.zoom < h.track[0].zoom,
    `settled at zoom ${h.camera.zoom.toFixed(2)} after reading at ${h.track[0].zoom.toFixed(2)}`);
  check("…centred on the route, not on wherever it stopped",
    h.camera.center[0] > routeSpan.lo && h.camera.center[0] < routeSpan.hi,
    `centre ${h.camera.center[0].toFixed(1)}° in ${routeSpan.lo.toFixed(0)}…${routeSpan.hi.toFixed(0)}`);
}

{
  // A world cruise: more ports than a flight can set down on.
  const many = stopsOf(
    Array.from({ length: 34 }, (_, i) => [`Port ${i + 1}`, -170 + i * 10, 20 * Math.sin(i / 2)]),
  );
  const h = harness({ legs: route(many), stops: many, type: "worldcruise" });
  h.api.flyRoute();
  h.tick(RUN);
  const end = h.track[h.track.length - 1].t + K.FLY_DWELL_MS + K.FLY_SETTLE_MS;
  // The ceiling, plus a frame of slack per beat: each beat ends on the first
  // frame at or after its duration, so a flight with fifty of them lands a few
  // hundred milliseconds late by construction and that is not a budget failure.
  const slack = 17 * h.labels.length * 2;
  check("a thirty-four port world cruise thins its landings rather than running to two minutes",
    h.labels.length <= K.FLY_MAX_CALLS && end <= K.FLY_VOYAGE_MS + slack,
    `${h.labels.length} of ${many.length} calls, ${(end / 1000).toFixed(1)}s`);
  check("…keeping the first and the last", h.labels[0].text.startsWith("1.") &&
    h.labels[h.labels.length - 1].text.startsWith(`${many.length}.`));
  // Thinning the LANDINGS is not thinning the route: the camera still flies
  // over every port, it just does not stop at all of them.
  const missed = many.filter((st) => !h.track.some((p) => dist(p.at, st.at) < 2));
  check("…while still flying over every port it does not stop at",
    missed.length === 0, `${many.length - missed.length}/${many.length} overflown`);

  /*
   * …and no other collection sheds a call, at any length. A journey is flown in
   * full: shedding calls from a jet tour to save a few seconds shows less of
   * the trip than the trip has, which is the opposite of the point. Checked on
   * the same oversized itinerary so the only difference is the collection.
   */
  for (const type of ["jet", "yacht", "cruise", "train"]) {
    const g = harness({ legs: route(many), stops: many, type });
    g.api.flyRoute();
    g.tick(RUN * 4);
    check(`a ${type} itinerary lands on every one of its calls, however long`,
      g.labels.length === many.length,
      `${g.labels.length} of ${many.length}`);
  }
}

{
  // Nothing traced: the Fly control must be inert rather than throw.
  const h = harness({ legs: [], stops: [] });
  h.api.flyRoute();
  h.tick(RUN);
  check("nothing traced, nothing flown", h.track.length === 0 && !h.flyingRef.current);
}

{
  // A route with geometry but no itinerary behind it: its ends are its calls.
  const legs = route(MED);
  const h = harness({ legs, stops: [] });
  h.api.flyRoute();
  h.tick(RUN);
  check("a route with no named stops is still flown, end to end",
    h.track.length > 0 && !h.flyingRef.current);
}

{
  /*
   * FOLLOWS THE DRAWN ROUTE, which is a stronger claim than "stays near the
   * stops" and the one that was failing: the flight used to concatenate every
   * stored leg and resample the result, which flew orphan legs route-frame had
   * appended, and cut hops with no geometry as straight lines. Both show a
   * journey the map underneath is not drawing.
   *
   * The fixtures bow their legs off the straight line, the way a great circle
   * or a sea lane does, so a camera taking the short way is measurable.
   */
  const bowed = route(RTW, { bow: 6 });
  const h = harness({ legs: bowed, stops: RTW });
  h.api.flyRoute();
  h.tick(RUN);
  const worst = furthestFromLine(h.track.map((p) => p.at), bowed);
  check("every camera position sits ON the drawn line, not near its endpoints",
    worst < 0.6, `worst ${worst.toFixed(2)}° off the drawn route`);

  // An orphan leg — one no hop claimed, which route-frame appends after the
  // route. It is drawn; it must not be flown.
  const withOrphan = [...route(RTW), { mode: "primary", coordinates: [[20, -70], [40, -72]] }];
  const g = harness({ legs: withOrphan, stops: RTW });
  g.api.flyRoute();
  g.tick(RUN);
  check("an orphan leg is drawn but never flown",
    g.track.every((p) => p.at[1] > -60),
    `southernmost camera latitude ${Math.min(...g.track.map((p) => p.at[1])).toFixed(0)}°`);

  /*
   * A hop with no geometry at all — flown DIRECT, and its call still landed on.
   *
   * This assertion used to demand the opposite: that the flight simply not have
   * that leg. `fillGaps` (routeHops, AtlasShell) reversed it deliberately and
   * this test was not moved with it, which is worth spelling out because the
   * two positions both sound right.
   *
   * route-frame leaves such a hop empty on purpose: a straight stroke between
   * two ports is a claim about a route the ship does not take, and the atlas
   * would rather show a gap than a lie. But the CAMERA is not under that
   * constraint — it draws nothing, it only travels — and the alternative to
   * travelling is silently not calling at a port the itinerary lists, leaving a
   * hole in the numbering ("7. Day 19 · Marrakesh") that reads as a data error.
   * Roughly 15% of expedition stops carry no coordinate, so this is the common
   * case, not the exotic one.
   *
   * The legs are BOWED, which is what keeps the claim falsifiable: cutting the
   * corner on a hop that does have geometry lands 6° off the drawn line. Only
   * the one filled hop may be flown straight, so it is measured against the
   * direct line the flight is entitled to take there and nothing else.
   */
  const bowedHoled = route(RTW, { bow: 6 }).filter((l) => l.hop !== 4);
  const flown = [...bowedHoled, { mode: "primary", coordinates: [RTW[3].at, RTW[4].at] }];
  const k = harness({ legs: bowedHoled, stops: RTW });
  k.api.flyRoute();
  k.tick(RUN);
  const holedWorst = furthestFromLine(k.track.map((p) => p.at), flown);
  check("a hop with no geometry is flown direct, and its call still landed on",
    holedWorst < 0.6 && k.labels.length === RTW.length,
    `${k.labels.length} of ${RTW.length} calls landed, worst ${holedWorst.toFixed(2)}° off the flown route`);
  check("…and the calls after the gap still carry their own names",
    k.labels.every((l) => {
      const n = Number(l.text.split(".")[0]);
      return l.text.includes(RTW[n - 1].name);
    }),
    k.labels.map((l) => l.text.split(" · ")[1]).join(" → "));
}

{
  /*
   * CLOSE STOPS ARE CROSSED FLAT. A coastal cruise or a rail journey is watched
   * to study its stops, and climbing out over a strait whose far side is
   * already on screen costs exactly that.
   */
  const coastal = stopsOf([
    ["Nice", 7.27, 43.70], ["Villefranche", 7.31, 43.70], ["Monaco", 7.42, 43.74],
    ["Menton", 7.50, 43.78], ["San Remo", 7.78, 43.82],
  ]);
  const h = harness({ legs: route(coastal), stops: coastal });
  h.api.flyRoute();
  h.tick(RUN);
  const zooms = h.track.map((p) => p.zoom);
  check("a coastal itinerary is read from close in, not from a jet's altitude",
    Math.max(...zooms) >= K.FLY_STOP_ZOOM_MAX - 0.01,
    `reading zoom ${Math.max(...zooms).toFixed(2)}`);
  check("…and crosses between close stops flat, with no climb to sit through",
    Math.max(...zooms) - Math.min(...zooms) < 0.01,
    `zoom varies by ${(Math.max(...zooms) - Math.min(...zooms)).toFixed(3)}`);
  check("…keeping the tilt the whole way, since it never climbs",
    h.track.every((p) => p.pitch === K.FLY_PITCH));
  const world = harness({ legs: route(RTW), stops: RTW });
  world.api.flyRoute();
  world.tick(RUN);
  const legMs = (t) => {
    const holds = [];
    for (let i = 1; i < t.length; i++) if (t[i].t - t[i - 1].t > 200) holds.push(i);
    return holds.length > 1 ? t[holds[1] - 1].t - t[holds[0]].t : 0;
  };
  // …and on a route where SOME legs outgrow the frame, only those climb. The
  // reading height comes from the median leg, so a longer-than-median one
  // genuinely needs room and gets it; the short ones are still crossed flat.
  const mixed = stopsOf([
    ["Nice", 7.27, 43.70], ["Monaco", 7.42, 43.74], ["Portovenere", 9.84, 44.05],
    ["Amalfi", 14.60, 40.63], ["Taormina", 15.29, 37.85],
  ]);
  const m = harness({ legs: route(mixed), stops: mixed });
  m.api.flyRoute();
  m.tick(RUN);
  const mz = m.track.map((p) => p.zoom);
  check("…while a leg that outgrows the frame still climbs for it",
    Math.max(...mz) - Math.min(...mz) >= K.FLY_MIN_CLIMB - 0.01,
    `zoom ${Math.min(...mz).toFixed(1)}…${Math.max(...mz).toFixed(1)}`);

  check("…and moves a bit quicker for it than a leg that has to climb",
    legMs(h.track) < legMs(world.track),
    `${legMs(h.track)}ms vs ${legMs(world.track)}ms per leg`);
}

{
  /*
   * NEVER READ FROM A POLE. An Antarctic expedition's bounding box is centred
   * at 65°S, and fitBounds obediently puts the camera there — which on a sphere
   * is the underside of the world seen from directly above, with the itinerary
   * wrapped round the outside. It shows most of the route and reads as nothing.
   */
  const h = harness({ box: { w: 348, h: 340 } });
  check("a whole-globe framing is read from near the equator",
    Math.abs(h.api.framingLat(-64, 1.1)) <= 40 && Math.abs(h.api.framingLat(72, 0.9)) <= 40,
    `-64° → ${h.api.framingLat(-64, 1.1).toFixed(0)}°, 72° → ${h.api.framingLat(72, 0.9).toFixed(0)}°`);
  /*
   * …and a wide-but-not-global one keeps the pole out of the picture. Both
   * halves of this are measured against mapbox-gl 3.7 itself, by projecting
   * the pole into a 348x340 globe and asking whether it lands on screen:
   * centred at 78°N it does at zoom 2 and does NOT at zoom 3. The guard has to
   * bite on the first and leave the second alone — a frame that reaches 81°N
   * is a fine picture of Svalbard, and dragging it south costs the zoom that
   * makes the itinerary legible.
   */
  check("…and a wide-but-not-global one keeps the pole out of the picture",
    h.api.framingLat(78, 2) < 78,
    `78° at zoom 2 → ${h.api.framingLat(78, 2).toFixed(0)}°`);
  check("…while a frame the pole is not in is left where the route is",
    h.api.framingLat(78, 3) === 78,
    `78° at zoom 3 → ${h.api.framingLat(78, 3).toFixed(0)}°`);
  check("a regional framing is left exactly where it belongs",
    h.api.framingLat(61, 5) === 61 && h.api.framingLat(43.7, 7) === 43.7,
    "an Alaskan cruise and a Riviera one are untouched");
  check("…and so is anything near the equator, at any zoom",
    [0, 1, 2, 4, 6].every((z) => h.api.framingLat(12, z) === 12));

  // End to end: an Antarctic route browsed on a phone must not settle on a pole.
  const polar = stopsOf([
    ["Ushuaia", -68.3, -54.8], ["Deception Island", -60.6, -63.0],
    ["Paradise Bay", -62.9, -64.9], ["South Georgia", -36.5, -54.3],
  ]);
  const p = harness({ legs: route(polar), stops: polar });
  p.api.frameSpan(p.api.spanOf([{ coordinates: route(polar).flatMap((l) => l.coordinates) }]),
    { duration: 2400 });
  check("browsing an Antarctic itinerary does not look down at the pole",
    p.camera.center[1] > -60, `centred at ${p.camera.center[1].toFixed(0)}°`);
}

{
  /*
   * A REPAINT DOES NOT KILL A FLIGHT. paintFocusRoute calls stopSpin on every
   * repaint — a hover leaving a card and restoring the pinned route, a basemap
   * switch, a filter change — and endFlight was wired into that path. On a
   * desktop the selected card smooth-scrolls under a stationary pointer, its
   * mouseleave re-emits the pinned route, and the flight was dead a few hundred
   * milliseconds in, before its own arrival had finished. Every time.
   */
  const legs = route(RTW);
  const h = harness({ legs, stops: RTW });
  h.api.flyRoute();
  h.tick(K.FLY_ARRIVE_MS + K.FLY_DWELL_MS + 500);
  const before = h.track.length;
  h.api.state();
  // The repaint, exactly as paintFocusRoute does it.
  h.dep.stopSpin();
  h.tick(4000);
  check("a repaint does not kill a flight in progress",
    h.flyingRef.current && h.track.length > before + 20,
    `${h.track.length - before} camera writes after the repaint`);

  // …while a hand on the globe still does, because the map's own interaction
  // listeners call stopFly for themselves.
  const g = harness({ legs, stops: RTW });
  g.api.flyRoute();
  g.tick(K.FLY_ARRIVE_MS + K.FLY_DWELL_MS + 500);
  const stopped = g.track.length;
  g.api.endFlight();
  g.tick(4000);
  check("…but a hand on the globe still does", !g.flyingRef.current && g.track.length === stopped);
}

{
  /*
   * NO UNDEFINED CAMERA KEYS. Mapbox reads its options with `'pitch' in
   * options`, not with a value check, so a key present and undefined becomes
   * `+undefined` — NaN — and a NaN pitch or bearing poisons the transform and
   * stops the renderer. Clicking a card produced no route and a frozen globe in
   * every browser, because the framing meant to reveal the route killed the
   * map instead.
   */
  const cases = [
    ["a route framing", (h) => h.api.frameSpan(h.api.spanOf([{ coordinates: flat(route(MED)) }]), { duration: 2400 })],
    ["a polar framing", (h) => h.api.frameSpan(h.api.spanOf([{ coordinates: flat(route(stopsOf([["A", -60, -62], ["B", -30, -66]]))) }]), { duration: 2400 })],
    ["a whole flight", (h) => { h.api.flyRoute(); h.tick(RUN); }],
  ];
  const bad = [];
  for (const [name, run] of cases) {
    const h = harness({ legs: route(RTW), stops: RTW });
    run(h);
    for (const o of h.cameraOpts) {
      for (const k of Object.keys(o)) {
        if (o[k] === undefined) bad.push(`${name}: ${k}`);
        if (typeof o[k] === "number" && !Number.isFinite(o[k])) bad.push(`${name}: ${k}=${o[k]}`);
      }
    }
  }
  check("never hands the camera an undefined or non-finite option",
    bad.length === 0, bad.slice(0, 4).join(", ") || "clean");
}

{
  /*
   * A ROUTE DRAWN AS ONE LEG STILL LANDS AT EVERY CALL. The private jet atlas
   * arcs a whole journey into a single lofted polyline, so route-frame's walk
   * claims no hop and the flight has no per-hop geometry to follow. Reading
   * that as "no itinerary" flew a nine-city world tour as one unbroken leg,
   * naming one call and stopping at none.
   */
  const oneLeg = [{ mode: "primary", coordinates: flat(route(RTW)) }]; // no hop tags
  const h = harness({ legs: oneLeg, stops: RTW });
  h.api.flyRoute();
  h.tick(RUN);
  check("a route drawn as a single leg still lands at every call",
    h.labels.length === RTW.length,
    `${h.labels.length} of ${RTW.length} calls named`);
  check("…and still follows the drawn line to get there",
    furthestFromLine(h.track.map((p) => p.at), oneLeg) < 0.01);

  // A sailing whose geometry came back as a pile of identical points — the
  // shipped yacht data has these. The stops are still drawn, so fly those
  // rather than offering a control that does nothing.
  const dud = [{ mode: "primary", hop: 1, coordinates: [[12.34, 45.43], [12.34, 45.43], [12.34, 45.43]] }];
  const d = harness({ legs: dud, stops: MED });
  d.api.flyRoute();
  d.tick(RUN);
  check("a route with no drawable geometry is flown between its calls",
    d.track.length > 0 && d.labels.length > 1,
    `${d.labels.length} calls named`);
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

{
  /*
   * THE WIRING, checked in the source. haltSpin and the map's interaction
   * listeners live above the sliced block, so the harness cannot exercise
   * them — but which of the two ends a flight is exactly what broke it, so it
   * is worth asserting outright.
   */
  // Comments say the words too, and this is a file that explains itself at
  // length — strip them, or the prose about the bug reads as the bug.
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const halt = /function haltSpin\(\)\s*\{([\s\S]*?)\n        \}/.exec(SRC);
  check("haltSpin does not end the flight — a repaint calls it",
    !!halt && !/stopFly|endFlight/.test(code(halt[1])),
    halt ? (code(halt[1]).trim().split("\n").length + " statements") : "haltSpin not found — anchor moved");
  const grab = /\["mousedown", "touchstart", "wheel", "dragstart"\][\s\S]{0,300}/.exec(SRC);
  check("…and a hand on the globe does",
    !!grab && /stopFly/.test(code(grab[0])),
    grab ? "clean" : "interaction listeners not found — anchor moved");
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

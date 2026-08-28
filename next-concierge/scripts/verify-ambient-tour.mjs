/**
 * The ambient auto-tour: does it actually yield?
 *
 * The tour drives the home globe's camera on a timer. That makes it the only
 * thing in the atlas that moves the map without being asked to, which makes
 * "it stops the instant the visitor does anything" not a nicety but the entire
 * licence for it to exist. A tour that keeps steering after you've grabbed the
 * globe is worse than no tour: it is the product fighting you.
 *
 * That property is invisible to the type checker and awkward to catch by hand —
 * it lives in the interleaving of three timers, a camera ease and two latches,
 * and the failure mode is a two-second window several seconds into a page load.
 * Two real bugs were found here by running these scenarios rather than reading
 * the code:
 *
 *   1. An interaction during the lead-in (before the first pin) did not cancel
 *      the tour, because the abort guarded on `tourActive`, which is still
 *      false then. Grabbing the globe early got the camera yanked away a beat
 *      later — exactly the visitor most likely to be engaging.
 *
 *   2. `armTour` took the camera by calling `stopSpin`, which aborts the tour.
 *      That blew the dismissal latch a moment BEFORE the tour started, so the
 *      tour ran fine and could never afterwards be interrupted at all. Hence
 *      the haltSpin / stopSpin split.
 *
 * Rather than restate the logic (a test that reimplements what it tests proves
 * nothing), this slices the real tour block out of AtlasShell.tsx, compiles it,
 * and runs it against a fake map and a fake clock.
 *
 *   node scripts/verify-ambient-tour.mjs
 */

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = mkdtempSync(join(tmpdir(), "tour-"));
const SRC = readFileSync(join(ROOT, "components/AtlasShell.tsx"), "utf8");

// ── Slice the real thing ────────────────────────────────────────────────────
// Anchored on comment banners rather than line numbers so the slice survives
// edits above it, and throws loudly if either anchor is ever renamed.
function between(open, close) {
  const a = SRC.indexOf(open);
  const b = SRC.indexOf(close, a + 1);
  if (a < 0 || b < 0) {
    throw new Error(`verify-ambient-tour: anchor moved — could not find ${a < 0 ? open : close}`);
  }
  return SRC.slice(a, b);
}

// Closed on the declaration itself rather than the doc comment above it. The
// first version anchored on the comment's opening words and broke the moment
// that comment was reworded — which is a fine way for this to fail (loudly, at
// the top) but a silly thing to have to fix. Declarations get renamed less
// often than prose does.
const stopsDecl = between("interface TourStop {", "const TOUR_TRAVEL_MS");
// Starts at the tour-ended latch, not at tourPins: the broadcast that frees the
// Guide is part of the unit under test, and the most consequential part of it.
const tourBody = between("        let tourEndAnnounced", "        // ── Result-pin pulse");

// The three timing constants, grabbed individually. A range slice between two
// banners was tempting and wrong: they sit at module scope, hundreds of lines
// above the tour body that shares its banner text, so the range quietly
// swallowed a third of the component.
// The resting globe's own motion, sliced whole: the constants, then the pure
// frame function they feed. It is at module scope precisely so this can play it
// forward — a rotation that eases in and a tilt that decays are claims about
// motion over time, and nothing static can check them.
const spinDecl = (() => {
  const consts = ["SPIN_RATE", "SPIN_EASE_MS", "SPIN_LEVEL_PER_FRAME", "SPIN_LEVEL_MAX", "SPIN_LEVEL_MIN"]
    .map((name) => {
      const m = new RegExp(`^const ${name} = [\\d.]+;$`, "m").exec(SRC);
      if (!m) throw new Error(`verify-ambient-tour: ${name} moved or changed shape`);
      return m[0];
    })
    .join("\n");
  return `${consts}\n${between("function spinFrame(", "\n/**\n * What the rest of the map fades to")}`;
})();

const constDecls = ["TOUR_TRAVEL_MS", "TOUR_DWELL_MS", "TOUR_LEAD_MS"]
  .map((name) => {
    const m = new RegExp(`^const ${name} = \\d+;$`, "m").exec(SRC);
    if (!m) throw new Error(`verify-ambient-tour: ${name} moved or changed shape`);
    return m[0];
  })
  .join("\n");

// The same three values as numbers, so scenarios can say "half way through the
// second leg" instead of hard-coding 8900ms. Retuning the tour used to silently
// move a scenario into a different phase and fail an unrelated assertion.
const T = Object.fromEntries(
  ["TOUR_TRAVEL_MS", "TOUR_DWELL_MS", "TOUR_LEAD_MS"].map((n) => [
    n,
    Number(new RegExp(`^const ${n} = (\\d+);$`, "m").exec(SRC)[1]),
  ]),
);
/** The instant half way through the ease toward stop `n` (1-based). */
const midTravel = (n) =>
  T.TOUR_LEAD_MS + (n - 1) * (T.TOUR_TRAVEL_MS + T.TOUR_DWELL_MS) + T.TOUR_TRAVEL_MS / 2;

// The slice reads a dozen names from the enclosing map effect. Bind them all
// from the harness rather than stubbing globals, so the compiled unit is a
// plain function of its dependencies.
const DEPS = [
  "map", "mapboxgl", "escapeHtml", "addLayer", "homeZoom", "cancelled",
  "focused", "subsetActive", "projGlobe", "ambientTour", "fitGlobe",
  "startSpin", "haltSpin", "window", "document", "clearTimeout",
  "requestAnimationFrame",
];

writeFileSync(
  join(OUT, "tour.ts"),
  `/* eslint-disable */\n` +
    `${stopsDecl}\n${constDecls}\n` +
    `${spinDecl}\nexport { spinFrame };\n` +
    `export function makeTour(dep: any) {\n` +
    `  const { ${DEPS.join(", ")} } = dep;\n` +
    `  let tourArmed = false, tourActive = false, tourDismissed = false;\n` +
    `  let tourTimer = 0, tourPaintTimer = 0, tourStep = 0;\n` +
    `${tourBody}\n` +
    `  function stopSpin() { haltSpin(); abortTour(); }\n` +
    `  return { armTour, abortTour, stopSpin,\n` +
    `    state: () => ({ tourArmed, tourActive, tourDismissed, pins: tourPins.length }) };\n` +
    `}\n`,
);

execFileSync("npx", [
  "tsc", join(OUT, "tour.ts"),
  "--outDir", OUT, "--module", "esnext", "--target", "es2022",
  "--moduleResolution", "bundler", "--skipLibCheck",
], { cwd: ROOT, stdio: "inherit" });

const { makeTour, spinFrame } = await import(pathToFileURL(join(OUT, "tour.js")).href);

// ── A fake map and a fake clock ─────────────────────────────────────────────
function harness(opts = {}) {
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const log = [];
  const camera = { center: [10, 20], zoom: 1.25, easing: null };
  const ended = []; // timestamps of every "bevvip:tour-ended" broadcast

  const setTimeout_ = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { at: now + ms, fn });
    return id;
  };
  const clearTimeout_ = (id) => timers.delete(id);

  // Tile state. `tilesReady` is what areTilesLoaded() reports; when tiles are
  // slow, an "idle" listener is parked and only fires once the harness says
  // the tiles landed — which is how Mapbox actually behaves.
  let tilesReady = !opts.slowTiles;
  let idleWaiters = [];
  const map = {
    once: (type, cb) => { if (type === "idle") idleWaiters.push(cb); },
    areTilesLoaded: () => tilesReady,
    getZoom: () => camera.zoom,
    getLayer: (id) => layers.has(id),
    addSource: (id) => sources.add(id),
    getSource: (id) => (sources.has(id) ? { setData() {} } : undefined),
    addLayer: (spec) => layers.add(spec.id),
    easeTo: (o) => {
      camera.easing = { to: o.center, done: now + o.duration };
      log.push(`ease ${o.center[0].toFixed(0)},${o.center[1].toFixed(0)}`);
    },
    stop: () => { if (camera.easing) { camera.easing = null; log.push("STOP"); } },
    setZoom() {}, setPitch() {}, getPitch: () => 0,
  };
  const layers = new Set();
  const sources = new Set();
  const popup = {
    setLngLat() { return this; },
    setHTML(h) { log.push("pin " + /<b>(.*?)<\/b>/.exec(h)[1]); return this; },
    addTo() { return this; },
    remove() {},
  };

  const api = makeTour({
    map,
    mapboxgl: { Popup: function () { return popup; } },
    escapeHtml: (s) => s,
    addLayer: (m, spec) => map.addLayer(spec),
    homeZoom: 1.25,
    cancelled: false,
    focused: !!opts.focused,
    subsetActive: !!opts.subsetActive,
    projGlobe: opts.projGlobe !== false,
    ambientTour: opts.ambientTour !== false,
    fitGlobe: () => log.push("fitGlobe"),
    startSpin: () => log.push("startSpin"),
    haltSpin: () => log.push("haltSpin"),
    // The swing back to the equator that a finished tour hands the globe
    // through. Modelled with a real delay, not a synchronous pass-through, so
    // "the spin resumes only once the globe is level again" is actually tested.
    window: {
      setTimeout: setTimeout_,
      matchMedia: (q) => ({ matches: q.includes("reduced-motion") ? !!opts.reduced : false }),
      // The Guide is held back until this fires, so the harness counts them.
      dispatchEvent: (e) => { if (e.type === "bevvip:tour-ended") ended.push(now); },
    },
    document: { hidden: !!opts.hidden },
    clearTimeout: clearTimeout_,
    requestAnimationFrame: () => 0,
  });

  return {
    api, log, camera, ended,
    landTiles() {
      tilesReady = true;
      const w = idleWaiters; idleWaiters = [];
      log.push("tiles");
      for (const cb of w) cb();
    },
    tilesPending: () => idleWaiters.length,
    pins: () => log.filter((l) => l.startsWith("pin ")).map((l) => l.slice(4)),
    pending: () => timers.size,
    tick(ms) {
      const end = now + ms;
      for (;;) {
        let due = null, dueId = 0;
        for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due.at)) { due = t; dueId = id; }
        if (!due) break;
        now = due.at;
        timers.delete(dueId);
        due.fn();
      }
      now = end;
      if (camera.easing && now >= camera.easing.done) { camera.center = camera.easing.to; camera.easing = null; }
    },
  };
}

// ── Scenarios ───────────────────────────────────────────────────────────────
const results = [];
const check = (name, cond, detail = "") => results.push([name, !!cond, detail]);
const RUN = 60000; // longer than any itinerary, so "then nothing else happens" is real

{
  const h = harness();
  h.api.armTour();
  h.tick(T.TOUR_LEAD_MS + T.TOUR_TRAVEL_MS);
  const firstVisible = h.api.state().pins;
  h.tick(T.TOUR_DWELL_MS + T.TOUR_TRAVEL_MS);
  const secondVisible = h.api.state().pins;
  h.tick(RUN);
  const pins = h.pins();
  check("plays every stop, in itinerary order", pins.length >= 3, pins.join(" → "));
  check("keeps only the current tour pin visible",
    firstVisible === 1 && secondVisible === 1,
    `first=${firstVisible}, second=${secondVisible}`);
  check("clears tour pins on natural finish", h.api.state().pins === 0);
  check("resumes the idle spin on natural finish",
    h.log.filter((l) => l === "startSpin").length === 1);
  // The globe returns to the equator inside the rotation now, so there is no
  // second ease between the last caption and the spin — the thing to assert
  // here is that nothing sits in between them at all.
  check("nothing comes between the last caption and the rotation",
    h.log.filter((l) => ["fitGlobe", "startSpin"].includes(l)).join(" → ") === "fitGlobe → startSpin",
    h.log.filter((l) => ["fitGlobe", "startSpin"].includes(l)).join(" → "));
  check("leaves no timer running afterwards", h.pending() === 0);
}

{
  // The lead-in bug: dismissed before the tour was ever "active".
  const h = harness();
  h.api.armTour();
  h.tick(500);
  h.api.stopSpin(); // a drag, half a second in
  h.tick(RUN);
  check("interaction during the lead-in cancels it outright",
    h.log.filter((l) => l.startsWith("ease")).length === 0 && h.pins().length === 0,
    h.log.join(", ") || "silent");
  check("…and cancels the pending lead-in timer", h.pending() === 0);
}

{
  // The latch bug: the tour must remain interruptible after it starts.
  const h = harness();
  h.api.armTour();
  h.tick(midTravel(2)); // one pin down, mid-ease toward the second
  const before = h.pins().length;
  h.api.stopSpin();
  h.tick(RUN);
  check("interaction mid-flight freezes it", h.pins().length === before && before >= 1,
    `${before} pin(s) shown, then stopped`);
  check("…clears the visible tour pin immediately", h.api.state().pins === 0);
  check("…cancels the camera ease in flight rather than letting it land",
    h.log.includes("STOP"));
  check("…does NOT resume the spin — a grabbed globe stays still",
    !h.log.includes("startSpin"));
  check("…and orphans no timers", h.pending() === 0);
}

{
  const h = harness();
  h.api.armTour(); h.api.armTour(); h.api.armTour();
  h.tick(RUN);
  const once = harness();
  once.api.armTour();
  once.tick(RUN);
  check("re-arming cannot double-run it", h.pins().length === once.pins().length);
}

{
  const h = harness();
  h.api.stopSpin(); // something claimed the camera before the globe settled
  h.api.armTour();
  h.tick(RUN);
  check("never starts if something already outranked it", h.pins().length === 0);
}

{
  const h = harness({ reduced: true });
  h.api.armTour();
  h.tick(RUN);
  check("prefers-reduced-motion: no camera motion, no cycling captions, no tour pins",
    h.log.filter((l) => l.startsWith("ease")).length === 0 &&
      h.pins().length === 0 &&
      h.api.state().pins === 0);
}

{
  const h = harness({ ambientTour: false });
  h.api.armTour();
  h.tick(RUN);
  check("off on every surface but home", h.log.length === 0 && h.api.state().pins === 0);
}

{
  const h = harness({ hidden: true });
  h.api.armTour();
  h.tick(RUN);
  check("a hidden tab holds position instead of burning the itinerary",
    h.pins().length === 0 && h.pending() === 1);
}

{
  const h = harness({ subsetActive: true });
  h.api.armTour();
  h.tick(RUN);
  check("stands down if an answer landed during the lead-in", h.pins().length === 0);
}

{
  // The reason this gate exists: a screenshot of the tour captioning "Mustique"
  // over a South America that was still an unpainted black shape.
  const h = harness({ slowTiles: true });
  h.api.armTour();
  h.tick(T.TOUR_LEAD_MS + 200); // lead-in elapsed; the tiles have not arrived
  check("will not take the camera over an unpainted map",
    h.log.filter((l) => l.startsWith("ease")).length === 0,
    "waits instead of flying");
  check("…and is parked on the map's own idle signal, not abandoned",
    h.tilesPending() === 1);
  h.landTiles();
  h.tick(RUN);
  check("…then plays in full once the tiles land", h.pins().length >= 3,
    h.pins().join(" → "));

  // The backstop. A slow connection must DELAY the tour, never strand it: past
  // the cap a partly-painted map still beats a tour that silently never runs.
  const stalled = harness({ slowTiles: true });
  stalled.api.armTour();
  stalled.tick(T.TOUR_LEAD_MS + 200);
  const beforeCap = stalled.log.filter((l) => l.startsWith("ease")).length;
  stalled.tick(RUN); // tiles never land
  check("gives up waiting after the cap rather than stranding the tour",
    beforeCap === 0 && stalled.pins().length >= 3,
    `${stalled.pins().length} pins, tiles never landed`);
}

{
  // Tiles present at boot, then slow again for the leg in flight.
  const h = harness();
  h.api.armTour();
  h.tick(RUN);
  const full = h.pins().length;
  check("a fast map is not slowed down by the gate", full >= 3, `${full} pins`);
}

{
  // Interaction while a leg is parked waiting on tiles.
  const h = harness({ slowTiles: true });
  h.api.armTour();
  h.tick(3000);
  h.api.stopSpin();
  h.landTiles();
  h.tick(RUN);
  check("interaction during a tile wait still cancels it", h.pins().length === 0);
  check("…and leaves nothing pending", h.pending() === 0);
}

// ── The stage hand-off ──────────────────────────────────────────────────────
// The Guide is hidden until "bevvip:tour-ended" arrives, which makes a missed
// broadcast a page with no way to type. Every exit must announce, exactly once.
{
  const cases = {
    "runs to completion": (h) => h.tick(RUN),
    "interrupted mid-flight": (h) => { h.tick(midTravel(2)); h.api.stopSpin(); h.tick(RUN); },
    "interrupted during the lead-in": (h) => { h.tick(400); h.api.stopSpin(); h.tick(RUN); },
    "dismissed before it armed": (h) => { h.api.stopSpin(); h.tick(RUN); },
    "an answer landed first": (h) => h.tick(RUN),
    "tiles never arrive": (h) => h.tick(RUN),
  };
  const opts = {
    "an answer landed first": { subsetActive: true },
    "tiles never arrive": { slowTiles: true },
  };
  for (const [name, drive] of Object.entries(cases)) {
    const h = harness(opts[name] || {});
    h.api.armTour();
    drive(h);
    check(`announces the stage is free — ${name}`, h.ended.length === 1,
      `${h.ended.length} broadcast(s)`);
  }

  // The surfaces where no tour was ever going to play must announce too, or
  // the Guide waits on a beat that never comes.
  for (const [name, o] of Object.entries({
    "ambient tour disabled": { ambientTour: false },
    "flat projection": { projGlobe: false },
    "prefers-reduced-motion": { reduced: true },
  })) {
    const h = harness(o);
    h.api.armTour();
    h.tick(RUN);
    check(`announces immediately when no tour will play — ${name}`,
      h.ended.length === 1, `${h.ended.length} broadcast(s)`);
  }

  // Ordering: on a healthy run the hand-off comes AFTER the last caption and
  // after the spin resumes — the beat the Guide is meant to slide in on.
  const h = harness();
  h.api.armTour();
  h.tick(RUN);
  const spinIdx = h.log.lastIndexOf("startSpin");
  const lastPin = h.log.map((l, i) => (l.startsWith("pin ") ? i : -1)).filter((i) => i >= 0).pop();
  check("hands off after the last pin, on the resumed spin",
    spinIdx > lastPin && h.ended.length === 1);
}

/*
 * ── The hand-off itself ────────────────────────────────────────────────────
 *
 * The complaint that produced this section: "a pretty strong jump at the end of
 * the auto tour to the globe spinning". It was a velocity discontinuity, and it
 * was invisible to every check here, because all of them assert about ORDER —
 * which function ran after which — and none about MOTION. The globe swung back
 * to the equator over 1.1 seconds (about 34°/s), decelerated to a dead stop,
 * and then rotation began at a constant 2.7°/s: two easings meeting at zero
 * with an order of magnitude between their speeds.
 *
 * There is no way to see that in a log of call names. So play the frames.
 */
{
  const FPS = 60;
  const MS = 1000 / FPS;
  /** Run the spin from a starting camera for `secs`, returning every frame. */
  const play = (lat, secs) => {
    const frames = [];
    let c = { lng: 0, lat };
    for (let i = 0; i < secs * FPS; i++) {
      c = spinFrame(c, i * MS);
      frames.push(c);
    }
    return frames;
  };

  // 52° is the steepest the tour can leave: tourLat clamps there, and the last
  // stop (Rocky Mountaineer, 51.2°N) is the one that gets near it.
  /** Degrees of arc a frame covers, per second — what the eye actually reads. */
  const speeds = (frames, lat0) =>
    frames.map((f, i) => {
      const prev = i ? frames[i - 1] : { lng: 0, lat: lat0 };
      return Math.hypot(Math.abs(f.lng - prev.lng), Math.abs(f.lat - prev.lat)) * FPS;
    });

  // 52° is the steepest the tour can leave: tourLat clamps there, and the last
  // stop (Rocky Mountaineer, 51.2°N) is the one that gets near it.
  const run = play(52, 14);
  const lats = run.map((f) => f.lat);
  const sp = speeds(run, 52);
  const steadySpin = 0.045 * FPS; // 2.7°/s, the resting rotation

  // ── THE COMPLAINT, as a number ────────────────────────────────────────────
  // The globe is meant to be TURNING and righting itself as an aside. Both the
  // old settle (34°/s, braking to a stop) and the first attempt at levelling
  // inside the spin (39.7°/s, measured on the real page) had the correction
  // running an order of magnitude faster than the rotation it was hiding
  // inside — which is what reads as a jump however continuous the maths is.
  check("the return to the equator never outruns the rotation it rides in",
    Math.max(...sp) < steadySpin * 3.5,
    `peaks at ${Math.max(...sp).toFixed(1)}°/s against a ${steadySpin.toFixed(1)}°/s spin`);

  check("…and starts from a standstill, not at full speed",
    sp[0] < Math.max(...sp) / 20,
    `first frame ${sp[0].toFixed(3)}°/s`);

  // No frame may be faster than the one before it once the ease-in is done:
  // the whole motion decelerates onto the resting spin and never surges.
  const easeFrames = Math.ceil((900 / 1000) * FPS);
  check("…decelerating from there, never surging",
    sp.slice(easeFrames + 1).every((v, i) => v <= sp[easeFrames + i] + 1e-9),
    `${sp[easeFrames].toFixed(2)} → ${sp[sp.length - 1].toFixed(2)}°/s`);

  const level = lats.findIndex((l) => Math.abs(l) < 1);
  check("the globe does reach level, from the steepest tilt the tour can leave",
    level > 0 && level / FPS < 12,
    level > 0 ? `${(level / FPS).toFixed(1)}s from 52°` : "never levels");

  check("…monotonically, never overshooting the equator",
    lats.every((l, i) => l >= 0 && (i === 0 || l <= lats[i - 1])),
    `${lats[lats.length - 1].toFixed(3)}° at rest`);

  const step = (i) => Math.abs(run[i].lng - run[i - 1].lng);
  const steady = step(run.length - 1);
  check("the rotation reaches full speed, so the globe is not left crawling",
    Math.abs(steady - 0.045) < 1e-6,
    `${steady.toFixed(4)}°/frame`);

  const west = run.every((f, i) => i === 0 || f.lng < run[i - 1].lng);
  check("…always westward, at a rate that never drops",
    west && run.slice(2).every((_, i) => step(i + 2) >= step(i + 1) - 1e-9),
    west ? "monotone" : "reverses");

  // A globe already at rest must not be nudged off the equator by the levelling.
  const flat = play(0, 1);
  check("a level globe is left level",
    flat.every((f) => f.lat === 0),
    `${flat[flat.length - 1].lat}`);

  // Southern latitudes level the same way. The Antarctic stop is at -64.5°,
  // and an interruption there leaves the camera below the equator.
  const south = play(-46, 14).map((f) => f.lat);
  check("a southern tilt levels the same way",
    south.every((l) => l <= 0) && Math.abs(south[south.length - 1]) < 1,
    `${south[south.length - 1].toFixed(3)}°`);
}

rmSync(OUT, { recursive: true, force: true });

console.log("\nAmbient auto-tour\n");
let bad = false;
for (const [name, ok, detail] of results) {
  console.log(`  ${ok ? " ok  " : "FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) bad = true;
}
console.log(bad ? "\nFAILED\n" : "\nThe tour yields to the visitor at every point\n");
process.exit(bad ? 1 : 0);

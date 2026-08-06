/**
 * "See on the map": does the trip you asked for survive the page load?
 *
 * A card in The Guide links to /atlas/<type>?ids=<one id>. The collection page
 * filters to that one trip and dispatches `bevvip:atlas-route` to trace it and
 * frame it. Whether that works depends entirely on WHEN the dispatch lands
 * relative to the globe's boot — and both orderings really happen, because the
 * collection's feed and the Mapbox chunk race each other on every load.
 *
 * Two failures lived in that race, and neither is visible to the type checker:
 *
 *   1. A route dispatched before style.load was dropped on the floor — the
 *      listener bailed on `if (!api) return` with no queue behind it, where the
 *      sibling plot path has had one since it shipped. Result: no route.
 *
 *   2. The resting state (fitGlobe + idle spin) is reached TWICE during boot —
 *      once at style.load, once when the region feed resolves — and the second
 *      pass landed AFTER the route had been traced, throwing the camera back
 *      out to the whole planet and starting it spinning. Same for the 750ms
 *      poster reveal, which starts the spin on a timer set before the route
 *      existed. Result: a spinning globe with your voyage somewhere on it.
 *
 * Rather than restate the logic, this slices the real functions out of
 * AtlasShell.tsx, compiles them, and drives them through both orderings.
 *
 *   node scripts/verify-atlas-handoff.mjs
 */

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = mkdtempSync(join(tmpdir(), "handoff-"));
const SRC = readFileSync(join(ROOT, "components/AtlasShell.tsx"), "utf8");

// ── Slice the real thing ────────────────────────────────────────────────────
/** A whole declaration, matched by braces rather than by line count. */
function block(open) {
  const a = SRC.indexOf(open);
  if (a < 0) throw new Error(`verify-atlas-handoff: could not find "${open}" — did it get renamed?`);
  let depth = 0;
  for (let i = SRC.indexOf("{", a); i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) return SRC.slice(a, i + 1);
  }
  throw new Error(`verify-atlas-handoff: unbalanced braces after "${open}"`);
}

const routeDetail = block("export interface RouteDetail {");
const focusStop = block("export interface FocusStop {");
const spinWhenRevealed = block("function spinWhenRevealed()");
const stopSpin = block("function stopSpin()");
const restAndIdle = block("function restAndIdle()");
const flushPendingRoute = block("function flushPendingRoute()");
const applyRoute = block("const applyRoute = (detail: RouteDetail | undefined) =>");
const onRoute = block("const onRoute = (e: Event) =>");

// The listener half and the boot half live in two different effects of the same
// component and talk through refs, so the harness supplies the refs and the
// three latches the boot effect owns. Everything with a decision in it is real.
const DEPS = [
  "haltSpin", "cancelSettle", "abortTour", "startSpin", "armTour", "fitGlobe",
  "tourActive", "focusRouteRef", "applyRouteRef", "pendingRouteRef", "routeReadyRef",
];

writeFileSync(
  join(OUT, "arrival.ts"),
  `/* eslint-disable */\n` +
    `${focusStop}\n${routeDetail}\n` +
    `export function makeArrival(dep: any) {\n` +
    `  const { ${DEPS.join(", ")} } = dep;\n` +
    // The three pieces of boot state these functions close over. `revealed` /
    // `onRevealed` mirror the map.on("load") handler: the poster crossfade
    // parks the spin for 750ms and fires it later, which is the whole reason
    // spinWhenRevealed re-checks at fire time.
    `  let cameraClaimed = false;\n` +
    `  let ready = false;\n` +
    `  let revealed = false;\n` +
    `  let onRevealed: (() => void) | null = null;\n` +
    `${spinWhenRevealed}\n${stopSpin}\n${restAndIdle}\n${flushPendingRoute}\n` +
    `${applyRoute};\n  applyRouteRef.current = applyRoute;\n${onRoute};\n` +
    `  return {\n` +
    `    onRoute, restAndIdle, flushPendingRoute,\n` +
    // style.load's ready block, in its published order: mark ready, boot the
    // data (which rests the globe), then hand the camera to any queued trip.
    `    becomeReady() { ready = true; routeReadyRef.current = true; },\n` +
    `    reveal() { revealed = true; onRevealed?.(); onRevealed = null; },\n` +
    `    claimed: () => cameraClaimed,\n` +
    `  };\n` +
    `}\n`,
);

execFileSync("npx", [
  "tsc", join(OUT, "arrival.ts"),
  "--outDir", OUT, "--module", "esnext", "--target", "es2022",
  "--moduleResolution", "bundler", "--lib", "es2022,dom", "--skipLibCheck",
], { cwd: ROOT, stdio: "inherit" });

const { makeArrival } = await import(pathToFileURL(join(OUT, "arrival.js")).href);

// ── A fake globe ────────────────────────────────────────────────────────────
function harness() {
  const log = [];
  const refs = {
    focusRouteRef: {
      current: {
        paint: (legs) => log.push(`paint:${legs.length}`),
        clear: () => log.push("clear"),
        fit: () => log.push("fit"),
        mark: (stops) => log.push(`mark:${stops.length}`),
        flatten: () => false,
      },
    },
    applyRouteRef: { current: null },
    pendingRouteRef: { current: null },
    routeReadyRef: { current: false },
  };
  const api = makeArrival({
    ...refs,
    tourActive: false,
    haltSpin: () => log.push("haltSpin"),
    cancelSettle: () => {},
    abortTour: () => {},
    startSpin: () => log.push("startSpin"),
    armTour: () => log.push("armTour"),
    fitGlobe: () => log.push("fitGlobe"),
  });
  return {
    ...api,
    log,
    queued: () => refs.pendingRouteRef.current,
    /** The Mapbox module has resolved but the first style has not loaded. */
    send: (detail) => api.onRoute({ detail }),
    saw: (...steps) => steps.every((s) => log.includes(s)),
    at: (s) => log.indexOf(s),
  };
}

const TRIP = {
  legs: [{ mode: "primary", coordinates: [[12.3, 45.4], [14.5, 40.8], [15.6, 38.1]] }],
  stops: [{ name: "Venice", at: [12.3, 45.4], day: 1 }, { name: "Naples", at: [14.5, 40.8], day: 4 }],
  fit: true,
};
const HOVER = { ...TRIP, fit: false };
// A hotel: nothing to trace, but a selection to mark and a place to fly to.
const PLACE = { legs: [], stops: [{ name: "Hotel de Russie", at: [12.48, 41.91] }], fit: true, fitPoints: [[12.48, 41.91]] };

// ── Scenarios ───────────────────────────────────────────────────────────────
const results = [];
const check = (name, cond, detail = "") => results.push([name, !!cond, detail]);

{
  // The race this whole file exists for: the trip arrives BEFORE the globe can
  // draw it. Every step below used to be a separate way to lose it.
  const h = harness();
  h.send(TRIP);
  check("a trip that beats style.load is held, not dropped", !!h.queued(), h.log.join(" → "));
  check("…and nothing is painted onto an unloaded style", h.log.length === 0, h.log.join(" → "));

  h.restAndIdle(); // boot pass 1, from bootData
  check("the resting globe stands down while a trip is queued",
    !h.saw("fitGlobe") && !h.saw("startSpin"), h.log.join(" → "));

  h.becomeReady();
  h.flushPendingRoute();
  check("the held trip is traced once the style loads", h.saw("paint:1"), h.log.join(" → "));
  check("…and framed", h.saw("fit"), h.log.join(" → "));
  check("…and the queue is emptied", !h.queued());

  h.reveal(); // the poster crossfade, 750ms behind the first paint
  check("the poster reveal does not spin a claimed camera",
    !h.saw("startSpin"), h.log.join(" → "));

  h.restAndIdle(); // boot pass 2, when the region feed resolves
  check("the region feed does not rest the globe on top of the trip",
    !h.saw("fitGlobe") && !h.saw("startSpin"), h.log.join(" → "));
}

{
  // The other ordering: the globe wins the race. Painting works either way —
  // what used to break here is the SECOND rest, a second or two later.
  const h = harness();
  h.becomeReady();
  h.send(TRIP);
  check("a trip arriving after style.load traces immediately",
    h.saw("paint:1") && h.saw("fit") && !h.queued(), h.log.join(" → "));
  h.reveal();
  h.restAndIdle();
  check("neither the reveal nor the late rest reclaims the camera",
    !h.saw("startSpin") && !h.saw("fitGlobe"), h.log.join(" → "));
}

{
  // The regression this fix must not cause: an ordinary browse, no deep link.
  // Nothing has claimed the camera, so the globe rests and idles as always.
  const h = harness();
  h.becomeReady();
  h.restAndIdle();
  check("a plain collection page still rests the globe", h.saw("fitGlobe"));
  h.reveal();
  check("…and still idle-spins once revealed",
    h.saw("startSpin") && h.saw("armTour"), h.log.join(" → "));
  check("…in that order", h.at("fitGlobe") < h.at("startSpin"));
}

{
  // A pointer crossing the card grid while the map boots must not quietly
  // downgrade the trip the traveller actually asked for to a hover preview,
  // which paints without ever moving the camera.
  const h = harness();
  h.send(TRIP);
  h.send(HOVER);
  check("a hover preview cannot demote a queued deep link", h.queued()?.fit === true);
  h.becomeReady();
  h.flushPendingRoute();
  check("…so the deep-linked trip is still framed", h.saw("fit"), h.log.join(" → "));
}

{
  // …but a real click (which fits) still wins over an earlier preview.
  const h = harness();
  h.send(HOVER);
  h.send(TRIP);
  check("a click still replaces a queued hover", h.queued()?.fit === true);
}

{
  // Releasing a pin dispatches an empty clear. Before the map exists there is
  // nothing to clear, and queueing it would strand the globe: restAndIdle would
  // stand down for a payload that paints nothing.
  const h = harness();
  h.send({ legs: [] });
  check("an empty clear before boot is not queued", !h.queued());
  h.restAndIdle();
  check("…so the globe still comes to rest", h.saw("fitGlobe") && !h.saw("startSpin"));
}

{
  // Hotels have no route. The selection and the flight to it still have to
  // survive the same race.
  const h = harness();
  h.send(PLACE);
  h.restAndIdle();
  h.becomeReady();
  h.flushPendingRoute();
  check("a routeless selection (a hotel) survives the race",
    h.saw("mark:1") && h.saw("fit"), h.log.join(" → "));
  h.reveal();
  check("…and holds the camera too", !h.saw("startSpin"), h.log.join(" → "));
}

// ── The wiring the slices can't see ─────────────────────────────────────────
// Everything above runs the real decisions; these two assert the real ORDER
// they are called in, which lives in the boot block and is exactly what
// regressed before.
{
  const readyBlock = block("if (!ready) {");
  const order = ["ready = true", "routeReadyRef.current = true", "bootData()", "flushPendingRoute()"];
  let at = -1;
  const inOrder = order.every((s) => {
    const i = readyBlock.indexOf(s);
    if (i <= at) return false;
    at = i;
    return true;
  });
  check("style.load flushes a queued trip, after bootData rests the globe", inOrder, readyBlock.replace(/\s+/g, " "));

  const bootData = block("async function bootData()");
  const rests = (bootData.match(/restAndIdle\(\)/g) ?? []).length;
  check("both of bootData's resting points go through restAndIdle", rests >= 2, `${rests} call sites`);
}

// ── Report ──────────────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? `\n    ${detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

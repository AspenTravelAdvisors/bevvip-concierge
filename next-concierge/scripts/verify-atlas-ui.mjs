/**
 * The atlas, driven in a browser: does clicking a card still draw a route?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * On 2026-08-25 a change shipped to main that broke the collection atlases
 * outright — clicking a card showed no route and froze the globe, in every
 * browser. `npm run verify` was clean. The type checker was clean. A production
 * build was clean. Every unit check the repo had went on passing, because all
 * of them call the atlas's own functions directly and the faults were in what
 * those functions handed to MAPBOX (a camera option present and undefined,
 * which Mapbox reads as `+undefined` — NaN — and which kills its transform),
 * and in which of them the app wires to which.
 *
 * Nothing that only ever calls `flyRoute()` can catch that. So this loads the
 * real page in a real browser with a stubbed renderer (scripts/mapbox-stub.js)
 * and does what a traveller does: hover a card, click it, press the route
 * control. Then it asserts the three things that were broken —
 *
 *   1. a route is painted,
 *   2. the camera is only ever asked to go somewhere finite,
 *   3. the flight reaches its calls, and is not killed by a repaint.
 *
 * ── Running it ─────────────────────────────────────────────────────────────
 *
 *   npm run build && node scripts/verify-atlas-ui.mjs
 *
 * It starts `next start` on a spare port itself, so it needs a build present.
 * With no build, or no Chromium, it SKIPS rather than fails — this is a check
 * you want in front of a human before a deploy, not a gate that blocks a
 * data-only change on a machine with no browser.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.ATLAS_UI_PORT || 3311);
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
/**
 * Collections with routes to trace. Hotels and villas have neither.
 *
 * ATLAS_UI_TYPES narrows the run to a subset — five collections in a real
 * browser takes minutes on a busy machine, and when a change only touches one
 * of them, waiting for the other four is time spent not checking anything.
 */
const TYPES = (process.env.ATLAS_UI_TYPES || "jet,yacht,worldcruise,cruise,train,safari")
  .split(",").map((t) => t.trim()).filter(Boolean);

const skip = (why) => { console.log(`\nAtlas UI\n\n  SKIPPED — ${why}\n`); process.exit(0); };

if (!existsSync(join(ROOT, ".next"))) skip("no build present (run `npm run build` first)");
if (!existsSync(CHROMIUM)) skip(`no Chromium at ${CHROMIUM} (set CHROMIUM_PATH)`);

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  skip("playwright-core is not installed");
}

const stub = readFileSync(join(ROOT, "scripts/mapbox-stub.js"), "utf8");

// ── The server ──────────────────────────────────────────────────────────────
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: ROOT, stdio: "ignore" });
const stopServer = () => { try { server.kill("SIGTERM"); } catch { /* already gone */ } };
process.on("exit", stopServer);
process.on("SIGINT", () => { stopServer(); process.exit(130); });

const up = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/atlas/jet`);
      if (r.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};
if (!(await up())) { stopServer(); skip(`the server never came up on :${PORT}`); }

// ── Drive it ────────────────────────────────────────────────────────────────
const results = [];
const check = (name, cond, detail = "") => results.push([name, !!cond, detail]);

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });

for (const type of TYPES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  // Mapbox is replaced wholesale; everything else on its host is stubbed empty.
  // Playwright gives precedence to the LAST matching route, so order matters.
  await page.route("**/api.mapbox.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/mapbox-gl-js/**/mapbox-gl.css", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route("**/mapbox-gl-js/**/mapbox-gl.js", (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: stub }));

  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));

  await page.goto(`http://localhost:${PORT}/atlas/${type}`, { waitUntil: "domcontentloaded", timeout: 90000 });

  /*
   * WAIT for a card, do not sleep for one. The cards are client-rendered from a
   * fetched itinerary, and a fixed pause is a race that this machine loses
   * whenever the server is cold or the box is busy — which produced a full
   * sheet of "no card with a route" against a build that was working perfectly.
   * A check that cries wolf is worse than no check: it teaches you to disbelieve
   * it, which is exactly how the breakage this file exists to catch got shipped.
   */
  const card = page.locator(".atlas-card").filter({ has: page.locator(".ac-fly") }).first();
  try {
    await card.waitFor({ state: "attached", timeout: 60000 });
  } catch {
    check(`${type}: a card offers its route control`, false, "no card with a route inside 60s");
    await ctx.close();
    continue;
  }
  // …and a beat more for the map to finish booting behind them.
  await page.waitForTimeout(2500);
  await card.scrollIntoViewIfNeeded();

  // Hover previews the route…
  await card.hover();
  await page.waitForTimeout(1200);
  const hovered = await page.evaluate(() => (window.__stub.sources["focus-route"]?.features || []).length);
  check(`${type}: hovering a card traces its route`, hovered > 0, `${hovered} features`);

  // …and clicking pins it.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(300);
  await card.click({ position: { x: 30, y: 20 } });
  await page.waitForTimeout(2000);
  const clicked = await page.evaluate(() => ({
    feats: (window.__stub.sources["focus-route"]?.features || []).length,
    stops: (window.__stub.sources["focus-stops"]?.features || []).length,
    layers: Object.keys(window.__stub.layers).filter((l) => l.startsWith("fr_")).length,
  }));
  check(`${type}: clicking a card draws the route and its calls`,
    clicked.feats > 0 && clicked.stops > 0 && clicked.layers >= 3,
    `${clicked.feats} legs, ${clicked.stops} stops, ${clicked.layers} route layers`);

  /*
   * THE TRANSPOSITION. Does the route go where the journey goes?
   *
   * Every check above this one passes with a route drawn on the wrong
   * continent, and one shipped: the safari atlas's routeFor() read the feed's
   * `ll: [lat, lng]` and handed it to Mapbox, which reads [lng, lat]. The
   * Namibia circuit — Windhoek, Sossusvlei, Walvis Bay — drew as a triangle in
   * the Atlantic off Cape Verde. Features were painted, layers existed, the
   * camera got finite numbers, and every assertion was green.
   *
   * The two sources are independently derived, which is what makes this
   * checkable at all: `focus-stops` comes from the ADAPTED offering, where
   * fromLatLngPair() has already converted, and `focus-route` comes from the
   * collection's own routeFor(). A route is drawn THROUGH its stops, so their
   * bounding boxes must overlap. Transposing either one pulls them apart by
   * tens of degrees — far more than any tolerance a legitimately lofted arc
   * needs.
   *
   * Longitudes are folded back into [-180, 180] first: unrollLine() puts a
   * Tokyo → Los Angeles crossing at +241° on purpose, and comparing that to a
   * stop at -119° would fail a correct route.
   */
  const geo = await page.evaluate(() => {
    const fold = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
    const bbox = (pts) => pts.reduce(
      (b, [x, y]) => [Math.min(b[0], fold(x)), Math.min(b[1], y), Math.max(b[2], fold(x)), Math.max(b[3], y)],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const coords = (fc) => (fc?.features || []).flatMap((f) => {
      const g = f.geometry || {};
      if (g.type === "Point") return [g.coordinates];
      if (g.type === "LineString") return g.coordinates;
      if (g.type === "MultiLineString") return g.coordinates.flat();
      return [];
    }).filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    const route = coords(window.__stub.sources["focus-route"]);
    const stops = coords(window.__stub.sources["focus-stops"]);
    if (route.length < 2 || !stops.length) return null;
    const r = bbox(route);
    const s = bbox(stops);
    // Pad by a degree: a stop sitting exactly on the end of a straight route
    // gives a zero-width box on one axis, and floating point should not decide
    // whether two edges touch.
    const overlaps = r[0] <= s[2] + 1 && s[0] <= r[2] + 1 && r[1] <= s[3] + 1 && s[1] <= r[3] + 1;
    return { overlaps, route: r.map((n) => Math.round(n)), stops: s.map((n) => Math.round(n)) };
  });
  check(`${type}: the route is drawn where the journey goes`,
    geo ? geo.overlaps : false,
    geo ? `route [${geo.route}] vs stops [${geo.stops}]` : "no route or stops to compare");

  /*
   * THE FREEZE. Mapbox reads camera options with `'pitch' in options`, so a key
   * present and undefined becomes NaN and the transform dies — the map stops
   * rendering and the route never appears on it. Nothing throws; the page just
   * stops. So the assertion is on the options themselves.
   */
  const badCam = await page.evaluate(() => {
    const bad = [];
    for (const c of window.__stub.calls) {
      for (const [k, v] of Object.entries(c)) {
        if (k === "kind" || k === "url") continue;
        if (v === undefined) bad.push(`${c.kind}.${k}=undefined`);
        if (typeof v === "number" && !Number.isFinite(v)) bad.push(`${c.kind}.${k}=${v}`);
        if (Array.isArray(v) && v.some((n) => !Number.isFinite(n))) bad.push(`${c.kind}.${k}=[${v}]`);
      }
    }
    return bad;
  });
  check(`${type}: the camera is never asked for an undefined or NaN value`,
    badCam.length === 0, badCam.slice(0, 3).join(", ") || "clean");

  // The flight: it must reach its calls, and survive the repaints that browsing
  // generates along the way.
  await page.evaluate(() => { window.__stub.calls = []; window.__stub.labels = []; });
  await card.locator(".ac-fly").click();
  await page.waitForTimeout(12000);
  const flown = await page.evaluate(() => ({
    moves: window.__stub.calls.filter((c) => c.kind === "jumpTo").length,
    named: (window.__stub.labels || []).length,
  }));
  check(`${type}: the route control flies it, calling at its stops`,
    flown.moves > 30 && flown.named >= 2,
    `${flown.moves} camera writes, ${flown.named} calls named`);

  check(`${type}: nothing threw`, crashes.length === 0, crashes[0] || "clean");
  await ctx.close();
}

await browser.close();
stopServer();

console.log("\nAtlas UI\n");
let bad = false;
for (const [name, ok, detail] of results) {
  console.log(`  ${ok ? " ok  " : "FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) bad = true;
}
console.log(bad ? "\nFAILED\n" : "\nHovering, clicking and flying all still work on every collection\n");
process.exit(bad ? 1 : 0);

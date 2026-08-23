#!/usr/bin/env node
/**
 * verify-photoreal — the engine switch, checked where a browser cannot help.
 *
 *   npm run verify:photoreal
 *
 * The photoreal engine can only be SEEN with a Google Maps key, live tiles and
 * a real browser. Three things about it can be proved without any of that, and
 * they are the three that break silently:
 *
 *   1. THE CAMERA HANDOFF. Switching engines has to preserve "where I am and
 *      how close I am", or the choice reads as a teleport and nobody uses it
 *      twice. Mapbox measures closeness in zoom levels over a tile pyramid and
 *      Google 3D measures it in metres of range, so the conversion is real
 *      arithmetic, and arithmetic can be checked. A round trip that drifts is
 *      the bug the traveller would report as "it jumps".
 *
 *   2. PIN PARITY. A pin's colour means a category, and the categories are
 *      defined in public/maps/hotel/index.html. This reads that table out of
 *      the standalone atlas and compares it to the port, so the two engines
 *      cannot quietly come to disagree about what a colour means — the same
 *      technique verify-hotels.mjs uses for the filter predicate.
 *
 *   3. THE DEEP-LINK CONTRACT. `engine=3d` has to survive a round trip through
 *      the parser and the writer, and `?hotel=` must NOT route back to the
 *      iframe it used to — that regression would look like nothing at all in
 *      review and would put the property view back behind a tab.
 */

import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, ".photoreal-build");

let failures = 0;
const ok = (m) => console.log(`  ok  ${m}`);
const check = (cond, m, detail) => {
  if (cond) return ok(m);
  failures++;
  console.log(`  FAIL ${m}${detail ? `\n       ${detail}` : ""}`);
};

/* Compile the real modules, so this tests shipped code rather than a second
   copy of it that could drift. Same approach as verify-adapters.mjs. */
function build() {
  rmSync(BUILD, { recursive: true, force: true });
  /*
   * A throwaway tsconfig rather than command-line flags.
   *
   * ask.ts imports AskSource from "@/lib/analytics" as a TYPE — tsc erases it,
   * but still resolves the alias while checking, and `--paths` is only legal
   * inside a config file. This compile is deliberately separate from the app's
   * own tsconfig because it emits plain ESM for Node, so it carries its own.
   */
  const cfgPath = join(ROOT, ".photoreal-tsconfig.json");
  writeFileSync(
    cfgPath,
    JSON.stringify({
      compilerOptions: {
        target: "es2020",
        module: "esnext",
        moduleResolution: "bundler",
        skipLibCheck: true,
        baseUrl: ".",
        paths: { "@/*": ["./*"] },
        outDir: ".photoreal-build",
        // No rootDir: the type-only "@/lib/analytics" import pulls a file from
        // outside lib/atlas into the program, and tsc rejects that under a
        // rootDir even though it emits nothing for it. The output layout is
        // read back by path below, so it does not need pinning.
        rootDir: ".",
      },
      files: ["lib/atlas/google3d.ts", "lib/atlas/ask.ts"],
    }),
  );
  try {
    execFileSync("npx", ["tsc", "-p", ".photoreal-tsconfig.json"], { cwd: ROOT, stdio: "inherit" });
  } finally {
    rmSync(cfgPath, { force: true });
  }
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : [],
    );
  for (const file of walk(BUILD)) {
    // The type-only import is erased by tsc; strip any survivor so Node never
    // has to resolve the alias at run time.
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(/^import .*"@\/lib\/analytics";?$/gm, ""),
    );
  }
}
build();

const g3d = await import(pathToFileURL(join(BUILD, "lib/atlas/google3d.js")).href);
const ask = await import(pathToFileURL(join(BUILD, "lib/atlas/ask.js")).href);

console.log("\nCamera handoff — Mapbox zoom ⇄ photoreal range");

/*
 * The round trip must land back where it started.
 *
 * Every zoom from a whole-earth view to a single rooftop, at latitudes from the
 * equator to the Arctic — a hotel atlas has properties at both, and the
 * conversion is latitude-dependent (a degree of longitude is 111 km at the
 * equator and 55 km at 60°N), which is exactly the kind of term that is easy to
 * drop and hard to notice.
 */
let worstDrift = 0;
let compared = 0;
let clamped = 0;
for (const zoom of [1, 2.45, 4, 5.5, 8.5, 12, 15, 17, 19]) {
  for (const lat of [0, 25.14, 39.19, 51.5, 69.65, -33.9]) {
    for (const height of [380, 640, 900, 1400]) {
      const range = g3d.rangeFromZoom(zoom, lat, height);
      /*
       * The wide end is CLAMPED, on purpose, and a clamped value cannot round
       * trip — that is what a clamp is. A whole-planet Mapbox view converts to
       * a camera some 130,000 km out, which is well past geostationary and far
       * outside anything the 3D element will accept; the standalone atlas opens
       * its own world view at 15,000 km for the same reason. So the round trip
       * is checked over the domain the conversion actually governs, and the
       * clamp is checked separately below.
       */
      if (range >= 20_000_000 - 1 || range <= 121) {
        clamped++;
        continue;
      }
      compared++;
      worstDrift = Math.max(worstDrift, Math.abs(g3d.zoomFromRange(range, lat, height) - zoom));
    }
  }
}
check(
  worstDrift < 1e-6,
  `zoom → range → zoom is lossless across ${compared} camera combinations (worst drift ${worstDrift.toExponential(2)})`,
);
check(clamped > 0, `…and ${clamped} whole-planet cameras were clamped rather than sent to Google as-is`);
check(
  g3d.rangeFromZoom(0, 0, 1400) <= 20_000_000 && g3d.rangeFromZoom(22, 0, 380) >= 120,
  "the clamp holds at both extremes",
);

// Closer must mean a smaller range, at every latitude. A sign error here would
// invert the switch: choose 3D over a hotel and arrive in orbit.
let monotonic = true;
for (const lat of [0, 45, -60]) {
  for (let z = 2; z < 19; z++) {
    if (!(g3d.rangeFromZoom(z + 1, lat, 640) < g3d.rangeFromZoom(z, lat, 640))) monotonic = false;
  }
}
check(monotonic, "a higher zoom always yields a closer camera");

// Sanity on the absolute scale: the property-zoom end of the range should land
// near the standalone atlas's own DETAIL_RANGE, which is what "close enough to
// read a building" means in this product.
const atProperty = g3d.rangeFromZoom(17, 39.19, 640);
check(
  atProperty > 400 && atProperty < 4000,
  `zoom 17 lands at property scale (${Math.round(atProperty)} m, against DETAIL_RANGE ${g3d.DETAIL_RANGE})`,
);
// Opening a card is an inspection, not a browse: the property arrival has to be
// meaningfully closer than the detail seam, and still outside the distance where
// the photogrammetry mesh stops holding up (~150-300 m) or a tall property would
// overrun the frame.
check(
  g3d.INSPECT_RANGE < g3d.DETAIL_RANGE / 2,
  `an opened property is inspected well inside detail range (${g3d.INSPECT_RANGE} m vs ${g3d.DETAIL_RANGE} m)`,
);
check(
  g3d.INSPECT_RANGE >= 250 && g3d.INSPECT_RANGE <= 800,
  `…and stays where the mesh still reads as a building (${g3d.INSPECT_RANGE} m)`,
);
check(
  g3d.tiltForRange(g3d.DETAIL_TILT, g3d.INSPECT_RANGE) === g3d.DETAIL_TILT,
  "the inspection camera keeps full tilt, so the fly-in is not flattened on arrival",
);

// A whole-planet Mapbox view must not ask Google for a camera inside the earth.
const atGlobe = g3d.rangeFromZoom(1, 0, 640);
check(atGlobe > 1_000_000, `globe zoom stays a globe (${Math.round(atGlobe / 1000)} km out)`);

console.log("\nTilt easing — ported from the standalone atlas");
check(g3d.tiltForRange(90, 2600) === g3d.DETAIL_TILT, "full tilt at detail range");
check(g3d.maxTiltForRange(4200) === g3d.DETAIL_TILT, "…and right up to where the easing starts");
check(g3d.maxTiltForRange(220000) === 0, "flat by 220 km, exactly as the original");
check(g3d.maxTiltForRange(12_000_000) === 0, "and beyond it");
let tiltMonotonic = true;
let prev = Infinity;
for (let r = 4200; r <= 220000; r += 2000) {
  const t = g3d.maxTiltForRange(r);
  if (t > prev + 1e-9) tiltMonotonic = false;
  prev = t;
}
check(tiltMonotonic, "the easing never tilts back up as the camera pulls out");
check(g3d.tiltForRange(NaN, 2600) === 0, "a NaN tilt resolves to flat, not to NaN");

console.log("\nPin parity — categories mean the same thing on both engines");
const legacy = readFileSync(join(ROOT, "public/maps/hotel/index.html"), "utf8");
const catBlock = legacy.match(/const CAT_COLORS\s*=\s*\{([\s\S]*?)\}\s*;/);
check(!!catBlock, "found CAT_COLORS in the standalone atlas");
if (catBlock) {
  const table = {};
  for (const [, name, hex] of catBlock[1].matchAll(/"([^"]+)"\s*:\s*"(#[0-9a-fA-F]{3,8})"/g)) {
    table[name] = hex;
  }
  const names = Object.keys(table);
  check(names.length >= 8, `read ${names.length} categories from the original`);
  const wrong = names.filter((n) => g3d.categoryColor(n).toLowerCase() !== table[n].toLowerCase());
  check(
    wrong.length === 0,
    "every category keeps its original colour",
    wrong.map((n) => `${n}: ${g3d.categoryColor(n)} vs ${table[n]}`).join("\n       "),
  );
  const fallback = legacy.match(/catColor\s*=\s*c\s*=>\s*CAT_COLORS\[c\]\s*\|\|\s*"(#[0-9a-fA-F]{3,8})"/);
  check(
    !!fallback && g3d.categoryColor("Something Unmapped").toLowerCase() === fallback[1].toLowerCase(),
    "an unrecognised category falls back to the original's accent",
  );
}

console.log("\nAsk The Guide — the question carries what the screen knows");
const text = ask.askAboutProperty({
  name: "The Little Nell",
  city: "Aspen",
  region: "Colorado",
  country: "United States",
  category: "Mountain / Ski",
  program: "Virtuoso",
  benefits: ["Room Upgrade on arrival", "Daily breakfast for two", "$100 property credit"],
});
for (const fragment of ["The Little Nell", "Aspen", "United States", "mountain / ski", "Virtuoso"]) {
  check(text.includes(fragment), `the question names ${fragment}`);
}
check(text.includes("Room Upgrade on arrival"), "…and the benefits already on screen");
check(/\?$|\?\s|\?\)/.test(text), "it is phrased as a question, not a record dump");
// The regression this replaced: title + URL and nothing else.
const bare = ask.askAboutProperty({ name: "Some Hotel" });
check(
  bare.startsWith("Tell me about Some Hotel.") && bare.length > 60,
  "a property with no facts still asks something answerable",
);
const pin = ask.askAboutPin({ name: "Jumeirah Burj Al Arab", region: "Dubai" });
check(pin.includes("Dubai") && pin.includes("VIP"), "a pin's lighter question still places it");

console.log("\nDeep links — engine=3d, and the iframe that must not come back");
const params = readFileSync(join(ROOT, "lib/atlas/adapters/params.ts"), "utf8");
check(/engine: "photoreal" \| null/.test(params), "the view intent carries an engine");
check(
  params.includes('p.set("engine", "3d")') && params.includes('p.delete("engine")'),
  "…written on the way out, and cleared before it is rewritten",
);
check(
  /\["3d", "photoreal"\]/.test(params),
  "…and read on the way in, in both spellings",
);
check(
  !/SHARE_STYLES\s*=\s*\[[^\]]*photoreal/.test(params),
  "the engine is NOT a basemap — a trip through 3D must not forget the traveller's basemap",
);

const route = readFileSync(join(ROOT, "app/atlas/[type]/page.tsx"), "utf8");
const decommentRoute = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check(
  !/qs\.has\("hotel"\)\s*\?\s*undefined/.test(decommentRoute),
  "a `?hotel=` link no longer falls through to the iframe",
);
check(
  /const legacy = qs\.get\("legacy"\) === "1"/.test(route),
  "…and `?legacy=1` still reaches the standalone page",
);

/* Comments are stripped before asserting on source: this file DESCRIBES the
   window.open it replaced, and a check that cannot tell an explanation from a
   call is a check that fails for being well documented. */
const decomment = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/*
 * Two regressions that shipped once and were invisible in review, because both
 * failure modes look exactly like "the map just sits there".
 */
const collection = decomment(readFileSync(join(ROOT, "components/AtlasCollection.tsx"), "utf8"));
const engineEffect = collection.slice(collection.indexOf("const arrivedEngine"));
check(
  /if \(!parsed\) return;[\s\S]{0,120}arrivedEngine\.current = true/.test(engineEffect),
  "the arriving engine is not latched before the deep link has been parsed",
  "`parsed` is null until the collection's feed resolves; latching on that first" +
    " render silently drops ?engine=3d and ?hotel=",
);

const shellSrc = decomment(readFileSync(join(ROOT, "components/AtlasShell.tsx"), "utf8"));
check(
  /applyRouteTo3D\(detail\);[\s\S]{0,200}routeReadyRef\.current/.test(shellSrc),
  "a re-framing reaches the photoreal camera, ahead of the Mapbox readiness gate",
  "filters, searches and deep links dispatch bevvip:atlas-route; if only the" +
    " Mapbox path consumes it, the 3D camera never follows the results",
);
check(
  /threeRef\.current\?\.fit\(\s*features\.map/.test(shellSrc),
  "a plotted Guide shortlist frames the photoreal camera too",
);

const hotel = decomment(readFileSync(join(ROOT, "components/AtlasHotel.tsx"), "utf8"));
check(
  !/window\.open\(/.test(hotel),
  "the card's property action opens in place rather than in a new tab",
);
check(/photoreal/.test(hotel) && /detailFor/.test(hotel), "hotels offer the engine and the dossier");

const legacyPanel = readFileSync(join(ROOT, "public/maps/hotel/index.html"), "utf8");
check(
  /id="d-ask"/.test(legacyPanel) && /ATLAS_ASK/.test(legacyPanel),
  "the standalone property panel finally has the ask its own intro tour promises",
);

rmSync(BUILD, { recursive: true, force: true });

console.log(
  failures === 0
    ? "\nPhotoreal engine, camera handoff and ask contract all hold\n"
    : `\n${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);

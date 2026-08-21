/**
 * Hotel adapter parity — the same discipline the five retired atlases got.
 *
 * The hotel atlas diverges from the shared grammar in five ways, every one of
 * which is invisible until a shared link comes back wrong:
 *
 *   1. the visible Region axis is a curated country → macro-region table, not
 *      the feed's 604-value `region` nor its 7-value `marqueeRegion`
 *   2. the UI axis labelled "Brand / Program" is the `program` param; `brand`
 *      is a separate deep-link-only axis
 *   3. `ids=` HIGHLIGHTS, it does not filter
 *   4. `q` is a raw substring over name+city+region+country — not tokenised,
 *      and `country` is a facet rather than a search term
 *   5. `region=caribbean` also matches by country alias
 *
 * The right side below is transcribed from public/maps/hotel/index.html's
 * matches(). Both sides then run over randomly generated filter states.
 *
 *   node scripts/verify-hotels.mjs
 */

import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, ".adapters-build");

/**
 * Compile the REAL adapters, the same way verify-adapters.mjs does, so this
 * exercises shipped code rather than a second copy that could drift.
 * tsconfig.adapters.json already globs lib/atlas/adapters/*.ts, so hotel.ts and
 * hotel-regions.ts come along without touching it.
 */
rmSync(BUILD, { recursive: true, force: true });
execFileSync("npx", ["tsc", "-p", "tsconfig.adapters.json"], { cwd: ROOT, stdio: "inherit" });
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []);
for (const file of walk(BUILD)) {
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/from "@\/lib\/atlas\/geo"/g, 'from "../geo.js"')
    // dates.js is CommonJS and outside tsconfig.adapters.json's rootDir, so
    // tsc never copies it here — point at the real file. Keep in step with
    // verify-adapters.mjs and verify-deeplinks.mjs, which repeat this block.
    .replace(/from "@\/lib\/atlas\/dates"/g, 'from "../../lib/atlas/dates.js"')
    .replace(/from "(\.\/[a-zA-Z-]+)"/g, 'from "$1.js"'));
}

const mod = (n) => import(pathToFileURL(join(BUILD, "adapters", n)).href);
const { adaptHotels, HOTEL_DESCRIPTOR } = await mod("hotel.js");
const { matchesOffering } = await mod("filter.js");
const { macroRegion, CARIBBEAN_COUNTRIES } = await mod("hotel-regions.js");

// --------------------------------------------------------------- source data
const raw = JSON.parse(
  readFileSync(join(ROOT, "public/maps/hotel/hotel-points.json"), "utf8"),
);
const FEATURES = raw.features;
const offerings = adaptHotels(raw);

if (offerings.length !== FEATURES.length) {
  console.error(`FAIL: adapted ${offerings.length} of ${FEATURES.length} features`);
  process.exit(1);
}

// --------------------------------------- ORIGINAL matches(), transcribed 1:1
function matchesRegionAlias(region, p) {
  const r = (region || "").toLowerCase();
  if (r === "caribbean") return CARIBBEAN_COUNTRIES.has((p.country || "").toLowerCase());
  return false;
}
function originalMatches(f, state) {
  const p = f.properties;
  if (state.cats.size && !state.cats.has(p.category)) return false;
  if (state.regions.size && !state.regions.has(macroRegion(p.country))) return false;
  if (state.brands.size && !state.brands.has(p.program)) return false;
  if (state.countries.size && !state.countries.has(p.country)) return false;
  if (state.brand && (p.brand || "").toLowerCase() !== state.brand.toLowerCase()) return false;
  if (state.region &&
      (p.marqueeRegion || "").toLowerCase() !== state.region.toLowerCase() &&
      !matchesRegionAlias(state.region, p)) return false;
  if (state.q) {
    const hay = (p.name + " " + p.city + " " + p.region + " " + p.country).toLowerCase();
    if (hay.indexOf(state.q) < 0) return false;
  }
  return true;
}

// ------------------------------------------------------------------ fixtures
const distinct = (k) => [...new Set(FEATURES.map((f) => f.properties[k]).filter(Boolean))];
const CATS = distinct("category");
const PROGRAMS = distinct("program");
const COUNTRIES = distinct("country");
const BRANDS = distinct("brand");
const MARQUEES = [...distinct("marqueeRegion"), "caribbean", "CARIBBEAN"];
const MACROS = [...new Set(FEATURES.map((f) => macroRegion(f.properties.country)).filter(Boolean))];
const QUERIES = ["", "san", "bali", "beach", "the", "new york", "é", "zzzz", "hotel", "los"];

let seed = 20260730;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const some = (a, max) => {
  const n = Math.floor(rnd() * (max + 1));
  const s = new Set();
  for (let i = 0; i < n; i++) s.add(pick(a));
  return s;
};

// ------------------------------------------------------------------- compare
const TODAY = "2026-07-30";
let comparisons = 0, mismatches = 0;
const seen = new Set();

for (let iter = 0; iter < 700; iter++) {
  const cats = some(CATS, 2);
  const regions = some(MACROS, 2);
  const programs = some(PROGRAMS, 2);
  const countries = some(COUNTRIES, 2);
  const brand = rnd() < 0.25 ? pick(BRANDS) : null;
  const region = rnd() < 0.25 ? pick(MARQUEES) : null;
  const q = rnd() < 0.5 ? pick(QUERIES) : "";
  // ids is exercised on purpose: it must NOT narrow anything.
  const ids = rnd() < 0.3 ? new Set([pick(FEATURES).properties.id]) : new Set();

  const orig = { cats, regions, brands: programs, countries, brand, region, q: q.toLowerCase() };
  const ours = {
    brands: new Set(), vessels: new Set(), months: new Set(),
    ids, regions, excludedRegions: new Set(), stop: null, stopRole: "any",
    terms: [], rawQuery: q,
    facets: {
      category: cats, program: programs, country: countries,
      brand: brand ? new Set([brand]) : new Set(),
      marqueeRegion: region ? new Set([region]) : new Set(),
    },
  };

  for (let i = 0; i < FEATURES.length; i++) {
    const a = originalMatches(FEATURES[i], orig);
    const b = matchesOffering(offerings[i], ours, HOTEL_DESCRIPTOR, TODAY);
    comparisons++;
    if (a !== b) {
      mismatches++;
      if (mismatches <= 5) {
        console.error(`MISMATCH ${FEATURES[i].properties.id} original=${a} ours=${b}`);
        console.error("  props:", JSON.stringify(FEATURES[i].properties));
        console.error("  state:", JSON.stringify({ ...orig, cats: [...cats], regions: [...regions],
          brands: [...programs], countries: [...countries] }));
      }
    }
  }
  seen.add([...cats, ...regions, brand, region, q].join("|"));
}

// ------------------------------------------- the divergences, asserted directly
const checks = [];
const idOf = (i) => offerings[i];
const base = () => ({
  brands: new Set(), vessels: new Set(), months: new Set(), ids: new Set(),
  regions: new Set(), excludedRegions: new Set(), stop: null, stopRole: "any",
  terms: [], rawQuery: "", facets: {},
});

// 1. ids highlights, never filters
{
  const st = base();
  st.ids = new Set([offerings[0].id]);
  const kept = offerings.filter((o) => matchesOffering(o, st, HOTEL_DESCRIPTOR, TODAY)).length;
  checks.push(["ids= keeps the whole field visible", kept === offerings.length, `kept ${kept}`]);
}
// 2. the visible region axis is macro, so it is small
{
  const macros = new Set(offerings.flatMap((o) => o.regions));
  checks.push(["region axis is macro-sized", macros.size <= 12, `${macros.size} regions`]);
}
// 3. program vs brand are different axes
{
  const st = base();
  st.facets = { program: new Set([PROGRAMS[0]]) };
  const byProgram = offerings.filter((o) => matchesOffering(o, st, HOTEL_DESCRIPTOR, TODAY)).length;
  const st2 = base();
  st2.facets = { brand: new Set([PROGRAMS[0]]) };
  const byBrand = offerings.filter((o) => matchesOffering(o, st2, HOTEL_DESCRIPTOR, TODAY)).length;
  checks.push([`program "${PROGRAMS[0]}" is not the brand axis`, byProgram > 0 && byBrand === 0,
    `program=${byProgram} brand=${byBrand}`]);
}
// 4. substring search, not tokenised: a partial word must still match
{
  const st = base();
  st.rawQuery = "ondo";  // London, Ondo… a token matcher would return nothing
  const n = offerings.filter((o) => matchesOffering(o, st, HOTEL_DESCRIPTOR, TODAY)).length;
  checks.push(["partial-word search matches (substring, not tokens)", n > 0, `${n} hits`]);
}
// 5. region=caribbean picks up the country alias
{
  const st = base();
  st.facets = { marqueeRegion: new Set(["caribbean"]) };
  const n = offerings.filter((o) => matchesOffering(o, st, HOTEL_DESCRIPTOR, TODAY)).length;
  const marqueed = FEATURES.filter((f) => (f.properties.marqueeRegion || "") === "caribbean").length;
  checks.push(["region=caribbean includes the country alias", n > marqueed,
    `${n} vs ${marqueed} by marquee alone`]);
}
// 6. trip length is not a hotel axis
{
  // A stay's length is the traveller's choice, not a property of the hotel, so
  // HOTEL_DESCRIPTOR turns the filter off — a `minDays=` arriving on a link
  // (from a journeys atlas, or by hand) must be inert here rather than
  // emptying the map. See supportsDurationFilter.
  const st = base();
  st.minDays = 7;
  st.maxDays = 10;
  const kept = offerings.filter((o) => matchesOffering(o, st, HOTEL_DESCRIPTOR, TODAY)).length;
  checks.push(["trip-length bounds are inert for hotels", kept === offerings.length, `kept ${kept}`]);
}
// 7. every hotel is placeable and none were dropped
{
  const located = offerings.filter((o) => o.stops[0]?.at).length;
  checks.push(["every hotel has a coordinate", located === offerings.length, `${located}`]);
}

console.log(`\n${comparisons.toLocaleString()} comparisons over ${seen.size} distinct filter states`);
console.log(`${mismatches} mismatches\n`);
let bad = mismatches > 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}  (${detail})`);
  if (!ok) bad = true;
}
console.log(bad ? "\nFAILED" : "\nAll hotel parity checks passed");
process.exit(bad ? 1 : 0);

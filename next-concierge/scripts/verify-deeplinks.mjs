#!/usr/bin/env node
/**
 * verify-deeplinks — every param the Leaflet atlases understood still resolves.
 *
 *   npm run verify:deeplinks
 *
 * Complements verify-adapters. That one proves the FILTER agrees with the
 * originals given a state; this one proves the URL still produces that state.
 * Both matter: a perfect predicate fed a mis-parsed link is still a broken
 * shared link, and shared links are the thing D3 must not break.
 *
 * Checks, per collection where applicable:
 *   - region alias tables resolve ("scotland" → BRITAIN), all entries
 *   - findRegionKey falls through alias → exact → substring
 *   - findBrand resolves every real brand by key AND by display name
 *   - unknown region keys are DROPPED rather than passed through
 *   - exRegions skips keys already in regions
 *   - journeys map role `stop` → `visit`; voyages pass roles through verbatim
 *   - `location` resolves fuzzily, `port` only exactly (existing asymmetry)
 *   - toSearchParams → parseDeepLink round-trips to the same state
 */

import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, ".adapters-build");

function build() {
  rmSync(BUILD, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", "tsconfig.adapters.json"], { cwd: ROOT, stdio: "inherit" });
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []);
  for (const f of walk(BUILD)) {
    writeFileSync(f, readFileSync(f, "utf8")
      .replace(/from "@\/lib\/atlas\/geo"/g, 'from "../geo.js"')
      // dates.js is CommonJS and outside tsconfig.adapters.json's rootDir, so
      // tsc never copies it here — point at the real file. Keep in step with
      // verify-adapters.mjs and verify-hotels.mjs, which repeat this block.
      .replace(/from "@\/lib\/atlas\/dates"/g, 'from "../../lib/atlas/dates.js"')
      .replace(/from "(\.\/[a-zA-Z]+)"/g, 'from "$1.js"'));
  }
}
build();

const mod = (n) => import(pathToFileURL(join(BUILD, "adapters", n)).href);
const { parseDeepLink, toSearchParams, findBrand, findRegionKey, REGION_ALIASES } = await mod("params.js");
const { TRAIN_DESCRIPTOR } = await mod("train.js");
const { JET_DESCRIPTOR } = await mod("jet.js");
const { YACHT_DESCRIPTOR } = await mod("yacht.js");
const { WORLDCRUISE_DESCRIPTOR } = await mod("worldcruise.js");
const { CRUISE_DESCRIPTOR } = await mod("cruise.js");

let checks = 0, failures = 0;
const fail = (msg) => { failures++; console.log("    FAIL  " + msg); };
const ok = () => { checks++; };
const expect = (cond, msg) => (cond ? ok() : fail(msg));

/** Build a ParseContext from each atlas's real data. */
function contextFor(collection) {
  if (collection === "cruise") {
    const sail = JSON.parse(readFileSync(join(ROOT, "public/maps/cruise/sailings.json"), "utf8"));
    const idx = {}; (sail.schema || []).forEach((n, i) => { idx[n] = i; });
    const ops = [...new Set(sail.rows.map((r) => r[idx.operator]).filter(Boolean))];
    const regs = [...new Set(sail.rows.map((r) => r[idx.region]).filter(Boolean))];
    const routes = JSON.parse(readFileSync(join(ROOT, "public/maps/cruise/data/itinerary-routes.json"), "utf8")).routes || {};
    const ports = new Set();
    for (const days of Object.values(routes)) for (const d of days) for (const p of d.p || []) if (p[1] != null && p[2] != null) ports.add(p[0]);
    return { brands: ops.map((o) => ({ key: o, short: o })), regions: regs.map((r) => ({ key: r, name: r })), stopNames: [...ports] };
  }
  const raw = JSON.parse(readFileSync(join(ROOT, `public/maps/${collection}/itinerary.json`), "utf8"));
  const brands = Object.entries(raw.BRANDS || {}).map(([key, b]) => ({ key, short: b.short }));
  const regions = Object.entries(raw.REGIONS || {}).map(([key, r]) => ({ key, name: r.name, ab: r.ab }));
  const stopNames = raw.PORTS
    ? Object.keys(raw.PORTS)
    : [...new Set((raw.TRIPS || []).flatMap((t) => (t.itin || []).map((e) => e.n).filter(Boolean)))];
  return { brands, regions, stopNames };
}

const COLLECTIONS = [
  ["train", TRAIN_DESCRIPTOR], ["jet", JET_DESCRIPTOR], ["yacht", YACHT_DESCRIPTOR],
  ["worldcruise", WORLDCRUISE_DESCRIPTOR], ["cruise", CRUISE_DESCRIPTOR],
];

console.log("");
console.log("Deep-link resolution");
console.log("=".repeat(70));

for (const [collection, d] of COLLECTIONS) {
  const ctx = contextFor(collection);
  const before = failures;

  // 1. Every alias in the table resolves to a region this atlas actually has.
  const aliases = REGION_ALIASES[collection] || {};
  const known = new Set(ctx.regions.map((r) => r.key));
  for (const [alias, target] of Object.entries(aliases)) {
    if (!known.has(target)) continue; // alias points at a region this feed dropped
    expect(findRegionKey(alias, ctx.regions, collection) === target,
      `${collection}: alias "${alias}" should resolve to ${target}, got ${findRegionKey(alias, ctx.regions, collection)}`);
  }

  // 2. Every brand resolves by key and by display name.
  for (const b of ctx.brands.slice(0, 30)) {
    expect(findBrand(b.key, ctx.brands) === b.key, `${collection}: brand key "${b.key}" did not resolve`);
    if (b.short) {
      const hit = findBrand(b.short, ctx.brands);
      expect(hit != null, `${collection}: brand name "${b.short}" did not resolve`);
    }
  }

  // 3. Unknown region keys are dropped, not passed through.
  {
    const p = new URLSearchParams({ regions: "NOT_A_REGION," + ctx.regions[0].key });
    const { state } = parseDeepLink(p, d, ctx);
    expect(state.regions.size === 1 && state.regions.has(ctx.regions[0].key),
      `${collection}: unknown region key was not dropped (got ${[...state.regions]})`);
  }

  // 4. exRegions skips anything already included (journeys only).
  if (d.supportsRegionExclusion) {
    const k = ctx.regions[0].key;
    const { state } = parseDeepLink(new URLSearchParams({ regions: k, exRegions: k }), d, ctx);
    expect(state.excludedRegions.size === 0, `${collection}: exRegions should skip an already-included key`);
  } else {
    const k = ctx.regions[0].key;
    const { state } = parseDeepLink(new URLSearchParams({ exRegions: k }), d, ctx);
    expect(state.excludedRegions.size === 0, `${collection}: exRegions must be ignored where unsupported`);
  }

  // 5. Role handling: journeys fold stop→visit and reject junk; voyages pass through.
  {
    const stop = ctx.stopNames[0];
    const mk = (role) => parseDeepLink(new URLSearchParams({ [d.stopParam]: stop, [d.stopRoleParam]: role }), d, ctx).state.stopRole;
    if (d.roles === "journey") {
      expect(mk("stop") === "visit", `${collection}: role "stop" should normalise to "visit", got ${mk("stop")}`);
      expect(mk("start") === "start", `${collection}: role "start" should survive`);
      expect(mk("bogus") === "any", `${collection}: unknown role should fall back to "any", got ${mk("bogus")}`);
    } else {
      expect(mk("embark") === "embark", `${collection}: role "embark" should survive`);
      expect(mk("bogus") === "bogus", `${collection}: voyages pass roles through verbatim, got ${mk("bogus")}`);
    }
  }

  // 6. The location/port asymmetry — fuzzy vs exact — is preserved.
  {
    const stop = ctx.stopNames.find((n) => n && n !== n.toUpperCase()) || ctx.stopNames[0];
    const exact = parseDeepLink(new URLSearchParams({ [d.stopParam]: stop }), d, ctx).state.stop;
    expect(exact === stop, `${collection}: exact ${d.stopParam} "${stop}" should resolve`);
    const shouted = parseDeepLink(new URLSearchParams({ [d.stopParam]: stop.toUpperCase() }), d, ctx).state.stop;
    if (d.stopParam === "location") {
      expect(shouted === stop, `${collection}: location should match case-insensitively`);
    } else {
      expect(shouted === null, `${collection}: port matching is EXACT — uppercase must not resolve`);
    }
  }

  // 7. Round-trip: serialise a populated state and parse it back unchanged.
  {
    const state = {
      brands: new Set([ctx.brands[0].key]),
      vessels: new Set(),
      months: new Set(["2026-07", "2026-08"]),
      ids: new Set(["123", "456"]),
      regions: new Set([ctx.regions[0].key]),
      excludedRegions: new Set(d.supportsRegionExclusion && ctx.regions[1] ? [ctx.regions[1].key] : []),
      stop: ctx.stopNames[0],
      stopRole: d.roles === "journey" ? "start" : "embark",
      terms: [],
    };
    const qs = toSearchParams(state, {}, d);
    const back = parseDeepLink(new URLSearchParams(qs.toString()), d, ctx).state;
    const same = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));
    expect(same(state.brands, back.brands), `${collection}: brands did not round-trip`);
    expect(same(state.months, back.months), `${collection}: months did not round-trip`);
    expect(same(state.ids, back.ids), `${collection}: ids did not round-trip`);
    expect(same(state.regions, back.regions), `${collection}: regions did not round-trip`);
    expect(same(state.excludedRegions, back.excludedRegions), `${collection}: exRegions did not round-trip`);
    expect(back.stop === state.stop, `${collection}: stop did not round-trip`);
    expect(back.stopRole === state.stopRole, `${collection}: stopRole did not round-trip`);
  }

  // 8. brand= / operator= interchangeability.
  {
    const key = ctx.brands[0].key;
    const viaBrand = parseDeepLink(new URLSearchParams({ brand: key }), d, ctx).state.brands;
    const viaOperator = parseDeepLink(new URLSearchParams({ operator: key }), d, ctx).state.brands;
    expect(viaBrand.size === 1, `${collection}: brand= should resolve`);
    expect(viaOperator.size === 1, `${collection}: operator= should resolve (atlases accept either)`);
  }

  console.log(`  ${collection.padEnd(12)} ${failures === before ? "ok" : `${failures - before} FAILURES`}`);
}

console.log("");
console.log(`  ${checks} assertions, ${failures} failures`);
console.log("");
process.exit(failures ? 1 : 0);

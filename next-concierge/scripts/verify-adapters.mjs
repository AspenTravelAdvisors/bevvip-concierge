#!/usr/bin/env node
/**
 * verify-adapters — prove the ported filter reproduces the Leaflet originals.
 *
 *   npm run verify:adapters
 *
 * Left-hand side: the original predicate, transcribed line-for-line out of
 * public/maps/<type>/index.html, run against raw itinerary.json AFTER applying
 * that atlas's own load-time normalisation pass.
 *
 * Right-hand side: lib/atlas/adapters/* — the real shipped code, compiled to
 * ESM — run against the adapted shape.
 *
 * Both get the same randomly generated filter states, drawn from real values in
 * each dataset so the combinations are reachable, and every disagreement is
 * printed with the state that produced it.
 *
 * THE NORMALISATION PASS IS THE POINT. An earlier version of this script fed
 * both sides the raw JSON and reported a clean pass, because both were equally
 * wrong: `TRIPS.forEach((t,i) => …)` in each atlas assigns guideId, populates
 * t.cities from ROUTES (which feed the search haystack), back-fills t.g from
 * the route, and COMPUTES the month keys. Skip it and the comparison is
 * vacuous — for jet it changes 107 of 141 trips.
 */

import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, ".adapters-build");

/** Compile the REAL adapters so this tests shipped code, not a transcription. */
function buildAdapters() {
  rmSync(BUILD, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", "tsconfig.adapters.json"], { cwd: ROOT, stdio: "inherit" });
  // tsc resolves neither the @/ alias nor the .js extensions Node's ESM loader
  // needs. Rewrite in-process so this behaves the same on macOS and Linux.
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []);
  for (const file of walk(BUILD)) {
    writeFileSync(file, readFileSync(file, "utf8")
      .replace(/from "@\/lib\/atlas\/geo"/g, 'from "../geo.js"')
      // dates.js is CommonJS and outside rootDir, so tsc never copies it into
      // the build — point at the real file two levels up instead. Node's ESM
      // loader reads its named exports through cjs-module-lexer, which handles
      // the static `module.exports = { ... }` object it ends with.
      .replace(/from "@\/lib\/atlas\/dates"/g, 'from "../../lib/atlas/dates.js"')
      .replace(/from "(\.\/[a-zA-Z]+)"/g, 'from "$1.js"'));
  }
}
buildAdapters();

const mod = (n) => import(pathToFileURL(join(BUILD, "adapters", n)).href);
const { adaptTrain, TRAIN_DESCRIPTOR } = await mod("train.js");
const { adaptJet, JET_DESCRIPTOR } = await mod("jet.js");
const { adaptYacht, YACHT_DESCRIPTOR } = await mod("yacht.js");
const { adaptWorldCruise, WORLDCRUISE_DESCRIPTOR } = await mod("worldcruise.js");
const { adaptCruise, CRUISE_DESCRIPTOR, correctedRegionName } = await mod("cruise.js");
const { matchesOffering } = await mod("filter.js");
const { searchTerms } = await mod("search.js");

/**
 * Every collection is checked twice, against two "today" values.
 *
 * The real date is the case that ships. But past-dated trips are rejected by
 * BOTH implementations before any other filter runs, so a genuine disagreement
 * on a past trip is invisible — and that is not hypothetical: it hid a real bug
 * where 33 jet trips that name their stops but carry no route geometry were
 * dropped from the stop filter. Every one of them is past-dated today, so the
 * harness reported a clean pass. Running again with an early epoch puts the
 * whole dataset in play, which is what a feed refresh will do anyway.
 */
const TODAYS = [
  { label: "today", iso: new Date().toISOString().slice(0, 10) },
  { label: "epoch", iso: "2000-01-01" },
];

/* ─────────── shared helpers, transcribed from the atlases ─────────── */

const origNorm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const STOP = {
  train: ["the","and","or","of","in","to","for","rail","train","trains","journey","journeys","trip","trips","tour","tours","luxury"],
  jet: ["the","and","or","of","in","to","for","private","jet","jets","journey","journeys","trip","trips","tour","tours","luxury"],
  yacht: ["the","and","or","of","in","to","for","cruise","cruises","yacht","yachts","sailing","sailings","voyage","voyages","ship","trip","trips","luxury"],
  worldcruise: ["the","and","or","of","in","to","for","cruise","cruises","yacht","yachts","sailing","sailings","voyage","voyages","ship","trip","trips","luxury"],
  cruise: ["the","and","or","of","in","to","for","cruise","cruises","expedition","expeditions","sailing","sailings","voyage","voyages","ship","trip","trips"],
};
const origWords = (s, c) => origNorm(s).split(/\s+/).filter((w) => w && !STOP[c].includes(w));

const tripSlug = (s) => String(s || "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const dedupeOrder = (a) => { const s = new Set(); const o = []; for (const v of a) if (v != null && !s.has(v)) { s.add(v); o.push(v); } return o; };

/**
 * The load-time pass, per atlas. Transcribed from `TRIPS.forEach((t,i) => …)`.
 * Note the region rule differs: train back-fills only when g is empty, jet
 * overrides whenever an explicit route exists.
 */
function normalise(collection, raw) {
  const ROUTES = raw.ROUTES || {};
  const TRIPS = (raw.TRIPS || []).map((t) => ({ ...t }));
  TRIPS.forEach((t, i) => {
    t.guideId = collection === "jet" ? "jt_" + i : "rj_" + t.id;
    const key = (t.route && ROUTES[t.route]) ? t.route
      : (ROUTES[tripSlug(t.n)] ? tripSlug(t.n) : null);
    if (key) {
      t.cities = ROUTES[key];
      if (collection === "jet") {
        if (t.route || !t.g) t.g = dedupeOrder(t.cities.map((c) => c.r));
      } else {
        if (!t.g || !t.g.length) t.g = dedupeOrder(t.cities.map((c) => c.r));
      }
    }
    if (t.d) { const p = t.d.split("/"); t.mk = p[2] + "-" + String(+p[0]).padStart(2, "0"); }
    t.mks = (t.mks && t.mks.length) ? t.mks : (t.mk ? [t.mk] : []);
  });
  return TRIPS;
}

function makeOriginal(collection, raw, TRIPS, todayDate) {
  const BRANDS = raw.BRANDS || {};
  const REGIONS = raw.REGIONS || {};

  const isPast = (t) => {
    if (t.onDemand || !t.d) return false;
    const p = t.d.split("/");
    return new Date(+p[2], +p[0] - 1, +p[1]) < todayDate;
  };
  const textMatches = (t, terms) => {
    if (!terms.length) return true;
    const regionNames = (t.g || []).map((k) => REGIONS[k] && REGIONS[k].name).filter(Boolean);
    const cityNames = (t.cities || []).map((c) => c.n).filter(Boolean);
    const itinNames = (t.itin || []).map((e) => e.n).filter(Boolean);
    const hay = origNorm([t.n, BRANDS[t.b] && BRANDS[t.b].short, t.d, ...regionNames, ...cityNames, ...itinNames].filter(Boolean).join(" "));
    return terms.every((term) => hay.includes(term));
  };
  const roles = (t) => {
    const names = [];
    (t.itin || []).forEach((e) => { if (e.n && names[names.length - 1] !== e.n) names.push(e.n); });
    return { start: names[0] || null, end: names.length > 1 ? names[names.length - 1] : null, visits: new Set(names.slice(1, -1)), all: new Set(names) };
  };
  const matchesLocation = (t, location, role) => {
    if (!location) return true;
    const r = roles(t);
    if (role === "start") return r.start === location;
    if (role === "end") return r.end === location;
    if (role === "visit" || role === "stop") return r.visits.has(location);
    return r.all.has(location);
  };
  const prefix = collection === "jet" ? "jt_" : "rj_";

  return (t, s) => {
    if (isPast(t)) return false;
    const ok =
      (!s.brands.size || s.brands.has(t.b)) &&
      (t.onDemand || !s.months.size || (t.mks && t.mks.some((k) => s.months.has(k)))) &&
      (!s.ids.size || s.ids.has(String(t.id)) || s.ids.has(t.guideId) || s.ids.has(prefix + t.id)) &&
      textMatches(t, s.terms);
    if (!ok) return false;
    if (!matchesLocation(t, s.stop, s.stopRole)) return false;
    const g = t.g || [];
    const inc = !s.regions.size || g.some((k) => s.regions.has(k));
    const exc = !s.excludedRegions.size || !g.some((k) => s.excludedRegions.has(k));
    return inc && exc;
  };
}


/**
 * The voyages original, transcribed from public/maps/yacht/index.html.
 * Separate from the journeys one: different past-trip cutoff (startY/M/D parts
 * rather than a US date string), a ship filter, no region exclusion, a haystack
 * that omits port names, and port-name extraction that trims, does NOT collapse
 * consecutive duplicates, and falls back to [from, to].
 */
function makeVoyageOriginal(collection, raw, todayDate) {
  const BRANDS = raw.BRANDS || {};
  const REGIONS = raw.REGIONS || {};
  const prefix = { yacht: "yc_", worldcruise: "wc_", cruise: "cr_" }[collection];

  const isPast = (t) => {
    const td = new Date(todayDate); td.setHours(0, 0, 0, 0);
    return new Date(t.startY, t.startM - 1, t.startD) < td;
  };
  const textMatches = (t, terms) => {
    if (!terms.length) return true;
    const regionNames = (t.g || []).map((k) => REGIONS[k] && REGIONS[k].name).filter(Boolean);
    const hay = origNorm([t.title, BRANDS[t.brand] && BRANDS[t.brand].short, t.ship, t.route, t.from, t.to, ...regionNames].filter(Boolean).join(" "));
    return terms.every((term) => hay.includes(term));
  };
  const portRoles = (t) => {
    let names = [];
    if (t.itin && t.itin.length) names = t.itin.filter((e) => e.n).map((e) => (e.n || "").trim()).filter(Boolean);
    if (!names.length) names = [t.from, t.to].map((n) => (n || "").trim()).filter(Boolean);
    return { embark: names[0] || null, disembark: names.length > 1 ? names[names.length - 1] : null, calls: new Set(names.slice(1, -1)), all: new Set(names) };
  };
  const matchesPort = (t, port, role) => {
    if (!port) return true;
    const r = portRoles(t);
    if (role === "embark") return r.embark === port;
    if (role === "disembark") return r.disembark === port;
    if (role === "call") return r.calls.has(port);
    return r.all.has(port);
  };

  return (t, s) => {
    if (isPast(t)) return false;
    const ok = (!s.brands.size || s.brands.has(t.brand))
      && (!s.vessels.size || s.vessels.has(t.ship))
      && (!s.months.size || s.months.has(t.monthKey))
      && (!s.ids.size || s.ids.has(String(t.id)) || s.ids.has(prefix + t.id))
      && textMatches(t, s.terms)
      && (!s.stop || matchesPort(t, s.stop, s.stopRole));
    if (!ok) return false;
    return !s.regions.size || (t.g || []).some((k) => s.regions.has(k));
  };
}

/* ───────────────────────────── run one collection ──────────────────── */

let seed = 20260729;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const sample = (a, n) => { const c = [...a], o = []; for (let i = 0; i < n && c.length; i++) o.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return o; };

const RUNS = Number(process.env.RUNS || 4000);
let totalMismatch = 0;

function run(collection, adapt, descriptor, queries, today, family = "journey") {
  const raw = JSON.parse(readFileSync(join(ROOT, `public/maps/${collection}/itinerary.json`), "utf8"));
  const TRIPS = family === "voyage" ? (raw.TRIPS || []) : normalise(collection, raw);
  const origMatches = family === "voyage"
    ? makeVoyageOriginal(collection, raw, new Date(today.iso + "T00:00:00"))
    : makeOriginal(collection, raw, TRIPS, new Date(today.iso + "T00:00:00"));
  const offerings = adapt(raw);

  // Pair by position: jet has no ids, so index is the only stable join.
  if (offerings.length !== TRIPS.length) {
    console.log(`  ${collection}: adapter returned ${offerings.length} of ${TRIPS.length} trips`);
    totalMismatch++;
  }

  const BRANDS = [...new Set(TRIPS.map((t) => (family === "voyage" ? t.brand : t.b)).filter(Boolean))];
  const REGIONS = Object.keys(raw.REGIONS || {});
  const MONTHS = [...new Set(family === "voyage" ? TRIPS.map((t) => t.monthKey).filter(Boolean) : TRIPS.flatMap((t) => t.mks || []))];
  const STOPS = [...new Set(TRIPS.flatMap((t) => (t.itin || []).map((e) => e.n).filter(Boolean).concat([t.from, t.to].filter(Boolean))))];
  const IDALIAS = family === "voyage" ? TRIPS.map((t) => String(t.id)) : TRIPS.map((t) => t.guideId);
  const ROLES = family === "voyage" ? ["any", "embark", "disembark", "call", "", "bogus"] : ["any", "start", "end", "stop", "visit", "", "bogus"];

  let comparisons = 0, mismatches = 0;
  const examples = [];

  for (let i = 0; i < RUNS; i++) {
    const s = {
      brands: new Set(rnd() < 0.45 ? sample(BRANDS, 1 + Math.floor(rnd() * 3)) : []),
      months: new Set(rnd() < 0.45 ? sample(MONTHS, 1 + Math.floor(rnd() * 4)) : []),
      ids: new Set(rnd() < 0.2 ? sample(IDALIAS, 1 + Math.floor(rnd() * 3)) : []),
      regions: new Set(rnd() < 0.5 ? sample(REGIONS, 1 + Math.floor(rnd() * 3)) : []),
      excludedRegions: new Set(family === "voyage" ? [] : (rnd() < 0.3 ? sample(REGIONS, 1 + Math.floor(rnd() * 2)) : [])),
      vessels: new Set(family === "voyage" && rnd() < 0.35 ? sample([...new Set(TRIPS.map((t) => t.ship).filter(Boolean))], 1 + Math.floor(rnd() * 2)) : []),
      stop: rnd() < 0.35 ? pick(STOPS) : null,
      stopRole: pick(ROLES),
      q: pick(queries),
      country: pick(["", "South Africa", "United Kingdom", "Peru", "Japan", "Italy"]),
    };
    const terms = searchTerms(s.q, s.country, collection);
    const origState = { ...s, terms };
    const portState = { ...s, terms };

    for (let k = 0; k < TRIPS.length; k++) {
      const o = offerings[k];
      if (!o) { mismatches++; continue; }
      const a = origMatches(TRIPS[k], origState);
      const b = matchesOffering(o, portState, descriptor, today.iso);
      comparisons++;
      if (a !== b) {
        mismatches++;
        if (examples.length < 6) {
          examples.push(
            `${collection} #${k} "${(TRIPS[k].n || "").slice(0, 38)}" original=${a} port=${b}\n` +
            `        brands=[${[...s.brands]}] months=[${[...s.months]}] ids=[${[...s.ids]}]\n` +
            `        regions=[${[...s.regions]}] ex=[${[...s.excludedRegions]}] stop=${JSON.stringify(s.stop)} role=${JSON.stringify(s.stopRole)} q=${JSON.stringify(s.q)}`);
        }
      }
    }
  }

  console.log(`  ${collection.padEnd(11)} ${today.label.padEnd(6)} ${String(TRIPS.length).padStart(4)} trips  ` +
    `${String(offerings.filter((o) => o.stops.length).length).padStart(4)} with stops  ` +
    `${String(offerings.filter((o) => o.onDemand).length).padStart(3)} on-demand  ` +
    `${comparisons.toLocaleString().padStart(9)} comparisons  ` +
    (mismatches ? `${mismatches.toLocaleString()} MISMATCHES` : "0 mismatches"));
  for (const e of examples) console.log("      " + e);
  totalMismatch += mismatches;
}


/**
 * The cruise original, transcribed from public/maps/cruise/{index.html,loader.js}.
 * Columnar source, operator instead of brand, scalar rewritten region, ISO-string
 * past cutoff, and a port set built only from GEOCODED stops.
 */
function loadCruise() {
  const sail = JSON.parse(readFileSync(join(ROOT, "public/maps/cruise/sailings.json"), "utf8"));
  const meta = JSON.parse(readFileSync(join(ROOT, "public/maps/cruise/atlas-meta.json"), "utf8"));
  const routes = JSON.parse(readFileSync(join(ROOT, "public/maps/cruise/data/itinerary-routes.json"), "utf8"));
  const idx = {}; (sail.schema || []).forEach((n, i) => { idx[n] = i; });
  const ROUTES = routes.routes || {};
  const sailings = (sail.rows || []).map((row) => {
    const g = (n) => (idx[n] == null ? undefined : row[idx[n]]);
    const name = String(g("name") ?? "");
    return {
      id: g("id"), operator: g("operator"), name, ship: g("ship") || "",
      start: g("start") || null, nights: g("nights"),
      region: correctedRegionName(String(g("region") ?? ""), name),
      monthKey: g("start") ? String(g("start")).slice(0, 7) : null,
    };
  });
  const stopsOf = (s) => {
    const days = ROUTES[String(s.id)];
    if (!days || !days.length) return [];
    const out = [];
    for (const day of days) {
      const geo = (day.p || []).filter((p) => p[1] != null && p[2] != null);
      for (const p of geo) out.push(p[0]);
    }
    return out;
  };
  return { sailings, meta, sail, routes, stopsOf };
}

function makeCruiseOriginal(ctx, todayIso) {
  const { stopsOf } = ctx;
  const textMatches = (s, terms) => {
    if (!terms.length) return true;
    const hay = origNorm([s.name, s.operator, s.ship, s.region].filter(Boolean).join(" "));
    return terms.every((t) => hay.includes(t));
  };
  const portRoles = (s) => {
    const names = stopsOf(s);
    return { embark: names[0] || null, disembark: names.length > 1 ? names[names.length - 1] : null, calls: new Set(names.slice(1, -1)), all: new Set(names) };
  };
  const matchesPort = (s, port, role) => {
    if (!port) return true;
    const r = portRoles(s);
    if (role === "embark") return r.embark === port;
    if (role === "disembark") return r.disembark === port;
    if (role === "call") return r.calls.has(port);
    return r.all.has(port);
  };
  return (s, st) => {
    if (!(s.start >= todayIso)) return false;   // NB: null start fails this
    const ok = (!st.brands.size || st.brands.has(s.operator))
      && (!st.months.size || st.months.has(s.monthKey))
      && (!st.ids.size || st.ids.has(String(s.id)) || st.ids.has("cr_" + s.id))
      && (!st.stop || matchesPort(s, st.stop, st.stopRole))
      && (!st.vessels.size || st.vessels.has(s.ship))
      && textMatches(s, st.terms);
    if (!ok) return false;
    return !st.regions.size || st.regions.has(s.region);
  };
}

function runCruise(today) {
  const ctx = loadCruise();
  const { sailings } = ctx;
  const origMatches = makeCruiseOriginal(ctx, today.iso);
  const offerings = adaptCruise(ctx.sail, ctx.meta, ctx.routes);

  const OPS = [...new Set(sailings.map((s) => s.operator).filter(Boolean))];
  const REGS = [...new Set(sailings.map((s) => s.region).filter(Boolean))];
  const MONTHS = [...new Set(sailings.map((s) => s.monthKey).filter(Boolean))];
  const SHIPS = [...new Set(sailings.map((s) => s.ship).filter(Boolean))];
  const PORTS = [...new Set(sailings.flatMap((s) => ctx.stopsOf(s)))].slice(0, 400);
  const ROLES = ["any", "embark", "disembark", "call", "", "bogus"];
  const Q = ["", "antarctica", "silversea", "galapagos", "arctic", "expedition", "luxury", "kimberley", "zzzz"];

  let comparisons = 0, mismatches = 0; const examples = [];
  const RUNS_C = Math.max(200, Math.floor(RUNS / 8)); // 3,542 sailings — fewer states, same coverage
  for (let i = 0; i < RUNS_C; i++) {
    const st = {
      brands: new Set(rnd() < 0.45 ? sample(OPS, 1 + Math.floor(rnd() * 3)) : []),
      vessels: new Set(rnd() < 0.35 ? sample(SHIPS, 1 + Math.floor(rnd() * 2)) : []),
      months: new Set(rnd() < 0.45 ? sample(MONTHS, 1 + Math.floor(rnd() * 4)) : []),
      ids: new Set(rnd() < 0.2 ? sample(sailings.map((s) => String(s.id)), 1 + Math.floor(rnd() * 3)) : []),
      regions: new Set(rnd() < 0.5 ? sample(REGS, 1 + Math.floor(rnd() * 3)) : []),
      excludedRegions: new Set(),
      stop: rnd() < 0.35 ? pick(PORTS) : null,
      stopRole: pick(ROLES),
      q: pick(Q), country: "",
    };
    const terms = searchTerms(st.q, st.country, "cruise");
    for (let k = 0; k < sailings.length; k++) {
      const a = origMatches(sailings[k], { ...st, terms });
      const b = matchesOffering(offerings[k], { ...st, terms }, CRUISE_DESCRIPTOR, today.iso);
      comparisons++;
      if (a !== b) {
        mismatches++;
        if (examples.length < 6) examples.push(`cruise #${k} "${sailings[k].name.slice(0, 38)}" original=${a} port=${b} stop=${JSON.stringify(st.stop)} role=${JSON.stringify(st.stopRole)} q=${JSON.stringify(st.q)} regions=[${[...st.regions]}]`);
      }
    }
  }
  console.log(`  ${"cruise".padEnd(11)} ${today.label.padEnd(6)} ${String(sailings.length).padStart(4)} trips  ${String(offerings.filter((o) => o.stops.length).length).padStart(4)} with stops    0 on-demand  ${comparisons.toLocaleString().padStart(9)} comparisons  ${mismatches ? mismatches.toLocaleString() + " MISMATCHES" : "0 mismatches"}`);
  for (const e of examples) console.log("      " + e);
  totalMismatch += mismatches;
}

console.log("");
console.log("Adapter parity — all five collections");
console.log("=".repeat(78));
console.log(`  ${RUNS.toLocaleString()} random filter states per collection, vs the Leaflet original`);
console.log("");
for (const today of TODAYS) {
  run("train", adaptTrain, TRAIN_DESCRIPTOR, ["", "scotland", "rovos", "belmond", "luxury", "train", "orient express", "africa", "2026", "edinburgh", "zzzz"], today);
  run("jet", adaptJet, JET_DESCRIPTOR, ["", "italy", "four seasons", "aman", "tokyo", "jet", "luxury", "2026", "napa", "zzzz"], today);
  run("yacht", adaptYacht, YACHT_DESCRIPTOR, ["", "riviera", "four seasons", "ritz", "aman", "nice", "caribbean", "med", "yacht", "zzzz"], today, "voyage");
  run("worldcruise", adaptWorldCruise, WORLDCRUISE_DESCRIPTOR, ["", "world", "cunard", "oceania", "vista", "miami", "sydney", "grand", "2027", "zzzz"], today, "voyage");
  runCruise(today);
}
console.log("");
console.log(totalMismatch ? `  ${totalMismatch.toLocaleString()} TOTAL MISMATCHES` : "  All collections agree with the Leaflet originals.");
console.log("");
process.exit(totalMismatch ? 1 : 0);

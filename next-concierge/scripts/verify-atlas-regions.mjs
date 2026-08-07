#!/usr/bin/env node
/**
 * verify-atlas-regions — no collection may tag a trip with a region its stops
 * are nowhere near.
 *
 *   npm run verify:atlas-regions
 *
 * This exists because the Region filter is the one filter a traveller reads as a
 * promise about the world. Two real bugs motivated it:
 *
 *   · the expedition feed's "Norway, Fjords & Coast" bucket is keyed on the word
 *     "fjord", so Chilean Patagonia, Greenland and the Alaskan Inside Passage
 *     were all filed under Norway. Fixed by the region overlay
 *     (scripts/build-cruise-regions.mjs), which this script re-checks.
 *   · two Ritz-Carlton Baltic sailings (Stockholm ↔ Copenhagen) were tagged MED,
 *     "Western Mediterranean & Rivieras". Fixed in data/atlas/yacht.
 *
 * HOW IT JUDGES. Each stop is placed by its own port name and coordinates
 * (scripts/port-region.mjs) — the ground truth, independent of any region tag.
 * A trip fails when MORE THAN HALF its placed stops fall outside every region it
 * carries. The bar is deliberately at "mostly wrong", not "perfectly clean": a
 * genuine two-region itinerary (Greenland → Labrador) and a repositioning
 * crossing are both legitimate, and calling those errors would make the check
 * noise. What it catches is a trip in the wrong hemisphere.
 *
 * ALLOW is the per-collection translation from that atlas's own region keys to
 * the canonical names the classifier returns. Widen an entry when a region
 * legitimately spans more ground than listed; do not widen it to silence a real
 * mis-tag.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { portRegion } from "./port-region.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"));

/** region key → the canonical regions it may legitimately contain. */
const ALLOW = {
  yacht: {
    MED: ["Mediterranean", "Western Europe & Iberia"],
    ADRIATIC: ["Mediterranean"],
    AEGEAN: ["Mediterranean"],
    CENTRALMED: ["Mediterranean"],
    ATLANTIC: ["Atlantic Islands", "Western Europe & Iberia", "Mediterranean", "Caribbean & Bermuda", "Africa & Indian Ocean"],
    CARIB: ["Caribbean & Bermuda", "US Rivers & Coast", "Central America & Panama"],
    CENTRALAM: ["Central America & Panama", "Caribbean & Bermuda", "US Rivers & Coast", "Baja California"],
    ALASKA: ["Alaska & Yukon", "US Rivers & Coast", "Canada & New England"],
    POLY: ["Hawaii & Tahiti", "Australia, NZ & South Pacific"],
    EASTASIA: ["Asia & Mekong"],
    SEASIA: ["Asia & Mekong", "Australia, NZ & South Pacific"],
    NEUROPE: ["Northern Europe & British Isles", "Arctic", "Norway, Fjords & Coast", "Western Europe & Iberia"],
    REDSEA: ["Africa & Indian Ocean", "Mediterranean", "Asia & Mekong"],
  },
  worldcruise: {
    CARIB: ["Caribbean & Bermuda", "US Rivers & Coast"],
    CAMER: ["Central America & Panama", "Caribbean & Bermuda", "Baja California"],
    SAMER: ["Amazon & South America", "Patagonia & Chilean Fjords"],
    ANTARCTIC: ["Antarctica", "Patagonia & Chilean Fjords"],
    NAMEAST: ["Canada & New England", "US Rivers & Coast", "Great Lakes"],
    NAMWEST: ["US Rivers & Coast", "Alaska & Yukon", "Baja California", "Canada & New England"],
    HAWAII: ["Hawaii & Tahiti"],
    PACIFIC: ["Hawaii & Tahiti", "Australia, NZ & South Pacific"],
    MED: ["Mediterranean", "Western Europe & Iberia"],
    WEUROPE: ["Western Europe & Iberia", "Northern Europe & British Isles", "Atlantic Islands", "Mediterranean"],
    NEUROPE: ["Northern Europe & British Isles", "Norway, Fjords & Coast", "Arctic"],
    NATL: ["Arctic", "Northern Europe & British Isles", "Canada & New England"],
    WAFRICA: ["Atlantic Islands", "Africa & Indian Ocean", "Western Europe & Iberia"],
    SAFRICA: ["Africa & Indian Ocean"],
    MIDEAST: ["Africa & Indian Ocean", "Asia & Mekong"],
    INDIA: ["Asia & Mekong"],
    SEASIA: ["Asia & Mekong"],
    EASTASIA: ["Asia & Mekong"],
    AUNZ: ["Australia, NZ & South Pacific"],
  },
};

let failures = 0;

/* ── the two voyage collections: stops are ports, placed by the classifier ── */
for (const [collection, file] of [["yacht", "data/atlas/yacht/itinerary.json"], ["worldcruise", "data/atlas/world/itinerary.json"]]) {
  const feed = read(file);
  const REGIONS = feed.REGIONS || {};
  const PORTS = feed.PORTS || {};
  const allow = ALLOW[collection];
  const trips = feed.TRIPS || [];
  let checked = 0, bad = 0;

  for (const trip of trips) {
    const keys = (Array.isArray(trip.g) ? trip.g : [trip.g]).filter(Boolean);
    const permitted = new Set(keys.flatMap((k) => allow[k] || []));
    const tally = {};
    let placed = 0;
    for (const stop of trip.itin || []) {
      const at = stop && stop.n && PORTS[stop.n];
      if (!at) continue;
      const region = portRegion(stop.n, at[0], at[1]);
      if (!region) continue;
      placed++;
      tally[region] = (tally[region] || 0) + 1;
    }
    if (!placed) continue;
    checked++;
    const outside = Object.entries(tally).filter(([r]) => !permitted.has(r)).reduce((a, b) => a + b[1], 0);
    if (outside / placed > 0.5) {
      bad++; failures++;
      console.log(`  ✗ ${collection}: ${trip.title}`);
      console.log(`      tagged ${keys.map((k) => `${k} (${(REGIONS[k] || {}).name || "?"})`).join(" + ") || "(nothing)"}`);
      console.log(`      stops  ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ")}`);
    }
  }
  console.log(`  ${bad ? "✗" : "✓"} ${collection.padEnd(11)} ${String(checked).padStart(4)} trips with placeable stops   ${bad} mis-tagged`);
}

/* ── the two journeys collections: every stop already carries its region key ── */
for (const [collection, file] of [["train", "data/atlas/train/itinerary.json"], ["jet", "data/atlas/jet/itinerary.json"]]) {
  const feed = read(file);
  const ROUTES = feed.ROUTES || {};
  const stopRegion = {};
  for (const key of Object.keys(ROUTES)) for (const s of ROUTES[key] || []) if (s && s.n) stopRegion[s.n] = s.r;
  let checked = 0, bad = 0;

  for (const trip of feed.TRIPS || []) {
    const keys = (Array.isArray(trip.g) ? trip.g : [trip.g]).filter(Boolean);
    // A round-the-world journey carries no region at all, by design.
    if (!keys.length) continue;
    const regions = (trip.itin || []).map((s) => s && s.n && stopRegion[s.n]).filter(Boolean);
    if (!regions.length) continue;
    checked++;
    const outside = regions.filter((r) => !keys.includes(r)).length;
    if (outside / regions.length > 0.5) {
      bad++; failures++;
      const tally = {};
      for (const r of regions) tally[r] = (tally[r] || 0) + 1;
      console.log(`  ✗ ${collection}: ${trip.n || trip.title || trip.id}`);
      console.log(`      tagged ${keys.join(" + ")}`);
      console.log(`      stops  ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ")}`);
    }
  }
  console.log(`  ${bad ? "✗" : "✓"} ${collection.padEnd(11)} ${String(checked).padStart(4)} trips with region-tagged stops   ${bad} mis-tagged`);
}

/* ── expedition cruise: the overlay decides the region, so check IT ── */
{
  const sailings = read("data/atlas/cruise/sailings.json");
  const routes = read("public/maps/cruise/data/itinerary-routes.json").routes || {};
  const overlay = read("data/atlas/cruise/region-overrides.json");
  const idx = {};
  (sailings.schema || []).forEach((n, i) => { idx[n] = i; });
  const regionById = {};
  for (const [region, ids] of Object.entries(overlay.byRegion || {})) for (const id of ids) regionById[id] = region;

  // The overlay's own choices are what the atlas shows, so the bar here is the
  // sailing's ports agreeing with the region it was given — held to the same
  // contract the builder promises: the region is one of the itinerary's two
  // largest, which lets a genuine two-region voyage (Greenland → Labrador) keep
  // either name while a wrong-hemisphere tag still fails.
  //
  // Repositioning crossings land in "Other", river and lake products in their
  // own buckets, and the Northwest Passage is read off the title because its
  // ports are ordinary Nunavut calls. All four are answers about product or a
  // named waterway rather than about a place, so they are not held to this.
  const EXEMPT = new Set(["Other", "Europe Rivers", "US Rivers & Coast", "Great Lakes", "Northwest Passage"]);
  let checked = 0, bad = 0;

  for (const row of sailings.rows || []) {
    const id = String(row[idx.id]);
    const region = regionById[id];
    if (!region || EXEMPT.has(region)) continue;
    const tally = {};
    let placed = 0;
    for (const day of routes[id] || []) {
      for (const p of day.p || []) {
        if (p[1] == null || p[2] == null) continue;
        const r = portRegion(p[0], p[1], p[2]);
        if (!r) continue;
        placed++;
        tally[r] = (tally[r] || 0) + 1;
      }
    }
    if (!placed) continue;
    checked++;
    const inside = tally[region] || 0;
    const rank = Object.entries(tally).sort((a, b) => b[1] - a[1]).findIndex(([r]) => r === region);
    // Galápagos and Antarctica win on presence, not rank — a Galápagos sailing
    // with a Machu Picchu land extension is still a Galápagos sailing.
    const ok = region === "Galápagos" || region === "Antarctica"
      ? inside >= 3 || inside / placed >= 0.25
      : rank === 0 || rank === 1;
    if (!ok) {
      bad++; failures++;
      console.log(`  ✗ cruise: ${row[idx.name]}`);
      console.log(`      overlay says ${region}`);
      console.log(`      stops  ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ")}`);
    }
  }
  console.log(`  ${bad ? "✗" : "✓"} ${"cruise".padEnd(11)} ${String(checked).padStart(4)} sailings with placeable ports   ${bad} mis-tagged`);
}

console.log(failures
  ? `\n${failures} trip(s) tagged with a region their stops are not in.`
  : "\nEvery collection's regions hold together geographically.");
process.exit(failures ? 1 : 0);

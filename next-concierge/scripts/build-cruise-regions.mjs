#!/usr/bin/env node
/**
 * Rebuild the expedition-cruise region overlay.
 *
 * WHY THIS EXISTS
 * The `region` column in sailings.json is the supplier feed's own marketing
 * bucket, and several of its buckets are keyword buckets rather than places.
 * "Norway, Fjords & Coast" is the worst: it collects anything with "fjord" in
 * the title, so Chilean Patagonia, Greenland, Iceland and the Alaskan Inside
 * Passage all landed under Norway. The Region filter in the atlas is built from
 * these values, so a traveller filtering to Norway was shown Chile.
 *
 * WHAT IT DOES
 * Every sailing already carries day-by-day geocoded ports (itinerary-routes.json,
 * built by the Expedition Atlas route work). Those ports are the ground truth:
 * each port name ends in its country ("Puerto Montt, Chile", "Bergen, Norway"),
 * so a port can be placed on the map with no guessing. This script tallies each
 * sailing's ports into regions and takes the answer from the itinerary itself.
 * Sailings whose ports are all un-geocoded (712 of 3,542) fall back to title
 * keywords, then to the endpoint cities in the title.
 *
 * The output is an overlay — every sailing's region, grouped by region name —
 * NOT a rewrite of sailings.json. The feed stays the feed, so a re-import cannot
 * silently revert the fix, and re-running this script after an import refreshes
 * the overlay.
 *
 *   node scripts/build-cruise-regions.mjs            # write the overlay
 *   node scripts/build-cruise-regions.mjs --dry-run  # report, write nothing
 *   node scripts/build-cruise-regions.mjs --check    # exit 1 if stale (CI)
 *
 * Writes (both copies — data/ is what the server lib requires, public/ is what
 * the browser fetches):
 *   data/atlas/cruise/region-overrides.json
 *   public/maps/cruise/region-overrides.json
 * and refreshes REGIONS (counts, plus coords for regions the feed never had) in
 * both atlas-meta.json copies.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { portRegion } from "./port-region.mjs";
import { steadyStamp } from "./lib/steady-stamp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAILINGS = path.join(ROOT, "data/atlas/cruise/sailings.json");
const ROUTES = path.join(ROOT, "public/maps/cruise/data/itinerary-routes.json");
const OVERLAY_OUT = [
  path.join(ROOT, "data/atlas/cruise/region-overrides.json"),
  path.join(ROOT, "public/maps/cruise/region-overrides.json"),
];
const META_OUT = [
  path.join(ROOT, "data/atlas/cruise/atlas-meta.json"),
  path.join(ROOT, "public/maps/cruise/atlas-meta.json"),
];

const argv = new Set(process.argv.slice(2));
const DRY = argv.has("--dry-run");
const CHECK = argv.has("--check");
const VERBOSE = argv.has("--verbose");

// ---------------------------------------------------------------------------
// Region vocabulary. Names are the feed's own display strings wherever the feed
// has a usable bucket, so existing `?regions=` links keep resolving. The three
// at the bottom are new: the feed has no bucket for them, which is exactly why
// their sailings had to be filed somewhere wrong.
// ---------------------------------------------------------------------------
const NEW_REGION_COORDS = {
  // [lat, lng] — same convention as every other atlas feed's REGIONS.coord.
  "Patagonia & Chilean Fjords": [-50.5, -73.5],
  "Western Europe & Iberia": [44, -7],
  // The public copy of atlas-meta already carried this pin (the legacy atlas
  // knew the region; the data/ copy did not). Keeping its coordinate converges
  // the two copies instead of introducing a second Northwest Passage.
  "Northwest Passage": [74, -95],
};

// Product buckets, not places: a river or lake itinerary stays where the feed
// filed it even though its ports sit inside some ocean region's box.
const PRODUCT_BUCKETS = new Set(["Europe Rivers", "US Rivers & Coast", "Great Lakes"]);

/**
 * Titles that name their region outright, for the 712 sailings with no geocoded
 * port. Ordered, most specific first — the runtime `correctedRegionName()` in
 * lib/atlas/adapters/cruise.ts mirrors the head of this table, and the
 * Northwest Passage rule is applied ahead of everything else below.
 *
 * Returns null when the title names no region, which is the signal that the
 * city gazetteer may have a turn.
 */
export function keywordRegion(title) {
  const t = String(title || "").toLowerCase();
  // Antarctica boards in Patagonia and calls at the Falklands and South
  // Georgia, so it has to be settled before anything southern.
  if (/antarctic|south georgia|weddell|ross sea|south shetland/.test(t)) return "Antarctica";
  if (/gal[áa]pagos/.test(t)) return "Galápagos";
  if (t.includes("northwest passage")) return "Northwest Passage";
  if (t.includes("alaska")) return "Alaska & Yukon";
  if (t.includes("baja") || t.includes("sea of cortez")) return "Baja California";
  if (t.includes("seychelles")) return "Africa & Indian Ocean";
  // Chilean fjords / Patagonia — the bug this overlay was written for.
  if (/chilean fjord|patagonia|torres del paine|strait of magellan|tierra del fuego/.test(t)) {
    return "Patagonia & Chilean Fjords";
  }
  // Iceland, Greenland and Svalbard belong with the high-latitude North
  // Atlantic, never with Norway — but a title naming both is a Norway sailing
  // that reaches north, which is how the feed files them too.
  if (/\barctic\b|iceland|greenland|svalbard|spitsbergen/.test(t) && !/norway|norwegian/.test(t)) return "Arctic";
  if (/norway|norwegian/.test(t)) return "Norway, Fjords & Coast";
  if (t.includes("caribbean")) return "Caribbean & Bermuda";
  if (t.includes("amazon")) return "Amazon & South America";
  if (t.includes("kimberley")) return "Australia, NZ & South Pacific";
  if (/mediterranean|adriatic|aegean|greek isle/.test(t)) return "Mediterranean";
  if (/panama canal/.test(t)) return "Central America & Panama";
  if (/tahiti|polynesia|hawaii/.test(t)) return "Hawaii & Tahiti";
  return null;
}

// ---------------------------------------------------------------------------
const sailings = JSON.parse(readFileSync(SAILINGS, "utf8"));
const routes = JSON.parse(readFileSync(ROUTES, "utf8")).routes || {};
const idx = {};
(sailings.schema || []).forEach((k, i) => { idx[k] = i; });

/**
 * City → region, learned from every geocoded port in the feed. Half the
 * port-less sailings are titled after their endpoints ("Barcelona to Monte
 * Carlo", "Ijmuiden (Amsterdam) to Copenhagen"), and those endpoints are ports
 * that other sailings do geocode. A city that resolves to more than one region
 * is dropped rather than guessed at.
 */
const CITY_REGION = (() => {
  const seen = new Map();
  for (const days of Object.values(routes)) {
    for (const day of days) {
      for (const p of day.p || []) {
        if (p[1] == null || p[2] == null) continue;
        const region = portRegion(p[0], p[1], p[2]);
        if (!region) continue;
        const city = String(p[0]).split(",")[0].trim().toLowerCase();
        // Short or generic names ("Sea", "Bay") are too collision-prone.
        if (city.length < 5 || /^(the |sea|bay|port|island)/.test(city)) continue;
        const prior = seen.get(city);
        if (prior === undefined) seen.set(city, region);
        else if (prior !== region) seen.set(city, null);   // ambiguous
      }
    }
  }
  const out = new Map();
  for (const [city, region] of seen) if (region) out.set(city, region);
  return out;
})();

/** Regions named by the cities in a title, most-mentioned first. */
function regionFromTitleCities(title) {
  const t = ` ${String(title || "").toLowerCase().replace(/[^a-z0-9åäöæøéíáóúñç]+/g, " ")} `;
  const tally = {};
  for (const [city, region] of CITY_REGION) {
    if (!t.includes(` ${city} `)) continue;
    tally[region] = (tally[region] || 0) + 1;
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1]);
}

const KM = (a, b) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

const decided = [];   // { id, name, feed, region, why, share, ranked }
for (const row of sailings.rows || []) {
  const id = String(row[idx.id]);
  const name = String(row[idx.name] ?? "");
  const feed = String(row[idx.region] ?? "") || "Other";

  const pts = [];
  for (const day of routes[id] || []) {
    for (const p of day.p || []) {
      if (p[1] == null || p[2] == null) continue;
      pts.push([p[1], p[2], p[0]]);
    }
  }

  // The Northwest Passage is a named waterway, not a country: its ports are
  // ordinary Nunavut and Greenland calls, so no port tally can tell it apart
  // from a Baffin Bay expedition. The title is the only signal, and it is a
  // reliable one — this rule predates the overlay and is kept verbatim.
  if (/northwest passage/i.test(name)) {
    decided.push({ id, name, feed, region: "Northwest Passage", why: "title (named waterway)", share: null, ranked: [] });
    continue;
  }

  // River and lake products keep the feed's bucket. Their ports sit inside some
  // ocean region's box — a Gironde estuary call is still "France" — but the
  // bucket is a product line, and the sailings inside each one are already in
  // one part of the world.
  if (PRODUCT_BUCKETS.has(feed)) {
    decided.push({ id, name, feed, region: feed, why: "product bucket", share: null, ranked: [] });
    continue;
  }

  if (pts.length < 2) {
    // Keywords first — they name a region outright ("Chilean Fjords"). Only a
    // title that names none gives the city gazetteer a turn, and only when the
    // cities agree: two cities in two regions is a crossing, and the feed's own
    // bucket is then as good a guess as any.
    const keyword = keywordRegion(name);
    let region = keyword, why = "title keyword";
    if (!region) {
      const cities = regionFromTitleCities(name);
      if (cities.length === 1) { region = cities[0][0]; why = "title cities"; }
      else { region = feed; why = pts.length ? "no signal (1 port)" : "no signal (no ports)"; }
    }
    decided.push({ id, name, feed, region, why, share: null, ranked: [] });
    continue;
  }

  const tally = {};
  let placed = 0;
  for (const [lat, lng, pname] of pts) {
    const r = portRegion(pname, lat, lng);
    if (!r) continue;
    placed++;
    tally[r] = (tally[r] || 0) + 1;
  }
  if (!placed) {
    decided.push({ id, name, feed, region: keywordRegion(name) || feed, why: "title (ports unplaced)", share: null, ranked: [] });
    continue;
  }

  let ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  // Galápagos and Antarctica are decisive: nowhere else on an itinerary can be
  // mistaken for them, and both routinely lose a port count to the mainland
  // gateway (Guayaquil, Ushuaia) or a Machu Picchu land extension. A lone
  // stray port is not enough — a mis-geocode shouldn't move a whole sailing.
  let sticky = null;
  for (const key of ["Galápagos", "Antarctica"]) {
    const n = tally[key] || 0;
    if (n >= 3 || n / placed >= 0.25) {
      ranked = [[key, n], ...ranked.filter(([k]) => k !== key)];
      sticky = key;
    }
  }

  const [top, count] = ranked[0];
  const share = count / placed;
  let region, why;
  if (top === feed) {
    region = feed; why = "agrees";
  } else if (share >= 0.6) {
    region = top; why = "ports (clear)";
  } else if (ranked.slice(0, 2).some(([k]) => k === feed)) {
    // A genuine two-region itinerary (Greenland → Labrador, say). The feed's
    // pick is one of the two, so leave it alone rather than churn the bucket.
    region = feed; why = "close call, feed kept";
  } else {
    region = top; why = "ports (plurality)";
  }

  // A crossing that is mostly open water belongs in the repositioning bucket
  // rather than lending its name to a region it merely departed from. Antarctica
  // and Galápagos are exempt: a voyage that actually lands there must stay
  // findable under the region people search for, however far it also travels.
  if (share <= 0.5 && !sticky) {
    let span = 0;
    for (let i = 1; i < pts.length; i++) span = Math.max(span, KM(pts[0], pts[i]));
    if (span > 6000) { region = "Other"; why = `repositioning (${Math.round(span)}km)`; }
  }

  decided.push({ id, name, feed, region, why, share, ranked });
}

// --- overlay ---------------------------------------------------------------
// Every sailing is listed, not only the corrections. A runtime that could not
// tell "the overlay agrees with the feed" from "the overlay has never seen this
// row" would re-apply its title fallback on top of a deliberate agreement, and
// the two code paths would drift. Grouping by region keeps the file small: an
// id costs 11 bytes, a repeated region name would cost thirty.
const byRegion = {};
for (const d of decided) (byRegion[d.region] = byRegion[d.region] || []).push(d.id);
for (const ids of Object.values(byRegion)) ids.sort();

const counts = {};
for (const [region, ids] of Object.entries(byRegion)) counts[region] = ids.length;

const changed = decided.filter((d) => d.region !== d.feed).length;

const overlay = {
  _meta: {
    generatedAt: null,          // filled by steadyStamp below, in this position
    generator: "scripts/build-cruise-regions.mjs",
    sailings: decided.length,
    corrected: changed,
    note: "Complete region map for every sailing, grouped by region name. Derived from each itinerary's geocoded ports; see the script header.",
  },
  counts,
  byRegion,
};

// --- report ----------------------------------------------------------------
const moves = {};
for (const d of decided) {
  if (d.region === d.feed) continue;
  const k = `${d.feed}  ->  ${d.region}`;
  (moves[k] = moves[k] || []).push(d);
}
console.log(`sailings ${decided.length}, corrected ${changed}\n`);
console.log("moves:");
for (const [k, v] of Object.entries(moves).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(v.length).padStart(4)}  ${k}`);
  if (VERBOSE) for (const d of v.slice(0, 6)) console.log(`          ${d.why} · ${d.name}`);
}
console.log("\nregion counts after:");
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  const before = (sailings.rows || []).filter((r) => (String(r[idx.region] ?? "") || "Other") === k).length;
  const delta = v - before;
  console.log(`  ${String(v).padStart(5)}  ${k}${delta ? `   (${delta > 0 ? "+" : ""}${delta})` : ""}`);
}

// --- write -----------------------------------------------------------------
const serialize = (o) => JSON.stringify(o, null, 1) + "\n";

function nextMeta(file) {
  const meta = JSON.parse(readFileSync(file, "utf8"));
  const REGIONS = meta.REGIONS || (meta.REGIONS = {});
  for (const key of Object.keys(counts)) {
    const coord = NEW_REGION_COORDS[key];
    // This script owns the pins it introduces, so it sets them on every run and
    // both copies land on the same coordinate. Pins the feed brought with it are
    // editorial and left alone.
    if (coord) REGIONS[key] = { name: key, coord: [...coord] };
    else if (!REGIONS[key]) { console.warn(`  ! no coord for new region "${key}" — pin will be skipped`); continue; }
    REGIONS[key].count = counts[key];
  }
  // A region nobody sails to any more should not keep a pin on the globe.
  for (const key of Object.keys(REGIONS)) if (!counts[key]) delete REGIONS[key];
  return meta;
}

/**
 * The two atlas-meta copies must agree. They had already drifted once — the
 * public copy carried a Northwest Passage pin the data copy had never heard of —
 * and a pin that exists on only one side is invisible to whichever surface reads
 * the other.
 */
function reportMetaDrift(metas) {
  const [a, b] = metas.map((m) => m.REGIONS || {});
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let drift = 0;
  for (const key of keys) {
    const left = JSON.stringify((a[key] || {}).coord ?? null);
    const right = JSON.stringify((b[key] || {}).coord ?? null);
    if (left !== right) { console.warn(`  ! atlas-meta copies disagree on "${key}": ${left} vs ${right}`); drift++; }
  }
  return drift;
}

if (CHECK) {
  let stale = false;
  for (const f of OVERLAY_OUT) {
    let current = null;
    try { current = JSON.parse(readFileSync(f, "utf8")); } catch { current = null; }
    const same = current
      && JSON.stringify(current.byRegion || {}) === JSON.stringify(byRegion)
      && JSON.stringify(current.counts || {}) === JSON.stringify(counts);
    if (!same) { console.error(`STALE: ${path.relative(ROOT, f)}`); stale = true; }
  }
  for (const f of META_OUT) {
    const want = nextMeta(f);
    const have = JSON.parse(readFileSync(f, "utf8"));
    if (JSON.stringify(have.REGIONS) !== JSON.stringify(want.REGIONS)) {
      console.error(`STALE: ${path.relative(ROOT, f)} (REGIONS)`);
      stale = true;
    }
  }
  if (stale) { console.error("\nrun: node scripts/build-cruise-regions.mjs"); process.exit(1); }
  console.log("\nregion overlay is current");
} else if (DRY) {
  console.log("\n--dry-run: nothing written");
} else {
  // One stamp for both copies, and only when the regions actually moved — the
  // nightly sync re-derives this every night. See scripts/lib/steady-stamp.mjs.
  const stampedOverlay = steadyStamp(OVERLAY_OUT[0], overlay);
  for (const f of OVERLAY_OUT) { writeFileSync(f, serialize(stampedOverlay)); console.log(`\nwrote ${path.relative(ROOT, f)}`); }
  const metas = META_OUT.map(nextMeta);
  reportMetaDrift(metas);
  META_OUT.forEach((f, i) => { writeFileSync(f, serialize(metas[i])); console.log(`wrote ${path.relative(ROOT, f)}`); });
}

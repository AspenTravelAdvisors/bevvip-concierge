#!/usr/bin/env node
/**
 * fix-port-locations — apply data/atlas/shared/port-overrides.json to the feeds.
 *
 *   node scripts/fix-port-locations.mjs           write the corrections
 *   node scripts/fix-port-locations.mjs --check   exit 1 if anything would change
 *   node scripts/fix-port-locations.mjs --json    machine-readable summary
 *
 * ── Why corrections live outside the feeds ─────────────────────────────────
 *
 * None of these files are written by hand. The world-cruise and yacht feeds are
 * harvested, the expedition routes are distilled from port-itineraries.json by a
 * script in another repo, and all three are refreshed wholesale. Edit a
 * coordinate in place and the next refresh quietly puts the rogue back — which
 * is the shape the recurring problem actually had.
 *
 * So the ledger is the source of truth and this script is idempotent: run it
 * after every refresh (npm run prebuild does) and the same corrections land
 * again. `was` is what makes that safe. An entry only fires on a stop within
 * TOLERANCE_DEG of the coordinate it was written against, so if a feed moves a
 * port — because upstream fixed it, or because the name now means somewhere
 * else — the entry reports itself as stale instead of overwriting good data.
 *
 * ── The two feed shapes ────────────────────────────────────────────────────
 *
 *   PORTS map    world + yacht: one name -> one [lat, lng], shared by every
 *                voyage. Correcting it corrects the whole feed at once.
 *   inline       expedition cruise: [name, lat, lng] repeated at every stop,
 *                so a correction is applied occurrence by occurrence.
 *
 * That difference is why `scope: "occurrence"` exists and why it is refused on
 * a PORTS-map feed: "San Sebastián is the Canarian one here and the Basque one
 * there" cannot be expressed by a lookup that holds one coordinate per name.
 * Such an entry is reported rather than half-applied.
 *
 * Both copies of every dual-copy file are written together (data/atlas/... and
 * public/maps/...), because the server reads one and the browser fetches the
 * other and they are meant to be byte-identical.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const has = (p) => existsSync(join(ROOT, p));

/**
 * How far a stop may sit from an entry's `was` and still be that stop.
 *
 * 0.25 deg is ~28km. Feeds round differently (43.89 here, 43.8833 there) and
 * geocoders disagree about where a town "is" by a few kilometres, so the guard
 * has to be looser than exact. It stays far tighter than the errors it guards
 * against, which are hundreds to thousands of kilometres out.
 */
const TOLERANCE_DEG = 0.25;

const near = (a, b) => Math.abs(a[0] - b[0]) <= TOLERANCE_DEG
  && Math.abs(a[1] - b[1]) <= TOLERANCE_DEG;

const R_EARTH = 6371;
const rad = (d) => (d * Math.PI) / 180;
const km = (a, b) => {
  const s = Math.sin(rad(b[0] - a[0]) / 2) ** 2
    + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
};

// ── Feeds ──────────────────────────────────────────────────────────────────
//
// `files` lists every copy that must stay identical. `shape` picks the writer.

const FEEDS = [
  {
    collection: "world",
    shape: "ports",
    files: ["data/atlas/world/itinerary.json", "public/maps/worldcruise/itinerary.json"],
  },
  {
    collection: "yacht",
    shape: "ports",
    files: ["data/atlas/yacht/itinerary.json", "public/maps/yacht/itinerary.json"],
  },
  {
    collection: "cruise",
    shape: "inline",
    files: ["public/maps/cruise/data/itinerary-routes.json"],
  },
  /*
   * The journey atlases were left out while their coordinates were our own
   * geocoding — there was nothing for a supplier ledger to correct. Since the
   * Virtuoso migration the stops carry operator coordinates, and operators get
   * them wrong: the API places "Sao Paulo" in Paraíba, 2,090km from the city.
   * audit-port-locations already checked these two; now the fixer can mend them.
   */
  {
    collection: "jet",
    shape: "waypoints",
    files: ["data/atlas/jet/itinerary.json", "public/maps/jet/itinerary.json"],
  },
  {
    collection: "train",
    shape: "waypoints",
    files: ["data/atlas/train/itinerary.json", "public/maps/train/itinerary.json"],
  },
];

/**
 * Which of a stop's neighbours to judge an `occurrence` entry against, and the
 * verdict: does the correction move it closer to the company it keeps?
 *
 * Sea days and ungeocoded calls are skipped — half the itineraries in these
 * feeds have one on at least one side, and skipping is what lets the test see
 * past them to the real ports.
 */
function improvesFit(here, entry, neighbours) {
  if (!neighbours.length) return false;
  const now = Math.min(...neighbours.map((n) => km(here, n)));
  const then = Math.min(...neighbours.map((n) => km(entry.ll, n)));
  return then < now;
}

/**
 * Apply to a name -> [lat, lng] lookup. Returns the number of names changed.
 *
 * `scope: "occurrence"` is honoured here by SPLITTING the name. A lookup holds
 * one coordinate per name, and "Miyako, Japan" is two ports: Miyakojima in
 * Okinawa on the runs from Taiwan, and Miyako in Iwate between Sendai and
 * Aomori. Correcting the shared entry fixes one set of voyages by breaking the
 * other. So the occurrences that fit the correction are repointed at a new,
 * unambiguous name (`as`), which the atlas then shows to travellers — and the
 * original entry is left exactly as the feed had it, for the voyages it was
 * right for all along.
 */
/**
 * ROUTES as `{ key: [{ n, r, ll }] }` — the jet and rail shape.
 *
 * Every occurrence of the name is moved, because a waypoint list has no shared
 * port table to correct once; the coordinate is repeated on each stop.
 */
function applyToWaypoints(doc, entries, log) {
  let changed = 0;
  for (const entry of entries) {
    if (entry.scope === "occurrence") continue;   // no per-occurrence split here
    let hits = 0, stale = 0;
    for (const stops of Object.values(doc.ROUTES ?? {})) {
      for (const stop of stops ?? []) {
        if (!stop || stop.n !== entry.name || !Array.isArray(stop.ll)) continue;
        if (!near(stop.ll, entry.was)) {
          if (entry.ll && near(stop.ll, entry.ll)) log.alreadyApplied.push(entry);
          else stale++;
          continue;
        }
        if (entry.ll == null) stop.ll = null;
        else stop.ll = [entry.ll[0], entry.ll[1]];
        hits++;
      }
    }
    if (hits) { changed += hits; log.applied.push({ entry, hits }); }
    else if (stale) log.stale.push({ entry, found: "no waypoint at the recorded position" });
  }
  return changed;
}

function applyToPorts(doc, entries, log) {
  let changed = 0;
  for (const entry of entries) {
    if (entry.scope === "occurrence") {
      changed += splitPortName(doc, entry, log);
      continue;
    }
    const ll = doc.PORTS?.[entry.name];
    if (!Array.isArray(ll)) continue;
    if (!near(ll, entry.was)) {
      if (entry.ll && near(ll, entry.ll)) log.alreadyApplied.push(entry);
      else log.stale.push({ entry, found: ll });
      continue;
    }
    if (entry.ll == null) {
      // No coordinate at all: the atlases skip a port they cannot place, which
      // is the point — better absent than 3,000km wrong.
      delete doc.PORTS[entry.name];
    } else {
      doc.PORTS[entry.name] = [entry.ll[0], entry.ll[1]];
    }
    log.applied.push({ entry, moved: entry.ll ? km(ll, entry.ll) : null, stops: 1 });
    changed++;
  }
  return changed;
}

/**
 * Repoint the occurrences a correction fits at a new, unambiguous port name,
 * leaving the feed's own entry for the occurrences it was already right for.
 *
 * Idempotent by construction: once an itinerary points at `as`, its name no
 * longer matches `name`, so a second run finds nothing to do.
 */
function splitPortName(doc, entry, log) {
  if (!entry.ll || !entry.as) { log.refused.push(entry); return 0; }
  const ll = doc.PORTS?.[entry.name];
  if (!Array.isArray(ll)) {
    if (doc.PORTS?.[entry.as]) log.alreadyApplied.push(entry);
    return 0;
  }
  if (!near(ll, entry.was)) { log.stale.push({ entry, found: ll }); return 0; }

  let moved = 0;
  for (const trip of doc.TRIPS || []) {
    const itin = trip.itin || [];
    const placed = itin.filter((e) => e.n && Array.isArray(doc.PORTS[e.n]));
    for (const stop of itin) {
      if (stop.n !== entry.name) continue;
      const i = placed.indexOf(stop);
      const neighbours = [placed[i - 1], placed[i + 1]]
        .filter((n) => n && n.n !== entry.name)
        .map((n) => doc.PORTS[n.n]);
      if (!improvesFit(ll, entry, neighbours)) continue;
      stop.n = entry.as;
      moved++;
    }
  }
  if (!moved) {
    // The name survives on the itineraries it was right for, so "nothing to
    // move" is the steady state after a split, not a missing entry.
    if (doc.PORTS[entry.as]) log.alreadyApplied.push(entry);
    return 0;
  }
  doc.PORTS[entry.as] = [entry.ll[0], entry.ll[1]];
  log.applied.push({ entry, moved: km(ll, entry.ll), stops: moved });
  return moved;
}

/**
 * Apply to day-keyed routes whose stops carry their own coordinates.
 *
 * `scope: "occurrence"` is resolved here without a split, since each stop
 * already holds its own coordinate: the correction is written only where it
 * moves the stop closer to the stops around it.
 */
function applyToInlineRoutes(doc, entries, log) {
  const byName = new Map();
  for (const entry of entries) {
    if (!byName.has(entry.name)) byName.set(entry.name, []);
    byName.get(entry.name).push(entry);
  }
  const counts = new Map();   // entry -> stops changed
  let changed = 0;

  for (const days of Object.values(doc.routes || {})) {
    // Flatten once so an occurrence can see past its own day.
    const stops = [];
    for (const day of days) for (const p of (day.p || [])) stops.push(p);
    const placed = stops.filter((p) => p[1] != null && p[2] != null);

    for (let i = 0; i < stops.length; i++) {
      const p = stops[i];
      const candidates = byName.get(p[0]);
      if (!candidates) continue;
      if (p[1] == null || p[2] == null) {
        // An `ll: null` entry leaves nothing behind to match on, so recognise
        // its own handiwork rather than reporting the entry as unused forever.
        for (const entry of candidates) if (entry.ll == null) log.alreadyApplied.push(entry);
        continue;
      }
      const here = [p[1], p[2]];
      for (const entry of candidates) {
        if (!near(here, entry.was)) {
          if (entry.ll && near(here, entry.ll)) log.alreadyApplied.push(entry);
          continue;
        }
        if (entry.scope === "occurrence" && entry.ll) {
          const idx = placed.indexOf(p);
          const neighbours = [placed[idx - 1], placed[idx + 1]]
            .filter((n) => n && n[0] !== p[0])
            .map((n) => [n[1], n[2]]);
          // No verdict available, or the feed's coordinate fits better: leave it.
          if (!improvesFit(here, entry, neighbours)) continue;
        }
        if (entry.ll == null) { p[1] = null; p[2] = null; } else { p[1] = entry.ll[0]; p[2] = entry.ll[1]; }
        counts.set(entry, (counts.get(entry) || 0) + 1);
        changed++;
        break;
      }
    }
  }
  for (const [entry, stops] of counts) {
    log.applied.push({ entry, moved: entry.ll ? km(entry.was, entry.ll) : null, stops });
  }
  return changed;
}

// ── Run ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const asJson = argv.includes("--json");

const LEDGER = "data/atlas/shared/port-overrides.json";
if (!has(LEDGER)) {
  console.error(`missing ${LEDGER}`);
  process.exit(1);
}
const ledger = read(LEDGER);
const corrections = ledger.corrections || [];

const log = { applied: [], stale: [], refused: [], alreadyApplied: [], written: [] };
let wouldChange = 0;

for (const feed of FEEDS) {
  const entries = corrections.filter(
    (c) => !c.collections || c.collections.includes(feed.collection),
  );
  if (!entries.length) continue;
  const present = feed.files.filter(has);
  if (!present.length) continue;

  // Both copies are meant to be identical, so correct one document and write
  // it to every path. That also repairs a pair that has drifted apart.
  const doc = read(present[0]);
  const changed = feed.shape === "ports" ? applyToPorts(doc, entries, log)
    : feed.shape === "waypoints" ? applyToWaypoints(doc, entries, log)
    : applyToInlineRoutes(doc, entries, log);
  if (!changed) continue;
  wouldChange += changed;

  const text = JSON.stringify(doc);
  for (const file of present) {
    if (!check) writeFileSync(join(ROOT, file), text);
    log.written.push(file);
  }
}

const unused = corrections.filter(
  (c) => !log.applied.some((a) => a.entry === c) && !log.alreadyApplied.includes(c)
    && !log.stale.some((s) => s.entry === c) && !log.refused.includes(c),
);

if (asJson) {
  console.log(JSON.stringify({
    applied: log.applied.map((a) => ({
      name: a.entry.name, collections: a.entry.collections, to: a.entry.ll,
      movedKm: a.moved == null ? null : Math.round(a.moved), stops: a.stops,
    })),
    stale: log.stale.map((s) => ({ name: s.entry.name, expected: s.entry.was, found: s.found })),
    refused: log.refused.map((r) => r.name),
    unused: unused.map((u) => u.name),
    files: [...new Set(log.written)],
  }, null, 2));
} else {
  console.log("");
  console.log(check ? "port corrections (check only)" : "port corrections");
  console.log("=".repeat(78));
  for (const a of log.applied) {
    const to = a.entry.ll ? `-> ${a.entry.ll[0]}, ${a.entry.ll[1]}` : "-> no coordinate";
    console.log(`  ${a.entry.name}`);
    console.log(`      ${to}  ${a.moved == null ? "" : `(${Math.round(a.moved).toLocaleString()}km)`}`
      + `  ${a.stops} stop${a.stops === 1 ? "" : "s"}   ${a.entry.place}`);
  }
  if (!log.applied.length) console.log("  Every correction is already in the data.");
  for (const s of log.stale) {
    console.log(`  STALE  ${s.entry.name}: expected ${s.entry.was.join(", ")},`
      + ` feed now has ${s.found.join(", ")} — recheck before trusting this entry`);
  }
  for (const r of log.refused) {
    console.log(`  REFUSED  ${r.name}: scope "occurrence" needs a feed with per-stop`
      + " coordinates; this one shares one coordinate per name");
  }
  for (const u of unused) console.log(`  UNUSED  ${u.name}: no stop matched — feed may have dropped it`);
  if (log.written.length) {
    console.log("");
    console.log(`  ${check ? "would write" : "wrote"} ${[...new Set(log.written)].join(", ")}`);
  }
  console.log("");
}

if (check && wouldChange) {
  console.error("port corrections are not applied to the data — run: npm run fix:ports");
  process.exit(1);
}
process.exit(0);

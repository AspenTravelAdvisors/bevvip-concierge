/**
 * One-shot data fix: give the Safrans du Monde jet journeys their real dates.
 *
 * WHY THIS IS A SCRIPT AND NOT A HAND EDIT
 *
 * The jet feed has no id field, so `jt_<arrayIndex>` IS the id — see the
 * WARNING in lib/atlas/adapters/jet.ts. Inserting or deleting anywhere but the
 * tail silently repoints every shared deep link after that position. Doing this
 * as a script makes the index arithmetic explicit and checkable rather than a
 * diff someone has to eyeball.
 *
 * WHAT IT DOES
 *
 * 11 Safrans journeys shipped with `onDemand: true` and no dates, so they
 * rendered a blank date line and were dropped by every month filter. Dates were
 * read from safransdumonde.com (see SOURCE on each entry). Three consequences:
 *
 *   1. UPDATE IN PLACE at 129-140. Each keeps its index, so every existing
 *      jt_ link still resolves to the same product.
 *   2. REUSE slot 132 rather than deleting it. It held "7 Wonders of Asia 2026",
 *      whose page now 404s and which is absent from the current listing. Left
 *      empty the slot would have to be removed, shifting 133-140 and breaking
 *      8 links; refilled with the 2028 departure of the same product, a stale
 *      jt_132 link lands on the closest live equivalent instead.
 *   3. APPEND the remaining departures at 141+, which shifts nothing.
 *
 * `days` is recomputed from the dates rather than trusted: the feed disagreed
 * with the supplier on 9 of 11 journeys, and not subtly — Tour de France was 9
 * against a published 18. Those wrong counts were feeding endFrom(), so any
 * derived end date was wrong too.
 *
 *   node scripts/apply-safrans-dates.mjs [--dry]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");

/**
 * The jet feed ships TWICE, and nothing keeps the copies in sync.
 *
 *   data/atlas/jet/itinerary.json    required by lib/atlas/journeys.js — the
 *                                    in-process backend behind The Guide
 *   public/maps/jet/itinerary.json   fetched by AtlasJet.tsx as
 *                                    /maps/jet/itinerary.json — the globe
 *
 * They were byte-identical before this ran, which is the only reason the two
 * surfaces agreed. Editing one and not the other is a silent split-brain: the
 * concierge would recommend a departure the map has never heard of. Both are
 * written here. The same duplication exists for train, yacht and cruise.
 */
const FEEDS = [
  join(ROOT, "data/atlas/jet/itinerary.json"),
  join(ROOT, "public/maps/jet/itinerary.json"),
];

/** "2026-10-22" -> "10/22/2026", the M/D/YYYY the jet feed stores. */
const mdy = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
};

/** Inclusive day count — a trip departing and returning the same day is 1 day. */
const dayCount = (startIso, endIso) =>
  Math.round((Date.parse(endIso + "T00:00:00Z") - Date.parse(startIso + "T00:00:00Z")) / 86400000) + 1;

// ─────────────────────────── departures, as published ───────────────────────
// `at` is an existing array index to overwrite; entries without one are
// appended. `name` overrides the record's title where the old one names a year
// that no longer has a departure.
const DEPARTURES = [
  // safransdumonde.com/private-jet-expeditions/the-world-tour-grands-classiques-2026
  { at: 129, start: "2026-10-22", end: "2026-11-14" },
  // /private-jet-expeditions/2027-the-world-tour-grands-classiques
  { at: 130, start: "2027-10-19", end: "2027-11-11" },
  // /private-jet-expeditions/the-world-tour-special-edition-2026
  // Publishes 6-30 Mar 2026 (past) and 5-29 Mar 2027. Renamed: the record was
  // titled 2026 and no 2026 departure remains.
  { at: 131, start: "2027-03-05", end: "2027-03-29", name: "The World Tour · Special Edition 2027" },
  // Slot recycled — see header. /7-wonders-of-asia-by-private-jet-2027 publishes
  // both the 2027 and 2028 departures.
  { at: 132, start: "2028-04-21", end: "2028-05-08", name: "7 Wonders of Asia by Private Jet 2028" },
  { at: 133, start: "2027-04-20", end: "2027-05-07" },
  // /collections-precieuses/japan-2026
  { at: 135, start: "2027-03-21", end: "2027-04-08" },
  // /collections-precieuses/autumn-japan-2026
  { at: 136, start: "2026-11-11", end: "2026-11-30" },
  { from: 136, start: "2027-11-14", end: "2027-12-03" },
  // /collections-precieuses/south-america-in-grand-luxury
  { at: 137, start: "2027-02-22", end: "2027-03-14" },
  { from: 137, start: "2028-02-21", end: "2028-03-12" },
  // /collections-precieuses/southern-africa-2025
  // A 4th departure, 17 Sep - 3 Oct 2026, is published "Fully Booked" and is
  // omitted: nothing in the schema can say sold out, and recommending an
  // unbookable date wastes a traveler's time. That entry is also where the
  // supplier's own page contradicts itself — the departures list prints
  // "September 17th" and the price table below it "September 27th".
  { at: 138, start: "2026-09-02", end: "2026-09-19" },
  { from: 138, start: "2027-03-10", end: "2027-03-27" },
  { from: 138, start: "2027-10-06", end: "2027-10-23" },
  // /collections-precieuses/india-2024
  { at: 139, start: "2026-09-28", end: "2026-10-10" },
  { from: 139, start: "2027-03-11", end: "2027-03-24" }, // Holi festival departure
  { from: 139, start: "2027-09-30", end: "2027-10-13" },
  // /collections-precieuses/tour-de-france-in-grand-luxury
  { at: 140, start: "2026-09-01", end: "2026-09-18" },
];

// Guard: this script hardcodes positions, so refuse to run against a feed that
// has already moved — including one this script has already edited. Cheaper
// than discovering it in production, and it makes a double-run safe.
const EXPECTED = {
  129: "The World Tour · Grands Classiques 2026",
  132: "7 Wonders of Asia by Private Jet 2026",
  140: "Tour de France in Grand Luxury",
};

function applyTo(path) {
  const feed = JSON.parse(readFileSync(path, "utf8"));
  const trips = feed.TRIPS;
  const before = trips.length;

  for (const [i, name] of Object.entries(EXPECTED)) {
    if (trips[i]?.n !== name) {
      console.error(`\nABORT (${path}): expected trips[${i}] to be ${JSON.stringify(name)}, found ${JSON.stringify(trips[i]?.n)}.`);
      console.error("Either this has already been applied, or the feed was reordered and the indices need re-deriving.\n");
      process.exit(1);
    }
  }

  const log = [];
  const appended = [];

  for (const dep of DEPARTURES) {
    const days = dayCount(dep.start, dep.end);
    if (dep.at != null) {
      const t = trips[dep.at];
      const wasDays = t.days;
      if (dep.name) t.n = dep.name;
      t.d = mdy(dep.start);
      t.r = mdy(dep.end);
      t.days = days;
      // These have real departures now; the flag exempted them from the month
      // filter and printed "On demand" where a date belongs.
      delete t.onDemand;
      log.push(`  jt_${String(dep.at).padEnd(3)} ${t.n.slice(0, 44).padEnd(46)} ${t.d} → ${t.r}   ${days}d${wasDays !== days ? `  (was ${wasDays}d)` : ""}`);
    } else {
      const src = trips[dep.from];
      const t = { ...src, d: mdy(dep.start), r: mdy(dep.end), days };
      if (dep.name) t.n = dep.name;
      delete t.onDemand;
      appended.push(t);
    }
  }

  for (const t of appended) {
    trips.push(t);
    log.push(`  jt_${String(trips.length - 1).padEnd(3)} ${t.n.slice(0, 44).padEnd(46)} ${t.d} → ${t.r}   ${t.days}d  (new)`);
  }

  console.log(`\n${path.replace(ROOT + "/", "")}\n`);
  console.log(log.join("\n"));
  console.log(`\n  ${before} trips → ${trips.length}  (${appended.length} appended, 0 removed, 0 indices shifted)`);
  console.log(`  every jt_0 … jt_${before - 1} still resolves to the same product`);

  if (DRY) {
    console.log("  --dry: nothing written");
  } else {
    // 2-space indent and NO trailing newline, matching the files as committed —
    // verified byte-identical on a no-op round trip, so the diff shows only the
    // records that actually changed rather than 16,217 reformatted lines.
    writeFileSync(path, JSON.stringify(feed, null, 2));
    console.log("  written");
  }
}

console.log("\nSafrans du Monde — dates applied");
for (const path of FEEDS) applyTo(path);
console.log();

#!/usr/bin/env node
// Warns when the Virtuoso data has gone stale.
//
// Freshness is judged on when a feed was last CHECKED, not when it last changed.
// Those are different facts and conflating them gets it wrong in both
// directions: a quiet fortnight at the supplier would read as a broken sync, and
// a sync that has been failing for a week looks fine as long as the file on disk
// still has yesterday's data in it. scripts/../lib/virtuoso/write-feed.mjs keeps
// the two apart.
//
// This warns by default and only fails past a hard limit, so one bad night — the
// API drops into maintenance often enough — does not block a deploy.
//
//   node scripts/verify-virtuoso-freshness.mjs
//   node scripts/verify-virtuoso-freshness.mjs --strict   # fail at the warn line

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/virtuoso/env.mjs';
import { COUNTS_FILE, generatedCounts } from './lib/collection-counts.mjs';

const STRICT = process.argv.includes('--strict');
const WARN_DAYS = 7;
const FAIL_DAYS = 30;

const STATUS = path.join(repoRoot, 'data/atlas/shared/virtuoso-sync-status.json');

const FEEDS = [
  { label: 'hotels', file: 'data/atlas/hotel/virtuoso-hotels.json', key: 'hotels' },
  // Offers carry an end date, so a stale promotions feed advertises expired deals.
  { label: 'promotions', file: 'data/atlas/shared/virtuoso-promotions.json', key: 'promotions' },
  { label: 'cruises', file: 'data/atlas/shared/virtuoso-cruises.json', key: 'cruises' },
  { label: 'tours', file: 'data/atlas/shared/virtuoso-tours.json', key: 'tours' },
];

const status = fs.existsSync(STATUS) ? JSON.parse(fs.readFileSync(STATUS, 'utf8')) : { feeds: {} };
const age = iso => (iso ? (Date.now() - Date.parse(iso)) / 86400000 : null);
const human = d => (d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(1)}d`);

let failed = false;
let worst = 0;
// Feeds that have no check to age at all. A feed nobody has ever synced is not
// "fine so far": it is the one state this file exists to catch, and it used to
// print a warning and then be absorbed into a green summary, because only feeds
// WITH a recorded check ever reached the verdict below.
const unchecked = [];

for (const { label, file, key } of FEEDS) {
  const full = path.join(repoRoot, file);
  if (!fs.existsSync(full)) {
    console.warn(`  absent   ${label} — never synced (${file})`);
    unchecked.push(`${label} (no feed file)`);
    continue;
  }

  const entry = status.feeds?.[key];
  const checked = age(entry?.lastChecked);
  const changed = age(entry?.lastChanged);
  const count = entry?.count ?? '?';

  if (checked == null) {
    console.warn(`  unknown  ${label} — no check recorded; run npm run sync:virtuoso`);
    unchecked.push(`${label} (no check recorded)`);
    continue;
  }
  worst = Math.max(worst, checked);
  const suffix = changed != null ? `, last changed ${human(changed)} ago` : '';

  if (checked > FAIL_DAYS || (STRICT && checked > WARN_DAYS)) {
    console.error(`  STALE    ${label} — checked ${human(checked)} ago (${count} records${suffix})`);
    failed = true;
  } else if (checked > WARN_DAYS) {
    console.warn(`  ageing   ${label} — checked ${human(checked)} ago (${count} records${suffix})`);
  } else {
    console.log(`  ok       ${label} — checked ${human(checked)} ago (${count} records${suffix})`);
  }
}

// The counts the site states out loud — the Explore menu, the home headline —
// come from lib/atlas-counts.ts, and the nightly sync moves the real numbers
// underneath it. `npm run verify:collection-counts` is the gate; this is the
// warning that belongs beside the freshness report, since a stale count is a
// stale-feed symptom and nobody would notice a page advertising one.
//
// Keyed by collection type rather than by `nounPlural`, which is what the
// previous version matched on: it scraped `count:` out of the registry by
// finding the noun first, so an edit to the wording silently turned every row
// into "no count found" and the check went quiet instead of red.
{
  const generated = generatedCounts();
  const counted = [
    ['hotel', 'vetted hotels', 'data/atlas/hotel/luxury-hotels.json', d => d.length],
    ['cruise', 'expedition sailings', 'data/atlas/cruise/sailings.json', d => d.rows.length],
    ['yacht', 'hotel-brand yacht voyages', 'data/atlas/yacht/itinerary.json', d => d.TRIPS.length],
    ['worldcruise', 'world cruises and grand voyages', 'data/atlas/world/itinerary.json', d => d.TRIPS.length],
    ['jet', 'private jet expeditions', 'data/atlas/jet/itinerary.json', d => d.TRIPS.length],
    ['train', 'rail journeys', 'data/atlas/train/itinerary.json', d => d.TRIPS.length],
    ['safari', 'safari and wildlife journeys', 'data/atlas/safari/itinerary.json', d => d.TRIPS.length],
  ];
  let drifted = 0;
  for (const [type, noun, rel, count] of counted) {
    const stated = generated[type];
    let actual;
    try { actual = count(JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'))); } catch { continue; }
    if (!stated) { console.warn(`  note     no count for "${type}" in ${COUNTS_FILE} — run npm run build:collection-counts`); continue; }
    if (stated !== actual) { console.warn(`  drift    "${noun}" advertises ${stated}; the feed holds ${actual}`); drifted++; }
  }
  if (!drifted) console.log('  ok       every headline count matches its feed');
}

if (failed) {
  console.error('\nVirtuoso data is stale. Refresh it with: npm run sync:virtuoso');
  process.exit(1);
}
if (unchecked.length) {
  // Never claim the set is current while part of it has never been looked at.
  const list = unchecked.join(', ');
  if (STRICT) {
    console.error(`\nNever synced: ${list}. Run: npm run sync:virtuoso`);
    process.exit(1);
  }
  const current = FEEDS.length - unchecked.length;
  const age = current ? ` (oldest check ${human(worst)} ago)` : '';
  console.warn(`\n${current} of ${FEEDS.length} Virtuoso feeds are current${age}. Never synced: ${list}.`);
  process.exit(0);
}
console.log(`\nVirtuoso feeds are current (oldest check ${human(worst)} ago).`);

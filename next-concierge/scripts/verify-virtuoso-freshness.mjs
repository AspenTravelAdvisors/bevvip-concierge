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

for (const { label, file, key } of FEEDS) {
  const full = path.join(repoRoot, file);
  if (!fs.existsSync(full)) { console.warn(`  absent   ${label} — never synced (${file})`); continue; }

  const entry = status.feeds?.[key];
  const checked = age(entry?.lastChecked);
  const changed = age(entry?.lastChanged);
  const count = entry?.count ?? '?';

  if (checked == null) {
    console.warn(`  unknown  ${label} — no check recorded; run npm run sync:virtuoso`);
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

// The headline count in lib/atlas-config.ts is a hand-kept constant and the
// nightly sync moves the real number underneath it. Nobody would notice the page
// advertising a stale figure, so say so here rather than never.
{
  const hotelsFile = path.join(repoRoot, 'data/atlas/hotel/luxury-hotels.json');
  if (fs.existsSync(hotelsFile)) {
    const hotels = JSON.parse(fs.readFileSync(hotelsFile, 'utf8')).length;
    const config = fs.readFileSync(path.join(repoRoot, 'lib/atlas-config.ts'), 'utf8');
    const stated = Number(/nounPlural: "vetted hotels"[\s\S]*?count: (\d+)/.exec(config)?.[1] ?? 0);
    if (!stated) console.warn('  note     could not read the hotel count from lib/atlas-config.ts');
    else if (stated !== hotels) console.warn(`  drift    lib/atlas-config.ts advertises ${stated} hotels; the feed holds ${hotels}.`);
    else console.log(`  ok       headline count matches the feed (${hotels})`);
  }
}

if (failed) {
  console.error('\nVirtuoso data is stale. Refresh it with: npm run sync:virtuoso');
  process.exit(1);
}
console.log(`\nVirtuoso feeds are current (oldest check ${human(worst)} ago).`);

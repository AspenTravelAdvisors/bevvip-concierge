#!/usr/bin/env node
// Warns when the Virtuoso feed has gone stale.
//
// Itineraries expire and properties change hands, so silently serving a feed
// nobody has refreshed in months is the failure mode worth catching. This warns
// by default and only fails the build past a hard limit, so a weekend outage of
// the nightly sync doesn't block a deploy.
//
//   node scripts/verify-virtuoso-freshness.mjs            # warn past 7 days, fail past 30
//   node scripts/verify-virtuoso-freshness.mjs --strict   # fail past the warn threshold

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/virtuoso/env.mjs';

const STRICT = process.argv.includes('--strict');
const WARN_DAYS = 7;
const FAIL_DAYS = 30;

const feeds = [{ label: 'hotels', file: 'data/atlas/hotel/virtuoso-hotels.json' }];

let worst = 0;
let failed = false;

for (const { label, file } of feeds) {
  const full = path.join(repoRoot, file);
  if (!fs.existsSync(full)) { console.error(`  MISSING  ${label} — ${file} has never been synced`); failed = true; continue; }
  const doc = JSON.parse(fs.readFileSync(full, 'utf8'));
  const synced = doc._meta?.lastSynced;
  if (!synced) { console.error(`  MISSING  ${label} — no lastSynced stamp in ${file}`); failed = true; continue; }
  const days = (Date.now() - Date.parse(synced)) / 86400000;
  worst = Math.max(worst, days);
  const age = days < 1 ? `${Math.round(days * 24)}h` : `${days.toFixed(1)}d`;
  const count = doc._meta?.count ?? doc.hotels?.length ?? '?';
  if (days > FAIL_DAYS || (STRICT && days > WARN_DAYS)) { console.error(`  STALE    ${label} — ${age} old (${count} records)`); failed = true; }
  else if (days > WARN_DAYS) console.warn(`  ageing   ${label} — ${age} old (${count} records); run npm run sync:virtuoso`);
  else console.log(`  ok       ${label} — ${age} old (${count} records)`);
}

if (failed) { console.error(`\nVirtuoso data is stale. Refresh it with: npm run sync:virtuoso`); process.exit(1); }
console.log(`\nVirtuoso feeds are current (oldest ${worst < 1 ? `${Math.round(worst * 24)}h` : `${worst.toFixed(1)}d`}).`);

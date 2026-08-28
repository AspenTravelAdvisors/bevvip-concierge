#!/usr/bin/env node
// Guards the unattended sync against a bad day at the supplier.
//
// The nightly job commits straight to main and nobody is watching when it runs.
// A partial API response or a silently emptied catalogue would otherwise erase
// live inventory and deploy it. This compares what the sync produced against
// what is committed and refuses implausible shrinkage; growth is always fine.
//
// It used to guard luxury-hotels.json and nothing else, which left the raw
// supplier feeds and all six journey atlases unprotected — a night where
// /v2/cruises answered with an empty catalogue would have been committed and
// deployed with no gate in its way. Every feed the sync writes is checked now.
//
//   node scripts/verify-virtuoso-delta.mjs                # per-feed limits below
//   node scripts/verify-virtuoso-delta.mjs --max-shrink 0.05   # override them all
//   node scripts/verify-virtuoso-delta.mjs --json         # machine-readable

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repoRoot } from '../lib/virtuoso/env.mjs';

const arg = f => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const JSON_OUT = process.argv.includes('--json');
const OVERRIDE = arg('--max-shrink') != null ? Number(arg('--max-shrink')) : null;

/*
 * How much each feed is allowed to lose overnight.
 *
 * The default is 10%: a supplier delisting a tenth of its catalogue in one night
 * is not a business event, it is a broken response. Two kinds of feed get more
 * room, for reasons that are real rather than generous:
 *
 *   Promotions expire on fixed dates, and campaigns end in batches — a seasonal
 *   offer closing can take a large slice of the feed with it on one particular
 *   morning, legitimately.
 *
 *   The journey atlases lose departures as they sail. They also carry the merge's
 *   own 25% guard (MAX_ATLAS_SHRINK in merge-virtuoso-journeys.mjs), which asks a
 *   different question — that one compares against the curated base, this one
 *   against what is actually committed and serving — so the two are worth having
 *   together at the same limit.
 */
const DEFAULT_MAX_SHRINK = 0.10;
const EXPIRES_IN_BATCHES = 0.30;
const ATLAS_SHRINK = 0.25;

const FEEDS = [
  // Supplier truth, straight off the API. If a crawl came back short, it shows here first.
  { label: 'hotels (supplier feed)', file: 'data/atlas/hotel/virtuoso-hotels.json', count: d => d.hotels.length },
  { label: 'promotions', file: 'data/atlas/shared/virtuoso-promotions.json', count: d => d.promotions.length, max: EXPIRES_IN_BATCHES },
  { label: 'cruises', file: 'data/atlas/shared/virtuoso-cruises.json', count: d => d.cruises.length },
  { label: 'tours', file: 'data/atlas/shared/virtuoso-tours.json', count: d => d.tours.length },

  // What the site actually serves, after the merges.
  { label: 'hotels (merged atlas)', file: 'data/atlas/hotel/luxury-hotels.json', count: d => d.length },
  { label: 'expedition sailings', file: 'data/atlas/cruise/sailings.json', count: d => d.rows.length, max: ATLAS_SHRINK },
  { label: 'yacht voyages', file: 'data/atlas/yacht/itinerary.json', count: d => d.TRIPS.length, max: ATLAS_SHRINK },
  { label: 'world cruises', file: 'data/atlas/world/itinerary.json', count: d => d.TRIPS.length, max: ATLAS_SHRINK },
  { label: 'jet expeditions', file: 'data/atlas/jet/itinerary.json', count: d => d.TRIPS.length, max: ATLAS_SHRINK },
  { label: 'rail journeys', file: 'data/atlas/train/itinerary.json', count: d => d.TRIPS.length, max: ATLAS_SHRINK },
  { label: 'safari journeys', file: 'data/atlas/safari/itinerary.json', count: d => d.TRIPS.length, max: ATLAS_SHRINK },
];

/** The count in the working tree, or null if the file cannot be read or shaped. */
function nowCount(feed) {
  try { return feed.count(JSON.parse(fs.readFileSync(path.join(repoRoot, feed.file), 'utf8'))); }
  catch { return null; }
}

/** The count in the last commit, or null when there is no baseline to compare against. */
function beforeCount(feed) {
  // repoRoot is next-concierge/; git wants the path from the repository root.
  const rel = `next-concierge/${feed.file}`;
  try {
    const blob = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: repoRoot, maxBuffer: 1 << 28 }).toString();
    return feed.count(JSON.parse(blob));
  } catch { return null; }
}

const rows = [];
let refused = 0;

for (const feed of FEEDS) {
  const limit = OVERRIDE ?? feed.max ?? DEFAULT_MAX_SHRINK;
  const now = nowCount(feed);
  const before = beforeCount(feed);

  if (now == null) {
    // A feed the sync did not write is not this gate's business — a crawl that
    // failed outright is reported by the step that ran it. A feed that IS on
    // disk but unreadable is, and reads as null here too, so say which.
    const exists = fs.existsSync(path.join(repoRoot, feed.file));
    rows.push({ label: feed.label, state: exists ? 'unreadable' : 'absent', now, before, limit });
    if (exists) refused++;
    continue;
  }
  if (before == null) {
    rows.push({ label: feed.label, state: 'new', now, before, limit });
    continue;
  }

  const delta = now - before;
  const shrink = before ? -delta / before : 0;
  const state = shrink > limit ? 'REFUSED' : 'ok';
  if (state === 'REFUSED') refused++;
  rows.push({ label: feed.label, state, now, before, limit, shrink });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ refused, feeds: rows }, null, 1));
} else {
  for (const r of rows) {
    const pad = r.label.padEnd(24);
    if (r.state === 'absent') { console.log(`  absent   ${pad} not written by this run`); continue; }
    if (r.state === 'unreadable') { console.error(`  BROKEN   ${pad} on disk but unparseable`); continue; }
    if (r.state === 'new') { console.log(`  new      ${pad} ${r.now} records, no committed baseline`); continue; }
    const move = r.now - r.before;
    const pct = (r.shrink * 100).toFixed(1);
    const arrow = `${r.before} → ${r.now} (${move >= 0 ? '+' : ''}${move})`;
    if (r.state === 'REFUSED') console.error(`  REFUSED  ${pad} ${arrow} — ${pct}% smaller, limit ${(r.limit * 100).toFixed(0)}%`);
    else console.log(`  ok       ${pad} ${arrow}`);
  }
}

if (refused) {
  console.error(`\nREFUSING to commit: ${refused} feed${refused > 1 ? 's' : ''} above the shrink limit.`);
  console.error('That usually means a partial API response, not a real delisting. Nothing is');
  console.error('committed, so the currently deployed data stays live and tonight\'s crawl');
  console.error('resumes from cache tomorrow. Inspect the feed before overriding.');
  process.exit(1);
}
console.log('\nEvery feed is within its shrink limit.');

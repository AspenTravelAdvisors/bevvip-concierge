#!/usr/bin/env node
// Guards the unattended sync against a bad day at the supplier.
//
// The nightly job commits straight to main, so nobody is watching when it runs.
// A partial API response or a silently emptied catalogue would otherwise erase
// live inventory and deploy it. This compares what the sync produced against
// what is committed and refuses implausible shrinkage; growth is always fine.
//
//   node scripts/verify-virtuoso-delta.mjs            # 10% shrink allowed
//   node scripts/verify-virtuoso-delta.mjs --max-shrink 0.05

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repoRoot } from '../lib/virtuoso/env.mjs';

const arg = f => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const MAX_SHRINK = Number(arg('--max-shrink') ?? 0.10);

const rel = 'next-concierge/data/atlas/hotel/luxury-hotels.json';
const full = path.join(repoRoot, 'data/atlas/hotel/luxury-hotels.json');

const now = JSON.parse(fs.readFileSync(full, 'utf8')).length;

let before;
try {
  before = JSON.parse(execFileSync('git', ['show', `HEAD:${rel}`], { cwd: repoRoot, maxBuffer: 1 << 28 }).toString()).length;
} catch {
  console.log(`no committed baseline yet — accepting ${now} properties`);
  process.exit(0);
}

const delta = now - before;
const shrink = before ? -delta / before : 0;
const pct = (shrink * 100).toFixed(1);

if (shrink > MAX_SHRINK) {
  console.error(`REFUSING: hotel count fell from ${before} to ${now} (${pct}% smaller, limit ${(MAX_SHRINK * 100).toFixed(0)}%).`);
  console.error('That usually means a partial API response, not a real delisting. Inspect the feed before committing.');
  process.exit(1);
}

console.log(`delta ok — ${before} to ${now} (${delta >= 0 ? '+' : ''}${delta})`);

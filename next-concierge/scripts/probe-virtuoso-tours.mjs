#!/usr/bin/env node
// One-off diagnostic for the /v2/tours paging cap (Oct 2026).
//
// Prints two things the tours sync needs before it can split its search:
//   1. whether the page at startRow 5000 still comes back empty, and
//   2. the facet catalogue — the filter names and values /v2/tours accepts.
//
//   node scripts/probe-virtuoso-tours.mjs

import fs from 'node:fs';
import { loadEnv } from '../lib/virtuoso/env.mjs';
import { createClient } from '../lib/virtuoso/client.mjs';

loadEnv();
const v = createClient({ log: msg => console.log(msg) });

for (const startRow of [0, 2500, 5000, 7500]) {
  const page = await v.call('/v2/tours', { rowsPerPage: 2500, startRow });
  console.log(`page at startRow ${startRow}: ${page.result?.data?.length ?? 0} rows of ${page.result?.totalRows ?? '?'}`);
}

/*
 * Narrow the failing page down to the rows that break it.
 *
 * The 5000 page answered "0 rows of 0" while 7500 answered normally, so this is
 * not a depth cap: something inside 5000-7499 makes the server give up on the
 * whole page. Halve each failing range until single rows are left.
 */
const bad = [];
async function bisect(start, size) {
  const page = await v.call('/v2/tours', { rowsPerPage: size, startRow: start });
  const got = page.result?.data?.length ?? 0;
  if (got > 0 || (page.result?.totalRows ?? 0) > 0) return;
  if (size === 1) { bad.push(start); console.log(`  bad row at startRow ${start}`); return; }
  const half = Math.ceil(size / 2);
  await bisect(start, half);
  await bisect(start + half, size - half);
}
console.log('\n--- bisecting startRow 5000..7499 ---');
await bisect(5000, 2500);
console.log(`failing rows: ${bad.length ? bad.join(', ') : 'none (the page works again)'}`);
// What the neighbours of each failing row look like, to see what breaks it.
for (const b of bad.slice(0, 5)) {
  const around = await v.call('/v2/tours', { rowsPerPage: 1, startRow: b - 1 });
  const r = around.result?.data?.[0];
  console.log(`  row before ${b}: ${r ? `${r.id} ${r.name} (${r.company})` : 'none'}`);
}

const filters = await v.filters('/v2/tours');
fs.writeFileSync('tours-filters.json', JSON.stringify(filters, null, 1));

// A summary, not the dump: the full catalogue is ~70,000 log lines, mostly
// one-tour place names. Each category's scalar fields (its name and the query
// parameter it maps to, whatever the API calls them), its value count, and
// the values that could split 13,000 tours into pieces under 5,000.
console.log('\n--- facet catalogue summary ---');
for (const cat of Array.isArray(filters) ? filters : [filters]) {
  const listKey = Object.keys(cat).find(k => Array.isArray(cat[k]));
  const meta = Object.fromEntries(Object.entries(cat).filter(([k]) => k !== listKey));
  const vals = (cat[listKey] ?? []).slice().sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const sum = vals.reduce((n, x) => n + (x.count ?? 0), 0);
  console.log(`\n${JSON.stringify(meta)}  [${vals.length} values in "${listKey}", counts sum to ${sum}, largest ${vals[0]?.count ?? 0}]`);
  if (vals[0]) console.log(`  value keys: ${Object.keys(vals[0]).join(', ')}`);
  console.log('  ' + vals.slice(0, 25).map(x => `${x.name ?? JSON.stringify(x)}: ${x.count}`).join(' · '));
}

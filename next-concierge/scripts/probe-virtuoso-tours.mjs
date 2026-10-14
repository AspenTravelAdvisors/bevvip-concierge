#!/usr/bin/env node
// One-off check for the /v2/tours short-read (Oct 2026): runs the real
// searchAll against the live API a few times and reports what it got.
//
//   node scripts/probe-virtuoso-tours.mjs

import { loadEnv } from '../lib/virtuoso/env.mjs';
import { createClient } from '../lib/virtuoso/client.mjs';

loadEnv();
const v = createClient({ log: msg => console.log(msg) });

let failed = 0;
for (let i = 1; i <= 3; i++) {
  try {
    const { rows, totalRows } = await v.searchAll('/v2/tours');
    const unique = new Set(rows.map(r => String(r.id))).size;
    console.log(`attempt ${i}: ${rows.length}/${totalRows} rows, ${unique} unique ids`);
  } catch (err) { failed++; console.log(`attempt ${i}: FAILED — ${err.message}`); }
}
if (failed) process.exitCode = 1;

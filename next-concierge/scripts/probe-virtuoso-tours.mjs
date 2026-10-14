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

const filters = await v.filters('/v2/tours');
fs.writeFileSync('tours-filters.json', JSON.stringify(filters, null, 1));
console.log('\n--- facet catalogue ---');
console.log(JSON.stringify(filters, null, 1));

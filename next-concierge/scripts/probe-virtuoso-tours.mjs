#!/usr/bin/env node
// One-off probe (Oct 2026): can /v2/tours be crawled without paging?
//
// A full paged crawl returns 13,202 rows but only ~12,900-13,050 distinct ids,
// different on every run — the order shifts between pages, so some tours come
// back twice and others never. If the search can be filtered by company (the
// largest has 971 tours), every query fits on one 2,500-row page and order
// stops mattering. This finds the parameter name and tests that crawl.
//
//   node scripts/probe-virtuoso-tours.mjs

import { loadEnv } from '../lib/virtuoso/env.mjs';
import { createClient } from '../lib/virtuoso/client.mjs';

loadEnv();
const v = createClient({ log: msg => console.log(msg) });
const ids = rows => rows.map(r => String(r.id));

// 1. Is the order stable between two identical requests?
const a = ids((await v.call('/v2/tours', { rowsPerPage: 2500, startRow: 0 })).result?.data ?? []);
const b = ids((await v.call('/v2/tours', { rowsPerPage: 2500, startRow: 0 })).result?.data ?? []);
const sameSet = a.filter(id => new Set(b).has(id)).length;
const samePos = a.filter((id, i) => b[i] === id).length;
console.log(`page 0 twice: ${a.length} vs ${b.length} rows, ${sameSet} ids in both, ${samePos} in the same position`);
console.log(`  duplicate ids within one page: ${a.length - new Set(a).size}`);

// 2. Which parameter filters each facet? An ignored parameter returns the whole
//    catalogue; the right one returns the facet's own count.
const facets = await v.filters('/v2/tours');
const facet = name => facets.find(f => f.category === name)?.facets ?? [];
const pick = (name, want) => facet(name).find(x => x.name === want) ?? facet(name).slice().sort((x, y) => x.count - y.count)[0];

const CANDIDATES = {
  'Company':       ['companies', 'company', 'companyNames', 'companyName', 'suppliers', 'tourCompanies', 'tourOperators'],
  'Length':        ['lengths', 'length', 'travelLengths', 'tourLengths'],
  'Travel Style':  ['travelStyles', 'travelstyles', 'travelStyle'],
  'Destination':   ['destinations', 'destinationRegions', 'searchRegions', 'regions'],
  'Experiences':   ['experiences', 'tourExperiences'],
};
const WANT = { 'Company': 'Tauck', 'Length': '22+ days', 'Travel Style': 'Rail', 'Destination': 'Antarctica', 'Experiences': 'Festivals & Events' };

const found = {};
console.log('\n--- parameter names ---');
for (const [cat, names] of Object.entries(CANDIDATES)) {
  const val = pick(cat, WANT[cat]);
  if (!val) { console.log(`${cat}: no facet values`); continue; }
  for (const p of names) {
    const res = await v.call('/v2/tours', { [p]: val.name, rowsPerPage: 1, startRow: 0 });
    const n = res.result?.totalRows ?? 0;
    const hit = n > 0 && n <= val.count * 1.1 && n >= val.count * 0.9;
    console.log(`${cat}: ${p}=${JSON.stringify(val.name)} -> ${n} rows (facet says ${val.count})${hit ? '  <-- works' : ''}`);
    if (hit && !found[cat]) found[cat] = p;
  }
}
console.log(`\nworking parameters: ${JSON.stringify(found)}`);

// 3. If company filtering works, crawl every company on one page each.
if (found.Company) {
  const companies = facet('Company');
  const seen = new Set();
  let rows = 0, short = [], paged = 0;
  for (const c of companies) {
    const res = await v.call('/v2/tours', { [found.Company]: c.name, rowsPerPage: 2500, startRow: 0 });
    const data = res.result?.data ?? [];
    const total = res.result?.totalRows ?? 0;
    if (total > 2500) paged++;
    if (data.length < total || total !== c.count) short.push(`${c.name}: ${data.length}/${total} (facet ${c.count})`);
    rows += data.length;
    for (const id of ids(data)) seen.add(id);
  }
  console.log(`\n--- crawl by company ---`);
  console.log(`${companies.length} companies, ${rows} rows, ${seen.size} distinct ids (catalogue total ${facets.find(f => f.category === 'Company') ? companies.reduce((n, c) => n + c.count, 0) : '?'})`);
  console.log(`companies needing more than one page: ${paged}`);
  console.log(`companies whose rows did not match their facet count: ${short.length}`);
  for (const s of short.slice(0, 20)) console.log(`  ${s}`);
}

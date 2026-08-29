#!/usr/bin/env node
/**
 * Build data/atlas/shared/journey-facts.json — the answer pages' view of the
 * six route atlases.
 *
 * WHY AN ARTIFACT AND NOT A LIVE IMPORT. The hotel copy stopped typing its
 * counts months ago: `{{hotels:program=Marriott STARS}}` is a query against the
 * shipped feed. The journey copy could not follow, because a `{{journeys:…}}`
 * term would have pulled every route feed plus 3.6MB of cruise route geometry
 * into the answers bundle — for the sake of counting rows. So the counting
 * fields, and only those, are precomputed here: one row per ITINERARY (1,991),
 * not per departure (4,960), which is also the unit the /journeys pages serve.
 *
 * The grouping comes from lib/seo/journey-key.mjs, the same module the pages
 * use, so a count in a sentence and the page it links to cannot disagree about
 * what an itinerary is.
 *
 *   node scripts/build-journey-facts.mjs           # write
 *   node scripts/build-journey-facts.mjs --check   # fail if it would change
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../lib/virtuoso/env.mjs';
import { buildAdapters } from './lib/adapters-build.mjs';
import { groupItineraries } from '../lib/seo/journey-key.mjs';

const CHECK = process.argv.includes('--check');
const OUT = path.join(repoRoot, 'data/atlas/shared/journey-facts.json');
const read = rel => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));

const ADAPTERS = buildAdapters(repoRoot);
const adapter = name => import(pathToFileURL(path.join(ADAPTERS, 'adapters', `${name}.js`)).href);

const { adaptCruise } = await adapter('cruise');
const { adaptWorldCruise } = await adapter('worldcruise');
const { adaptYacht } = await adapter('yacht');
const { adaptTrain } = await adapter('train');
const { adaptJet } = await adapter('jet');
const { adaptSafari } = await adapter('safari');

const COLLECTIONS = {
  cruise: () =>
    adaptCruise(
      read('data/atlas/cruise/sailings.json'),
      read('data/atlas/cruise/atlas-meta.json'),
      read('public/maps/cruise/data/itinerary-routes.json'),
      read('data/atlas/cruise/region-overrides.json'),
    ),
  worldcruise: () => adaptWorldCruise(read('data/atlas/world/itinerary.json')),
  yacht: () => adaptYacht(read('data/atlas/yacht/itinerary.json')),
  train: () => adaptTrain(read('data/atlas/train/itinerary.json')),
  jet: () => adaptJet(read('data/atlas/jet/itinerary.json')),
  safari: () => adaptSafari(read('data/atlas/safari/itinerary.json')),
};

const rows = [];
for (const [collection, adapt] of Object.entries(COLLECTIONS)) {
  for (const g of groupItineraries(adapt())) {
    const countries = new Set();
    const regions = new Set();
    const vessels = new Set();
    for (const o of g.departures) {
      if (o.country) countries.add(o.country);
      for (const r of o.regions || []) regions.add(r);
      if (o.vessel) vessels.add(o.vessel);
    }
    // Short keys on purpose: 1,991 rows ship to the client bundle, and the
    // full field names cost more than the values do.
    rows.push({
      c: collection,
      s: g.slug,
      t: g.title,
      o: g.operator,
      co: [...countries],
      r: [...regions],
      v: [...vessels],
      d: g.departures.map(o => o.days).find(n => Number.isFinite(n)) ?? null,
      n: g.departures.length,
      w: g.departures.some(o => o.world),
      od: g.departures.every(o => o.onDemand),
      p: g.departures.some(o => o.hasPromotion),
    });
  }
}

const doc = {
  _meta: {
    purpose: 'Countable facts about every journey itinerary, for the {{journeys:…}} fact tokens in data/answers/*.js.',
    unit: 'One row per ITINERARY, not per departure — the same grouping lib/seo/journeys.js serves pages from (lib/seo/journey-key.mjs).',
    generator: 'scripts/build-journey-facts.mjs',
    note: 'Generated and committed, not fetched. A supplier change lands as a reviewable diff, the same discipline the feeds themselves follow.',
    itineraries: rows.length,
    departures: rows.reduce((n, r) => n + r.n, 0),
  },
  rows,
};

const serialized = `${JSON.stringify({ _meta: doc._meta }, null, 1).replace(/\n?\}$/, '')},\n "rows": [\n${rows.map(r => ` ${JSON.stringify(r)}`).join(',\n')}\n ]\n}\n`;

const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
const nf = new Intl.NumberFormat('en-US');
const summary = `${nf.format(rows.length)} itineraries from ${nf.format(doc._meta.departures)} departures across ${Object.keys(COLLECTIONS).length} collections`;

if (CHECK) {
  if (existing === serialized) {
    console.log(`journey-facts: current — ${summary}`);
    process.exit(0);
  }
  console.error(
    existing === null
      ? 'journey-facts: data/atlas/shared/journey-facts.json is missing — run npm run build:journey-facts'
      : 'journey-facts: STALE — the feeds have moved since it was generated. Run npm run build:journey-facts and review the diff.',
  );
  process.exit(1);
}

fs.writeFileSync(OUT, serialized);
console.log(`journey-facts: wrote ${summary} → data/atlas/shared/journey-facts.json`);

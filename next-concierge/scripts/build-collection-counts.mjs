#!/usr/bin/env node
/**
 * Build lib/atlas-counts.ts — how many records each collection actually ships.
 *
 * WHY THIS EXISTS. lib/atlas-config.ts carried a hand-written `count` per
 * collection, and four surfaces read it: the Explore menu's per-item count, the
 * home headline, the blurb and the map overlay line. The atlas itself counts
 * nothing of the sort — its filter rail says "N matches" over the feed it just
 * fetched. So the two numbers were a claim and its subject, kept in separate
 * places by hand, and they had drifted: the menu offered 3,662 expedition
 * sailings over an atlas holding 4,295, and 274 safari journeys over 450. A
 * visitor who clicked the number saw it change.
 *
 * Deriving it is the only version that stays true. This counts each collection
 * the way its own atlas surface counts it — through the SHIPPED adapters, not a
 * transcription of them — so the menu and the rail are answering with the same
 * arithmetic over the same rows.
 *
 * ── WHAT IT COUNTS, AND THE ONE DIFFERENCE THAT SURVIVES ───────────────────
 *
 * The catalogue: every record the collection ships. The rail additionally hides
 * departures that have already sailed (filter.ts `isPast`), and that cutoff
 * moves every day — so a build-time number that applied it would be wrong by
 * the following morning and would churn this file nightly for no supplier
 * reason. The catalogue is the stable half, and it is also the honest one for
 * prose: "467 hotel-brand yacht voyages" describes the collection, not today's
 * remaining departures.
 *
 * The residual is therefore real and bounded: between deploys the rail can read
 * lower than the menu by however many departures have passed. `--report` prints
 * that gap per collection so it stays visible rather than being discovered.
 *
 * ── WHY A .ts AND NOT A .json IN data/ ─────────────────────────────────────
 *
 * Because lib/atlas-config.ts is compiled on its own by three verifiers, which
 * copy it into a temp directory and run tsc over it with no bundler behind
 * them. A `@/data/…json` import survives none of that: the alias needs `paths`,
 * the JSON needs `resolveJsonModule`, and Node then needs an import attribute
 * on the emitted specifier. A generated sibling module imported the way the
 * registry already imports `./types` needs none of the three, and it is source
 * rather than data anyway — eight numbers read by exactly one module.
 *
 *   node scripts/build-collection-counts.mjs            # write
 *   node scripts/build-collection-counts.mjs --check    # fail if it would change
 *   node scripts/build-collection-counts.mjs --report   # also print today's rail count
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../lib/virtuoso/env.mjs';
import { buildAdapters } from './lib/adapters-build.mjs';

const CHECK = process.argv.includes('--check');
const REPORT = process.argv.includes('--report');
const OUT = path.join(repoRoot, 'lib/atlas-counts.ts');
const read = rel => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));

const ADAPTERS = buildAdapters(repoRoot);
const adapter = name => import(pathToFileURL(path.join(ADAPTERS, 'adapters', `${name}.js`)).href);

const { adaptCruise, CRUISE_DESCRIPTOR } = await adapter('cruise');
const { adaptWorldCruise, WORLDCRUISE_DESCRIPTOR } = await adapter('worldcruise');
const { adaptYacht, YACHT_DESCRIPTOR } = await adapter('yacht');
const { adaptTrain, TRAIN_DESCRIPTOR } = await adapter('train');
const { adaptJet, JET_DESCRIPTOR } = await adapter('jet');
const { adaptSafari, SAFARI_DESCRIPTOR } = await adapter('safari');
const { adaptHotels, HOTEL_DESCRIPTOR } = await adapter('hotel');
const { matchesOffering } = await adapter('filter');

/*
 * The feeds, read from the canonical data/atlas copy — byte-identical to the
 * public/maps copy the browser fetches (scripts/merge-virtuoso-journeys.mjs
 * writes both together), and the same side scripts/build-journey-facts.mjs
 * reads.
 *
 * hotel is the exception: its atlas fetches the built point collection rather
 * than the merged record file, so that is what gets counted — the rail cannot
 * plot a hotel that build-hotel-points dropped.
 */
const ADAPTED = {
  hotel: () => [adaptHotels(read('public/maps/hotel/hotel-points.json')), HOTEL_DESCRIPTOR],
  cruise: () => [
    adaptCruise(
      read('data/atlas/cruise/sailings.json'),
      read('data/atlas/cruise/atlas-meta.json'),
      read('public/maps/cruise/data/itinerary-routes.json'),
      read('data/atlas/cruise/region-overrides.json'),
    ),
    CRUISE_DESCRIPTOR,
  ],
  worldcruise: () => [adaptWorldCruise(read('data/atlas/world/itinerary.json')), WORLDCRUISE_DESCRIPTOR],
  yacht: () => [adaptYacht(read('data/atlas/yacht/itinerary.json')), YACHT_DESCRIPTOR],
  train: () => [adaptTrain(read('data/atlas/train/itinerary.json')), TRAIN_DESCRIPTOR],
  jet: () => [adaptJet(read('data/atlas/jet/itinerary.json')), JET_DESCRIPTOR],
  safari: () => [adaptSafari(read('data/atlas/safari/itinerary.json')), SAFARI_DESCRIPTOR],
};

/*
 * Villa has no adapter and no map feed: its atlas is server-rendered and every
 * count on it comes back from searchVillas(). Counting the raw `villas` array
 * would be a second implementation of "what is a villa" — an unfiltered search
 * is the same question the surface asks.
 */
const { searchVillas } = await import(pathToFileURL(path.join(repoRoot, 'lib/villas.js')).href);

const EMPTY_STATE = () => ({
  brands: new Set(), vessels: new Set(), months: new Set(), ids: new Set(),
  regions: new Set(), excludedRegions: new Set(), stop: null, stopRole: 'any',
  terms: [], minDays: null, maxDays: null,
});

const counts = {};
const live = {};
for (const [type, load] of Object.entries(ADAPTED)) {
  const [offerings, descriptor] = load();
  counts[type] = offerings.length;
  if (REPORT) {
    const today = new Date().toISOString().slice(0, 10);
    live[type] = offerings.filter(o => matchesOffering(o, EMPTY_STATE(), descriptor, today)).length;
  }
}
counts.villa = searchVillas({ perPage: 1 }).total;
if (REPORT) live.villa = counts.villa;

/*
 * Key order is the registry's, not insertion order, so the file reads like
 * lib/atlas-config.ts and a collection added there lands in the same place
 * here. The registry is TypeScript, so the order is lifted from its source
 * rather than imported — the only thing needed is the sequence of `type:` keys.
 */
const registry = fs.readFileSync(path.join(repoRoot, 'lib/atlas-config.ts'), 'utf8');
const declared = [...registry.matchAll(/^ {4}type: "([a-z]+)",$/gm)].map(m => m[1]);
const missing = declared.filter(t => counts[t] == null);
const extra = Object.keys(counts).filter(t => !declared.includes(t));
if (missing.length || extra.length) {
  console.error(
    `collection-counts: this generator and lib/atlas-config.ts disagree about the collections.\n` +
    (missing.length ? `  in the registry, not counted here: ${missing.join(', ')}\n` : '') +
    (extra.length ? `  counted here, not in the registry: ${extra.join(', ')}\n` : '') +
    `  Every collection must be counted, or its Explore menu entry states a number nothing checks.`,
  );
  process.exit(1);
}

const ordered = Object.fromEntries(declared.map(t => [t, counts[t]]));
const total = declared.reduce((n, t) => n + counts[t], 0);
const nf = new Intl.NumberFormat('en-US');

/*
 * No timestamp. Every other generated artifact here carries one and needs
 * scripts/lib/steady-stamp.mjs to stop the nightly sync rewriting it for no
 * supplier reason; a file whose entire content is eight integers has nothing to
 * steady — it changes when, and only when, a count does.
 */
const serialized = `// GENERATED by scripts/build-collection-counts.mjs — do not edit by hand.
//
// How many records each collection ships, counted through the SAME adapters its
// atlas uses. lib/atlas-config.ts reads this for \`count\`, which the Explore
// menu, the home headline, the blurb and the map overlay line all state out
// loud — so the number the menu offers and the number that collection's filter
// rail reproduces are the same arithmetic over the same rows.
//
// The rail additionally hides departures that have already sailed, a cutoff
// that moves daily; these are catalogue counts, so between deploys the rail can
// read lower by however many have passed. \`npm run build:collection-counts --
// --report\` prints today's gap.
//
// ${nf.format(total)} records across ${declared.length} collections.
export const COLLECTION_COUNTS = {
${declared.map(t => `  ${t}: ${ordered[t]},`).join('\n')}
} as const;
`;
const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
const summary = `${nf.format(total)} records across ${declared.length} collections`;

if (REPORT) {
  const gaps = declared
    .map(t => ({ t, ships: counts[t], now: live[t] }))
    .filter(r => r.ships !== r.now);
  console.log(
    gaps.length
      ? `collection-counts: today the rail hides departed journeys on ${gaps.length} of ${declared.length} collections —\n` +
        gaps.map(r => `  ${r.t}: ships ${nf.format(r.ships)}, rail shows ${nf.format(r.now)} (-${nf.format(r.ships - r.now)})`).join('\n')
      : 'collection-counts: every collection\'s rail shows its full catalogue today.',
  );
}

if (CHECK) {
  if (existing === serialized) {
    console.log(`collection-counts: current — ${summary}`);
    process.exit(0);
  }
  console.error(
    existing === null
      ? 'collection-counts: lib/atlas-counts.ts is missing — run npm run build:collection-counts'
      : 'collection-counts: STALE — the feeds have moved since it was generated, so the Explore menu is stating counts the atlas will not reproduce. Run npm run build:collection-counts and review the diff.',
  );
  process.exit(1);
}

fs.writeFileSync(OUT, serialized);
console.log(`collection-counts: wrote ${summary} → lib/atlas-counts.ts`);

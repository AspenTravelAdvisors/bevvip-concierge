#!/usr/bin/env node
/**
 * Every fit row an atlas binds must describe the record it is bound to.
 *
 * WHAT THIS IS GUARDING
 *
 * itinerary-fit.json is keyed by atlas item id. For most atlases that id comes
 * from the supplier and is stable for as long as the product exists. For the
 * jet atlas it is an ARRAY POSITION — `jt_<arrayIndex>`, see the WARNING in
 * lib/atlas/adapters/jet.ts — because the jet feed ships no id at all.
 *
 * A position is not an identity. `merge:virtuoso-journeys` re-emits TRIPS with
 * the curated block at the head and the supplier tours behind it, and the
 * supplier half is refreshed nightly. The jet rows drifted, and 79 of 127
 * journeys ended up bound to a row belonging to a different supplier.
 *
 * The damage was not confined to guest scores. `resolveBrandId()` trusts a
 * row's `brandId` ahead of the record's own label, so a drifted row also chose
 * the brand profile, the advisor overlay, the relationship boost and the
 * client-safe notes. The Guide ranked an intent using one supplier's profile
 * while naming another supplier's journey — confidently, and with a rationale
 * that read as though it had been written for the trip on screen.
 *
 * lib/atlas/supplier-fit.js `fitRowFor()` now binds by id only when the row and
 * the record agree about the brand, falls back to the identity carried in the
 * row's own advisorNote, and returns null rather than guessing. This asserts
 * that guarantee across every atlas, because the next curated trip added to the
 * jet base shifts those indices again.
 *
 * WHAT IT DOES NOT ASSERT
 *
 * Coverage. A record with no fit row ranks off its brand profile, which is a
 * loss of precision and not a defect — 67 jet journeys and 1,609 expedition
 * sailings are in that state and the build should not fail over it. The counts
 * are printed so the gap stays visible.
 *
 *   node scripts/verify-fit-binding.mjs
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { repoRoot } from '../lib/virtuoso/env.mjs';

const require = createRequire(import.meta.url);
const load = rel => require(path.join(repoRoot, rel));

const { fitRowFor } = load('lib/atlas/supplier-fit.js');

const ATLASES = [
  ['jet', 'lib/atlas/journeys.js', 'journeys'],
  ['expedition', 'lib/atlas/cruises-expedition.js', 'cruises'],
  ['worldcruise', 'lib/atlas/cruises-world.js', 'sailings'],
  ['yacht', 'lib/atlas/sailings.js', 'sailings'],
  ['safari', 'lib/atlas/safaris.js', 'safaris'],
  ['rail', 'lib/atlas/trains.js', 'journeys'],
];

const norm = s => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/** advisorNote opens with the supplier's display name — the like-for-like check. */
const noteBrand = row => String(row?.advisorNote ?? '').split(';')[0].trim();

/*
 * `brandId` is NOT the comparison. It is a slug from the brand registry and it
 * deliberately does not spell the atlas's label: the expedition atlas calls the
 * operator "National Geographic-Lindblad Expeditions" and the registry calls it
 * `lindblad`. Comparing those two reports 1,923 misaligned expedition sailings
 * that are in fact bound correctly — a false alarm large enough to bury the 79
 * real ones. Ask the question in the vocabulary both sides actually share.
 */
const failures = [];
let totalBound = 0, totalAbsent = 0;

console.log('\nFIT BINDING\n');

for (const [name, modPath, listKey] of ATLASES) {
  const mod = load(modPath);
  const list = mod[listKey] ?? Object.values(mod).find(Array.isArray);
  if (!list) {
    failures.push(`${name}: could not find the record list (export "${listKey}")`);
    continue;
  }

  let bound = 0, wrong = 0, absent = 0;
  const examples = [];
  for (const item of list) {
    const row = fitRowFor(item);
    if (!row) { absent++; continue; }
    const label = item.brand || item.operator;
    if (norm(noteBrand(row)) === norm(label)) { bound++; continue; }
    wrong++;
    if (examples.length < 3) {
      examples.push(`${item.id} is "${label}" but its row describes "${noteBrand(row)}"`);
    }
  }

  totalBound += bound;
  totalAbsent += absent;
  const mark = wrong ? '✗' : '✓';
  console.log(`  ${mark} ${name.padEnd(12)} ${String(list.length).padStart(5)} records · ` +
    `${String(bound).padStart(5)} bound · ${String(wrong).padStart(4)} wrong · ${String(absent).padStart(5)} no row`);

  if (wrong) {
    failures.push(`${name}: ${wrong} record${wrong === 1 ? '' : 's'} bound to another supplier's fit row\n` +
      examples.map(e => `      ${e}`).join('\n'));
  }
}

console.log(`\n  ${totalBound} bound · ${totalAbsent} ranking off the brand profile alone`);

if (failures.length) {
  console.error('\n✗ fit rows are bound to records they do not describe:\n');
  for (const f of failures) console.error(`  · ${f}`);
  console.error('\n  lib/atlas/supplier-fit.js fitRowFor() should have dropped these rather than');
  console.error('  binding them. A wrong row picks the wrong brand profile, overlay and notes.\n');
  process.exit(1);
}

console.log('\nok — every bound fit row describes its record\n');

// The values an answer page can actually query, with how many rows each hits.
//
// `{{hotels:program=…}}` and friends throw on an unknown KEY but happily count
// an unknown VALUE as zero, and verify:seo then fails the page. Whoever writes
// an answer — a person, or scripts/draft-answers.mjs asking a model — needs the
// real values up front rather than guessing spellings and reading red builds.
//
// Loaded the way verify-seo.mjs loads the feed (overlays applied, non-places
// dropped), so a count listed here is the count the page will render.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { repoRoot } from '../../lib/virtuoso/env.mjs';

const require = createRequire(import.meta.url);
const read = rel => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));

function tally(rows, pick, min) {
  const counts = new Map();
  for (const row of rows) {
    const vals = pick(row);
    for (const v of Array.isArray(vals) ? vals : [vals]) {
      if (v == null || v === '') continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

export function answerVocabulary() {
  const { applyHotelOverlays } = require('../../lib/atlas/hotel-overlays.js');
  const { isNotAPlace } = require('../../lib/atlas/country-overrides.js');
  const hotels = applyHotelOverlays(read('data/atlas/hotel/luxury-hotels.json')).filter(
    h => !isNotAPlace(h.country),
  );
  const journeys = read('data/atlas/shared/journey-facts.json').rows || [];

  return {
    hotels: {
      total: hotels.length,
      program: tally(hotels, h => h.program, 1),
      brand: tally(hotels, h => h.brand, 3),
      category: tally(hotels, h => h.category, 1),
      country: tally(hotels, h => h.country, 3),
      region: tally(hotels, h => [h.adminRegion, h.region], 5),
      experience: tally(hotels, h => h.experiences, 3),
      vibe: tally(hotels, h => h.vibes, 3),
      tag: tally(hotels, h => h.tags, 5),
      perksTrue: hotels.filter(h => (h.vipUpgrades || []).length > 0).length,
      promoTrue: hotels.filter(h => h.hasPromotion).length,
    },
    journeys: {
      total: journeys.length,
      collection: tally(journeys, j => j.c, 1),
      operator: tally(journeys, j => j.o, 2),
      region: tally(journeys, j => j.r, 3),
      country: tally(journeys, j => j.co, 5),
      vessel: tally(journeys, j => j.v, 3),
    },
  };
}

/** The vocabulary as compact text, for a prompt or a terminal. */
export function vocabularyText(v = answerVocabulary()) {
  const block = (title, pairs) =>
    `${title}: ${pairs.map(([k, n]) => `${k} (${n})`).join('; ')}`;
  const h = v.hotels;
  const j = v.journeys;
  return [
    `HOTEL FEED — ${h.total} properties. perks=true: ${h.perksTrue}. promo=true: ${h.promoTrue}.`,
    block('program', h.program),
    block('brand', h.brand),
    block('category', h.category),
    block('country', h.country),
    block('region', h.region),
    block('experience', h.experience),
    block('vibe', h.vibe),
    block('tag', h.tag),
    '',
    `JOURNEY FEED — ${j.total} itineraries.`,
    block('collection', j.collection),
    block('operator', j.operator),
    block('region', j.region),
    block('country', j.country),
    block('vessel', j.vessel),
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(vocabularyText());
}

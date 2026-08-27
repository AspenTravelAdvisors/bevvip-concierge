#!/usr/bin/env node
/**
 * What is actually wrong with the listings we ship.
 *
 * Every atlas has a verify-* script that proves the adapters agree with the
 * maps — that a shared link comes back with the same rows on both sides. None
 * of them look at whether those rows are any GOOD. A record can be perfectly
 * round-tripped through every filter axis and still reach a traveller with a
 * Venetian palazzo filed under "Lodge / Safari", a paragraph of leaked CSS
 * where its day-one description should be, and last year's perks.
 *
 * So this is a quality audit rather than a parity check, and it is deliberately
 * a REPORT, not a gate: these are counts to work down, and failing the build on
 * a supplier's missing photograph would only teach everyone to pass --force.
 * `--strict` exits non-zero on the checks that are ours rather than a
 * supplier's, for when a number has been driven to zero and should stay there.
 *
 *   node scripts/audit-listings.mjs
 *   node scripts/audit-listings.mjs --strict
 *   node scripts/audit-listings.mjs --section hotels
 */

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/virtuoso/env.mjs';

const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const ONLY = (() => { const i = args.indexOf('--section'); return i >= 0 ? args[i + 1] : null; })();

const read = rel => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
const exists = rel => fs.existsSync(path.join(repoRoot, rel));

const nf = new Intl.NumberFormat('en-US');
const findings = [];

/**
 * One finding.
 *
 * `ours` marks a defect in code we control, as opposed to a field the supplier
 * simply did not fill in. Only those can fail --strict, because the other kind
 * is a fact about the feed and no amount of our discipline drives it to zero.
 */
function finding({ section, label, count, of, ours = false, detail = null, examples = [] }) {
  findings.push({ section, label, count, of, ours, detail, examples });
}

function section(name) { return !ONLY || ONLY === name; }

// ---------- shared text tests ----------

/*
 * A stripped <style> block, not prose.
 *
 * The sync scripts' `text()` helper removes TAGS but not the CONTENTS of the
 * elements whose contents are not prose. Suppliers paste itinerary days out of
 * Word, which carries its stylesheet inline, so `<style>p {margin:0px}</style>`
 * survives tag-stripping as the literal characters "p {margin:0px}" and lands
 * in the field the feed advertises as the operator's own per-stop paragraph.
 */
const LOOKS_LIKE_CSS = /(\{[^}]*(?:margin|padding|font-family|font-size|color|border|vertical-align)\s*:)|(^\s*(?:p|ul|ol|td|div|span|\.[A-Za-z])\s*\{)/;

/** Two records the same journey, differing only in punctuation and spacing. */
const nameKey = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// ---------- hotels ----------

/*
 * Countries with a safari industry, for the one number this audit exists to
 * produce: how much of the "Lodge / Safari" label is actually a safari lodge.
 * Deliberately the classic safari map rather than "the continent" — Morocco and
 * Egypt are in Africa and nobody flies there for game drives.
 */
const SAFARI_COUNTRIES = new Set([
  'South Africa', 'Kenya', 'Botswana', 'Tanzania', 'Zimbabwe', 'Zambia',
  'Rwanda', 'Namibia', 'Uganda', 'Mozambique', 'Malawi', 'Madagascar', 'Zanzibar',
]);

function auditHotels() {
  if (!section('hotels')) return;
  const rel = 'data/atlas/hotel/luxury-hotels.json';
  if (!exists(rel)) return;
  const rows = read(rel);
  const n = rows.length;

  /*
   * The category the site sells safari on is 57% not-safari.
   *
   * deriveCategory() in merge-virtuoso-hotels.mjs has two doors into
   * 'Lodge / Safari': propertyType === 'Lodge, Ranch, Camp', which is the
   * supplier saying this is a camp, and experiences includes 'Ecotourism',
   * which is the supplier saying this property has a sustainability story. The
   * second door is far wider than the first and lets in Venetian palazzi.
   */
  const lodge = rows.filter(h => h.category === 'Lodge / Safari');
  const byType = lodge.filter(h => h.propertyType === 'Lodge, Ranch, Camp');
  const ecoOnly = lodge.filter(h => h.propertyType !== 'Lodge, Ranch, Camp'
    && (h.experiences ?? []).includes('Ecotourism'));
  finding({
    section: 'hotels', ours: true,
    label: '"Lodge / Safari" records that are not a lodge, ranch or camp',
    count: ecoOnly.length, of: lodge.length,
    detail: `${byType.length} carry propertyType "Lodge, Ranch, Camp"; the rest are in on the Ecotourism experience flag alone`,
    examples: ecoOnly.slice(0, 6).map(h => `${h.name} — ${h.city}, ${h.country} (${h.propertyType})`),
  });

  const realSafari = lodge.filter(h => SAFARI_COUNTRIES.has(h.country)
    && h.propertyType === 'Lodge, Ranch, Camp');
  finding({
    section: 'hotels',
    label: 'genuine African safari camps in the atlas',
    count: realSafari.length, of: lodge.length,
    detail: 'propertyType "Lodge, Ranch, Camp" in a safari country — the drawable core of a safari atlas',
  });

  /*
   * Records the Virtuoso matcher never paired.
   *
   * They are not missing one field, they are missing the whole supplier record:
   * no photographs, no experiences, no room detail, no perks text. On the map
   * they are a pin with a name, next to 2,073 that are a property.
   */
  const local = rows.filter(h => h.source === 'local');
  finding({
    section: 'hotels', ours: true,
    label: 'hotels with no matched Virtuoso record (no photos, perks or detail)',
    count: local.length, of: n,
    examples: local.slice(0, 6).map(h => `${h.name} — ${h.country}`),
  });

  // How many of those are recoverable by name alone, before anyone writes a
  // smarter matcher: the answer decides whether this is worth a day's work.
  if (exists('data/atlas/hotel/virtuoso-hotels.json')) {
    const v = read('data/atlas/hotel/virtuoso-hotels.json').hotels ?? [];
    const keys = v.map(h => ({ k: nameKey(h.name), name: h.name }));
    const near = [];
    for (const h of local) {
      const k = nameKey(h.name);
      if (k.length < 10) continue;
      const m = keys.find(x => (x.k.includes(k) || k.includes(x.k)) && Math.min(x.k.length, k.length) >= 10);
      if (m) near.push(`${h.name}  ->  ${m.name}`);
    }
    finding({
      section: 'hotels', ours: true,
      label: 'of those, one substring away from a Virtuoso record',
      count: near.length, of: local.length,
      detail: 'needs city corroboration before merging — a few are false pairs',
      examples: near.slice(0, 6),
    });
  }

  const stale = rows.filter(h => h.perksStale);
  const noYear = rows.filter(h => !h.perksYear);
  finding({
    section: 'hotels',
    label: 'hotels advertising a previous year\'s VIP perks',
    count: stale.length, of: n,
    detail: `plus ${nf.format(noYear.length)} with no perks year at all`,
  });

  finding({
    section: 'hotels',
    label: 'hotels with no photograph',
    count: rows.filter(h => !h.thumb).length, of: n,
  });
}

// ---------- tours (the jet and rail atlases) ----------

function auditTours() {
  if (!section('tours')) return;
  const rel = 'data/atlas/shared/virtuoso-tours.json';
  if (!exists(rel)) return;
  const feed = read(rel);
  const tours = feed.tours ?? [];

  /*
   * The feed's own _meta calls the per-stop paragraphs the point of the
   * exercise. For one stop in ten the paragraph is a stylesheet.
   */
  let stops = 0, cssStops = 0;
  const cssExamples = [];
  for (const t of tours) {
    for (const p of t.itinerary ?? []) {
      if (!p.note) continue;
      stops++;
      if (!LOOKS_LIKE_CSS.test(p.note)) continue;
      cssStops++;
      if (cssExamples.length < 4) cssExamples.push(`${t.name} · day ${p.day} ${p.place}: "${p.note.slice(0, 60)}…"`);
    }
  }
  finding({
    section: 'tours', ours: true,
    label: 'itinerary stops whose description is leaked CSS',
    count: cssStops, of: stops,
    detail: 'text() in the sync scripts strips tags but keeps <style> contents',
    examples: cssExamples,
  });

  const prose = ['description', 'folioDescription', 'folioInTheKnow'];
  let proseFields = 0, cssFields = 0;
  for (const t of tours) for (const f of prose) {
    if (typeof t[f] !== 'string' || !t[f]) continue;
    proseFields++;
    if (LOOKS_LIKE_CSS.test(t[f])) cssFields++;
  }
  finding({
    section: 'tours', ours: true,
    label: 'tour descriptions that are leaked CSS',
    count: cssFields, of: proseFields,
  });

  /*
   * The same journey, listed two and three times.
   *
   * "Southern Africa by Private Air" ships three times at 13, 13 and 14 days;
   * "International Intrigue" three times differing only in whether the supplier
   * typed a pipe, a capital I or a colon. Nothing downstream collapses them, so
   * the jet atlas shows a traveller the same trip three times in a row.
   */
  const byName = new Map();
  for (const t of tours) {
    const k = nameKey(t.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(t);
  }
  const dupes = [...byName.values()].filter(g => g.length > 1);
  const extra = dupes.reduce((n, g) => n + g.length - 1, 0);
  finding({
    section: 'tours', ours: true,
    label: 'duplicate journey listings (same trip, listed more than once)',
    count: extra, of: tours.length,
    detail: `${dupes.length} journeys affected`,
    examples: dupes.slice(0, 5).map(g => `${g[0].name} ×${g.length} (${g.map(t => t.lengthLabel).join(', ')})`),
  });

  finding({
    section: 'tours',
    label: 'journeys with no description at all',
    count: tours.filter(t => !t.description).length, of: tours.length,
  });

  /*
   * How much of /v2/tours we are actually looking at.
   *
   * The catalogue is one cheap 8-second fetch of 13,348 records and the sync
   * keeps the ~1.7% that a rail facet or a private-jet name match selects.
   * Everything a second land atlas could be built from is in the part we throw
   * away without reading.
   */
  const CATALOGUE = 13348;
  finding({
    section: 'tours',
    label: 'tours in /v2/tours we do not read',
    count: CATALOGUE - tours.length, of: CATALOGUE,
    detail: 'the sync fetches the whole catalogue and keeps the jet and rail selection',
  });

  // Africa is already there, in a slice that was never looking for it.
  const africa = tours.filter(t => (t.destinationRegions ?? []).includes('Africa'));
  const safariCountry = tours.filter(t => (t.countries ?? []).some(c => SAFARI_COUNTRIES.has(c)));
  finding({
    section: 'tours',
    label: 'journeys already touching Africa, inside the jet/rail slice',
    count: africa.length, of: tours.length,
    detail: `${safariCountry.length} reach a safari country; the API exposes "Africa" as a first-class destinationRegion facet`,
    examples: safariCountry.slice(0, 5).map(t => `${t.name} — ${t.company}`),
  });
}

// ---------- the counts the site states out loud ----------

/*
 * atlas-config.ts keeps a hand-written `count` per collection, and
 * collectionsHeadline() adds them up into the first sentence a visitor reads.
 * Six of the seven are right. Checking them is three lines and the alternative
 * is a headline that drifts silently every time a supplier retires a property.
 */
const SHIPPED = {
  hotel: ['data/atlas/hotel/luxury-hotels.json', d => (Array.isArray(d) ? d.length : null)],
  villa: ['data/villas-of-distinction.json', d => (d.villas ?? Object.values(d).find(Array.isArray) ?? []).length],
  cruise: ['data/atlas/cruise/sailings.json', d => (d.rows ?? []).length],
  worldcruise: ['data/atlas/world/itinerary.json', d => (d.TRIPS ?? []).length],
  train: ['data/atlas/train/itinerary.json', d => (d.TRIPS ?? []).length],
  yacht: ['data/atlas/yacht/itinerary.json', d => (d.TRIPS ?? []).length],
  jet: ['data/atlas/jet/itinerary.json', d => (d.TRIPS ?? []).length],
};

function auditCounts() {
  if (!section('counts')) return;
  const src = fs.readFileSync(path.join(repoRoot, 'lib/atlas-config.ts'), 'utf8');
  const drift = [];
  let stated = 0, actual = 0;
  for (const [type, [rel, pick]] of Object.entries(SHIPPED)) {
    if (!exists(rel)) continue;
    // The `count:` that follows this collection's `type:` line in the registry.
    const block = src.slice(src.indexOf(`type: "${type}"`));
    const declared = Number(block.match(/count:\s*([\d_]+)/)?.[1]?.replace(/_/g, ''));
    const real = pick(read(rel));
    if (!Number.isFinite(declared) || real == null) continue;
    stated += declared; actual += real;
    if (declared !== real) drift.push(`${type}: config says ${nf.format(declared)}, ships ${nf.format(real)} (${declared > real ? '+' : ''}${nf.format(declared - real)})`);
  }
  finding({
    section: 'counts', ours: true,
    label: 'collections whose stated count does not match what ships',
    count: drift.length, of: Object.keys(SHIPPED).length,
    detail: `the home page headline claims ${nf.format(stated)} vetted stays and journeys; the data holds ${nf.format(actual)}`,
    examples: drift,
  });
}

// ---------- report ----------

auditHotels();
auditTours();
auditCounts();

let current = null;
for (const f of findings) {
  if (f.section !== current) { current = f.section; console.log(`\n${current.toUpperCase()}\n${'─'.repeat(current.length)}`); }
  const share = f.of ? ` of ${nf.format(f.of)} (${((f.count / f.of) * 100).toFixed(1)}%)` : '';
  console.log(`\n  ${f.ours ? '▸' : '·'} ${f.label}`);
  console.log(`    ${nf.format(f.count)}${share}`);
  if (f.detail) console.log(`    ${f.detail}`);
  for (const e of f.examples) console.log(`      ${e}`);
}

const ours = findings.filter(f => f.ours && f.count > 0);
console.log(`\n\n${findings.length} findings · ${ours.length} in code we control (▸)\n`);

if (STRICT && ours.length) {
  console.log('FAILED (--strict): the ▸ findings above are defects, not supplier gaps.\n');
  process.exit(1);
}

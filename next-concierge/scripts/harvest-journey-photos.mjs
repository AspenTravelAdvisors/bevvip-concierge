#!/usr/bin/env node
// Finds a hero photograph for the journeys the Virtuoso API cannot supply one for.
//
// Every card on the six atlases shows the supplier's own picture, taken from
// `defaultImageUrl` on the API record. The 27 bespoke jet journeys have no API
// record — 18 Safrans du Monde and 9 National Geographic, built by us — so they
// arrived with no picture, and a blank card sitting beside photographed ones
// does not read as "no photo available", it reads as broken.
//
// So we go and get one from the operator, the way a person would: open the page
// that sells the journey and take the picture at the top of it. `og:image` is
// exactly that picture — it is what the supplier chose to represent the trip
// when it is shared — which makes it the right one to put on a card and saves
// guessing which of forty <img> tags on the page is the hero.
//
// WHAT THIS SCRIPT IS NOT. It does not go looking for pages. Which page belongs
// to which journey is research, it changes rarely, and getting it wrong puts a
// photograph of the wrong continent on a $150,000 journey — so it lives in
// data/atlas/shared/journey-photo-sources.json where a person wrote it down and
// can check it. This script only reads those pages and records what it found.
//
// Output is data/atlas/shared/journey-photos.json, which merge-virtuoso-journeys
// applies as a fallback wherever the API gave no image. Generated separately
// from the merge because it talks to the open internet: a supplier being down,
// slow, or mid-redesign must never be able to fail a build or empty an atlas.
//
//   node scripts/harvest-journey-photos.mjs
//   node scripts/harvest-journey-photos.mjs --check     (no network; report gaps)
//   node scripts/harvest-journey-photos.mjs --force     (re-fetch pages already answered)

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/virtuoso/env.mjs';
import { journeyPhotoKey } from '../lib/virtuoso/media.mjs';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const FORCE = args.includes('--force');

const SOURCES_REL = 'data/atlas/shared/journey-photo-sources.json';
const OUT_REL = 'data/atlas/shared/journey-photos.json';

const full = rel => path.join(repoRoot, rel);
const read = rel => JSON.parse(fs.readFileSync(full(rel), 'utf8'));
const exists = rel => fs.existsSync(full(rel));

const ATLASES = [
  { atlas: 'jet', rel: 'data/atlas/jet/itinerary.json' },
  { atlas: 'rail', rel: 'data/atlas/train/itinerary.json' },
];

/*
 * A real browser's User-Agent.
 *
 * Not a trick — nationalgeographic.com serves a 403 to the default Node agent
 * and 200 to a browser, and we are asking for the same public marketing page a
 * browser would get. Anything that needs a login or a cookie is out of scope
 * for this script by construction.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TIMEOUT_MS = 25_000;

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The picture a page nominates for itself.
 *
 * In preference order: Open Graph, then Twitter's equivalent, then the old
 * `link rel="image_src"`. Deliberately no "first big <img>" fallback — on the
 * two suppliers here that would have returned a logo and a Facebook icon, and a
 * card showing a supplier's logo where its journey should be is worse than a
 * card showing nothing.
 */
function heroFromHtml(html, pageUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (!m?.[1]) continue;
    try {
      // Suppliers publish these protocol-relative and root-relative alike.
      return new URL(m[1].trim(), pageUrl).href;
    } catch { /* unparseable; try the next pattern */ }
  }
  return null;
}

/*
 * The Safrans journeys, out of our own promo page.
 *
 * public/safrans-du-monde.html carries the twelve journeys as a JS array, each
 * with the `sdm-…` slug these trips already link to in `t.u` and the picture the
 * promo page shows for it. Reading it here rather than scraping
 * safransdumonde.com is the deliberate choice: the supplier's Webflow pages
 * publish no og:image at all, and a guest who follows the card's link lands on
 * our promo page — so this is the picture they are about to see anyway. One
 * source, no drift.
 */
function safransEntries(pageRel) {
  if (!exists(pageRel)) return [];
  const html = fs.readFileSync(full(pageRel), 'utf8');
  const IMG = /const IMG\s*=\s*'([^']+)'/.exec(html)?.[1] ?? '';
  const out = [];
  const re = /title:"([^"]*)",\s*year:"([^"]*)",\s*\n?\s*slug:"([^"]+)",[^\n]*?img:IMG\+"([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    out.push({ title: m[1], year: m[2], slug: m[3], img: IMG + m[4] });
  }
  return out;
}

const words = s => new Set(String(s ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []);

/** Overlap of two title word-bags, so "…2027" picks the 2027 edition. */
function titleScore(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let hits = 0;
  for (const w of x) if (y.has(w)) hits++;
  return hits / Math.max(x.size, y.size);
}

// ---------- gather what needs a photograph ----------

const sources = exists(SOURCES_REL) ? (read(SOURCES_REL).sources ?? []) : [];
if (!sources.length) {
  console.error(`No photo sources found. Expected ${SOURCES_REL}.`);
  process.exit(1);
}

/** Journeys with no picture, per atlas. */
const missing = [];
for (const { atlas, rel } of ATLASES) {
  if (!exists(rel)) continue;
  for (const trip of read(rel).TRIPS ?? []) {
    if (trip.img) continue;
    missing.push({ atlas, trip });
  }
}

/** The ledger entry that speaks for a journey: by route first, then by brand. */
function sourceFor({ atlas, trip }) {
  return sources.find(s => s.atlas === atlas && s.route && s.route === trip.route)
    ?? sources.find(s => s.atlas === atlas && s.id && String(s.id) === String(trip.id))
    ?? sources.find(s => s.atlas === atlas && s.brand && s.brand === trip.b)
    ?? null;
}

const previous = exists(OUT_REL) ? (read(OUT_REL).photos ?? {}) : {};

/*
 * Route and title together — see journeyPhotoKey for why neither alone works.
 * The merge derives the same key from the same record, so nothing has to agree
 * about it in two places.
 */
const keyOf = ({ trip }) => journeyPhotoKey(trip);

const photos = { ...previous };
const stats = { kept: 0, fetched: 0, failed: 0, unsourced: 0, local: 0 };
const notes = [];

const safransCache = new Map();

async function resolve(entry) {
  const key = keyOf(entry);
  const src = sourceFor(entry);

  if (!src) { stats.unsourced++; notes.push(`  no source   ${entry.atlas}  ${entry.trip.n}`); return; }

  if (src.collector === 'safrans') {
    if (!safransCache.has(src.page)) safransCache.set(src.page, safransEntries(src.page));
    const rows = safransCache.get(src.page);
    // The `#sdm-…` anchor the trip already links to is the join key.
    const anchor = /#(sdm-[a-z0-9-]+)/i.exec(entry.trip.u ?? '')?.[1] ?? null;
    const candidates = anchor ? rows.filter(r => r.slug === anchor) : rows;
    if (!candidates.length) {
      stats.failed++; notes.push(`  no match    ${entry.atlas}  ${entry.trip.n} (anchor ${anchor ?? '—'})`);
      return;
    }
    // One slug can carry two editions (Japan spring and autumn, 7 Wonders 2027
    // and 2028), so the title breaks the tie rather than array order.
    const best = candidates
      .map(r => ({ r, score: titleScore(entry.trip.n, `${r.title} ${r.year}`) }))
      .sort((a, b) => b.score - a.score)[0];
    photos[key] = { url: best.r.img, source: src.page, title: best.r.title };
    stats.local++;
    return;
  }

  if (!src.page) { stats.unsourced++; notes.push(`  no page     ${entry.atlas}  ${entry.trip.n}${src.note ? ` — ${src.note}` : ''}`); return; }

  if (photos[key]?.url && !FORCE) { stats.kept++; return; }
  if (CHECK) { stats.unsourced++; notes.push(`  unfetched   ${entry.atlas}  ${entry.trip.n}`); return; }

  try {
    const html = await fetchPage(src.page);
    const url = heroFromHtml(html, src.page);
    if (!url) throw new Error('no og:image on the page');
    photos[key] = { url, source: src.page, fetchedAt: new Date().toISOString().slice(0, 10) };
    stats.fetched++;
    console.log(`  ok  ${entry.trip.n.slice(0, 46).padEnd(48)} ${url.slice(0, 80)}`);
  } catch (err) {
    stats.failed++;
    notes.push(`  failed      ${entry.atlas}  ${entry.trip.n} — ${err.message}`);
  }
}

// Sequential on purpose: two suppliers, a couple of dozen journeys, and no
// reason to arrive at either of them as a burst of parallel requests.
const seen = new Set();
for (const entry of missing) {
  const key = keyOf(entry);
  if (seen.has(key)) continue;
  seen.add(key);
  await resolve(entry);
}

console.log(`\n${missing.length} journeys with no supplier photograph`);
console.log(`  ${stats.fetched} fetched · ${stats.local} from the Safrans page · ${stats.kept} already known · ` +
  `${stats.failed} failed · ${stats.unsourced} with no source`);
if (notes.length) console.log(`\n${notes.join('\n')}`);

if (CHECK) process.exit(0);

const out = {
  _meta: {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/harvest-journey-photos.mjs',
    ledger: SOURCES_REL,
    note: 'Hero photographs for journeys the Virtuoso API supplies none for. Applied by merge-virtuoso-journeys.mjs.',
  },
  photos,
};
fs.writeFileSync(full(OUT_REL), JSON.stringify(out, null, 1));
console.log(`\nwrote ${OUT_REL} — ${Object.keys(photos).length} photographs`);

#!/usr/bin/env node
// Pulls the tours behind the private-jet and rail atlases.
//
// `/v2/tours` is not in the documentation's endpoint list but is live and holds
// 13,348 records — and it, not `/v2/packages`, is where our journey atlases come
// from. Packages looked like the obvious home and are the wrong door: they carry
// one location and a prose blurb, no day-by-day itinerary, and exactly one of
// the 835 mentions a private jet against our atlas's 147.
//
// Selection is client-side because the whole catalogue is one cheap 8-second
// fetch and neither atlas maps to a single facet:
//
//   rail  travelStyles contains "Rail" — the API's own classification, 131 tours,
//         against our 135, with the same operators down the list.
//   jet   no facet exists, so it is a name match. Kept deliberately literal;
//         a tour is in the jet atlas because it says it flies you privately.
//
//   node scripts/sync-virtuoso-tours.mjs
//   node scripts/sync-virtuoso-tours.mjs --normalize-only

import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, repoRoot } from '../lib/virtuoso/env.mjs';
import { writeFeed } from '../lib/virtuoso/write-feed.mjs';
import { createClient } from '../lib/virtuoso/client.mjs';

loadEnv();

const args = process.argv.slice(2);
const has = f => args.includes(f);
const value = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const FORCE = has('--force');
const NORMALIZE_ONLY = has('--normalize-only');
const LIMIT = Number(value('--limit') || 0);

const CACHE_DIR = path.join(repoRoot, 'scripts/cache/virtuoso');
const CACHE_FILE = path.join(CACHE_DIR, 'tours-detail.ndjson');
const CATALOG_FILE = path.join(CACHE_DIR, 'tours-catalog.json');
const OUT_FILE = path.join(repoRoot, 'data/atlas/shared/virtuoso-tours.json');

/*
 * What counts as a private-jet journey.
 *
 * "Jet Expeditions" (plural) is why this is spelled out rather than a tidy
 * `\bjet expedition\b`: the word boundary after the singular silently dropped
 * every Aman journey. Anchored on the phrases operators actually use.
 */
const JET_NAME = /\b(private jet|by air\b|by private air|jet expedition|jet experience|air cruise|jet by day)\b/i;

// ---------- helpers ----------

const text = html => String(html ?? '')
  .replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|li|div|h\d)>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'")
  .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s);
const day = d => (d ? String(d).slice(0, 10) : null);
const num = v => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : null; };

function place(raw) {
  if (!raw) return null;
  try { const l = JSON.parse(raw); return [l.City, l.StateAbbr || l.State, l.Country].filter(Boolean).join(', ') || null; }
  catch { return String(raw) || null; }
}

function normalize(row, detail, kinds) {
  const d = detail ?? {};

  /*
   * The day-by-day stops, with the operator's coordinates.
   *
   * Both journey atlases draw a route through waypoints, and until now those
   * coordinates were geocoded from scraped place names. These come from the
   * operator, and each stop carries its own paragraph of description too.
   */
  const itinerary = (d.itineraryPoints ?? [])
    .slice()
    .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    .map(p => ({
      day: p.dayOfTour ?? null,
      date: day(p.segmentDate),
      place: String(p.poiName ?? p.portName ?? '').trim() || null,
      placeFull: String(p.portName ?? '').trim() || null,
      lat: num(p.portLatitude),
      lng: num(p.portLongitude),
      note: clip(text(p.stopDescription), 240) || null,
    }))
    .filter(p => p.place);

  return {
    id: String(row.id),
    kinds,                                    // ['jet'] | ['rail'] | both
    name: String(d.tourName ?? row.name ?? '').trim(),
    company: (row.company ?? d.companyName ?? '').trim() || null,
    tourType: d.tourType ?? row.type ?? null,
    tourSubTypes: d.tourSubTypes ?? null,
    travelStyles: row.travelStyles ?? [],

    startDate: day(row.startDate),
    endDate: day(row.endDate),
    lengthLabel: d.tourLength ?? row.travelLength ?? null,
    travelDates: d.travelDates ?? null,
    departureMonths: row.departureMonths ?? [],

    startLocation: place(row.startLocation),
    embarkation: d.embarkation ?? null,
    disembarkation: d.disembarkation ?? null,
    countries: row.countries ?? [],
    destinationRegions: row.destinationRegions ?? [],
    // Ordered place names from the search row — a fallback when a tour has no
    // detail itinerary, which is the difference between a drawable route and none.
    ports: row.ports ?? [],

    itinerary,
    stopCount: itinerary.filter(p => p.lat != null).length,

    description: clip(text(d.tourDescription), 700),
    folioDescription: clip(text(d.asSeenInTravelFolioDescription), 500),
    folioInTheKnow: clip(text(d.asSeenInTravelFolioInTheKnow), 300),
    included: (d.whatIsIncludedItems ?? []).map(text).filter(Boolean).slice(0, 8),
    exclusive: Boolean(d.isVirtuosoExclusiveExperience),
    hasVirtuosoBenefits: row.hasVirtuosoBenefits ?? null,
    /*
     * `row.virtuosoBenefits` is deliberately NOT carried.
     *
     * Despite the name it holds up to 756 internal faceting tokens per record
     * ("Promotions 1011 AF", "Virtuoso Voyages 1011 AZ") — search-index
     * plumbing, not anything a traveller is offered, and only 38 distinct values
     * across thousands of sailings. Passing it through made it 35MB of a 39MB
     * feed. The booleans beside it carry the actual signal.
     */

    image: row.defaultImageUrl || null,
    images: (d.imageLibraryItems ?? []).slice(0, 4).map(i => i.url).filter(Boolean),
    supplierLogo: d.supplierLogo || null,
  };
}

function readCache() {
  if (!fs.existsSync(CACHE_FILE) || FORCE) return new Map();
  const entries = new Map();
  for (const line of fs.readFileSync(CACHE_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const rec = JSON.parse(line); if (rec?.id) entries.set(String(rec.id), rec); } catch { /* torn */ }
  }
  return entries;
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = readCache();
  console.log(`cache: ${cache.size} tour details on disk`);

  let rows;
  if (NORMALIZE_ONLY) {
    if (!fs.existsSync(CATALOG_FILE)) throw new Error('--normalize-only needs a cached catalog; run a full sync first.');
    rows = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    console.log(`catalog: ${rows.length} tours (from cache)`);
  } else {
    const v = createClient({ log: msg => console.log(msg) });
    const res = await v.searchAll('/v2/tours');
    rows = res.rows;
    console.log(`catalog: ${rows.length}/${res.totalRows} tours`);
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(rows));
  }

  /** id -> kinds */
  const selected = new Map();
  for (const row of rows) {
    const kinds = [];
    if ((row.travelStyles ?? []).includes('Rail')) kinds.push('rail');
    if (JET_NAME.test(row.name ?? '')) kinds.push('jet');
    if (kinds.length) selected.set(String(row.id), { row, kinds });
  }
  const counts = { jet: 0, rail: 0 };
  for (const s of selected.values()) for (const k of s.kinds) counts[k]++;
  console.log(`selected ${selected.size} tours — jet ${counts.jet}, rail ${counts.rail}`);

  const ids = [...selected.keys()].slice(0, LIMIT || undefined);

  if (!NORMALIZE_ONLY) {
    const v = createClient({ log: msg => console.log(msg) });
    const todo = ids.filter(id => FORCE || !cache.has(id));
    console.log(`detail: ${todo.length} to fetch, ${ids.length - todo.length} cached`);
    if (todo.length) {
      const stream = fs.createWriteStream(CACHE_FILE, { flags: FORCE ? 'w' : 'a' });
      const started = Date.now();
      let done = 0, failed = 0;
      for (const id of todo) {
        try {
          const res = await v.call('/v2/tour', { id });
          const rec = { id, detail: res.result?.data ?? null };
          cache.set(id, rec);
          stream.write(JSON.stringify(rec) + '\n');
        } catch (err) { failed++; console.warn(`  ! ${id}: ${err.message}`); }
        if (++done % 50 === 0 || done === todo.length) {
          const rate = done / ((Date.now() - started) / 1000);
          console.log(`  ${done}/${todo.length} (${rate.toFixed(1)}/s, ${failed} failed)`);
        }
      }
      await new Promise(r => stream.end(r));
    }
  }

  const feed = ids
    .map(id => { const s = selected.get(id); return normalize(s.row, cache.get(id)?.detail, s.kinds); })
    .filter(t => t.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  const byKind = {};
  for (const t of feed) for (const k of t.kinds) byKind[k] = (byKind[k] ?? 0) + 1;

  const out = {
    _meta: {
      source: 'Virtuoso Partner API /v2/tours + /v2/tour',
      count: feed.length,
      byKind,
      note: 'Day-by-day stops carry the operator\'s own coordinates and per-stop prose.',
    },
    tours: feed,
  };
  const moved = writeFeed(path.relative(repoRoot, OUT_FILE), out, { label: 'tours' });
  console.log(`\nwrote ${path.relative(repoRoot, OUT_FILE)} — ${feed.length} tours`);
  console.log(`  by kind: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  console.log(`  with day-by-day stops: ${feed.filter(t => t.itinerary.length).length} · with coordinates: ${feed.filter(t => t.stopCount).length}`);
}

main().catch(err => { console.error(`\nsync failed: ${err.message}`); process.exit(1); });

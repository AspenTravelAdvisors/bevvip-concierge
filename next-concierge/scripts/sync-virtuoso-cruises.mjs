#!/usr/bin/env node
// Pulls the sailings behind the three sea atlases — expedition, yacht and world
// cruise — from the Virtuoso API.
//
// The catalogue holds ~59,000 sailings, which is thirteen hours of detail calls
// and mostly river boats and mass-market ocean liners we do not carry. So the
// selection happens SERVER-side: each atlas is a set of cruise lines crossed
// with a cruise type or a length band, which the API filters natively
// (`cruiselines`, `cruisetypes`, `lengths` — all AND together). That takes the
// crawl from 59,000 to roughly 4,500.
//
// The brand sets are deliberate editorial choices, not an accident of what was
// harvestable — the expedition atlas is expedition operators, the yacht atlas is
// the four true yacht brands. Widening them is a business decision; see
// CANDIDATES below for the lines that would qualify if we wanted them.
//
//   node scripts/sync-virtuoso-cruises.mjs
//   node scripts/sync-virtuoso-cruises.mjs --atlas yacht      # one atlas
//   node scripts/sync-virtuoso-cruises.mjs --normalize-only
//   node scripts/sync-virtuoso-cruises.mjs --limit 30

import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, repoRoot } from '../lib/virtuoso/env.mjs';
import { writeFeed } from '../lib/virtuoso/write-feed.mjs';
import { createClient } from '../lib/virtuoso/client.mjs';
import { readNdjsonCache } from '../lib/virtuoso/ndjson-cache.mjs';
import { text, prose, clip } from '../lib/virtuoso/text.mjs';

loadEnv();

const args = process.argv.slice(2);
const has = f => args.includes(f);
const value = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const FORCE = has('--force');
const NORMALIZE_ONLY = has('--normalize-only');
const LIMIT = Number(value('--limit') || 0);
const ONLY_ATLAS = value('--atlas');

const CACHE_DIR = path.join(repoRoot, 'scripts/cache/virtuoso');
const CACHE_FILE = path.join(CACHE_DIR, 'cruises-detail.ndjson');
const CATALOG_FILE = path.join(CACHE_DIR, 'cruises-catalog.json');
const OUT_FILE = path.join(repoRoot, 'data/atlas/shared/virtuoso-cruises.json');

/*
 * A world cruise is not a length band, it is a grand voyage. The API's coarsest
 * bucket is "22+ days", which sweeps in every three-week Mediterranean loop, so
 * the band is only the cheap server-side pre-filter and MIN_WORLD_DAYS is the
 * real rule. The existing atlas runs 50 to 245 days; 45 keeps that field intact
 * with a little room beneath it.
 */
const MIN_WORLD_DAYS = 45;

const SELECTIONS = [
  {
    atlas: 'expedition',
    lines: ['National Geographic-Lindblad Expeditions', 'PONANT EXPLORATIONS', 'Aqua Expeditions',
      'HX Expeditions', 'Seabourn', 'Silversea', 'Atlas Ocean Voyages', 'Swan Hellenic',
      'Quark Expeditions', 'Aurora Expeditions'],
    params: { cruisetypes: 'Expedition' },
  },
  {
    atlas: 'yacht',
    lines: ['Four Seasons Yachts', 'Aman at Sea', 'Orient Express Sailing Yachts',
      'The Ritz-Carlton Yacht Collection'],
    params: { cruisetypes: 'Yacht' },
  },
  {
    atlas: 'world',
    lines: ['Oceania Cruises', 'Azamara Cruises', 'Regent Seven Seas Cruises', 'Viking', 'Crystal',
      'Silversea', 'Seabourn', 'Holland America Line', 'Princess Cruises', 'Explora Journeys',
      'Cunard', 'Windstar Cruises', 'National Geographic-Lindblad Expeditions'],
    params: { lengths: '22+ days' },
    minDays: MIN_WORLD_DAYS,
  },
];

// Lines that would qualify on type but are not in our brand sets today. Left
// here so widening an atlas is a one-line edit rather than a rediscovery.
// yacht:      SeaDream Yacht Club, Star Clippers, Sea Cloud Cruises
// expedition: Hapag-Lloyd Cruises, Coral Expeditions, Heritage Expeditions AUNZ,
//             UnCruise Adventures, Australis Cruises, Intrepid Travel - Cruises

// ---------- helpers ----------

const day = d => (d ? String(d).slice(0, 10) : null);

/** startLocation / endLocation arrive as a stringified JSON blob. */
function place(raw) {
  if (!raw) return null;
  try {
    const l = JSON.parse(raw);
    return [l.City, l.StateAbbr || l.State, l.Country].filter(Boolean).join(', ') || null;
  } catch { return String(raw) || null; }
}

const nights = (a, b) => {
  if (!a || !b) return null;
  const d = Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  return Number.isFinite(d) && d >= 0 ? d : null;
};

const num = v => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : null; };

/*
 * Exactly 0,0 is not a place.
 *
 * The API returns portLatitude/portLongitude as "0" for entries that have no
 * position — "Day-at-Sea", "International Dateline (Crossing)", "Scenic
 * Cruising", "Air travel" — and for a few real ports it simply lacks. Taken at
 * face value that put 9,341 of 63,529 expedition stops in the Gulf of Guinea and
 * drew routes across Africa to reach them. Null Island is never a port of call.
 */
const coord = (lat, lng) => {
  const a = num(lat), b = num(lng);
  if (a == null || b == null) return [null, null];
  if (a === 0 && b === 0) return [null, null];
  return [a, b];
};

function normalize(row, detail, atlases) {
  const d = detail ?? {};
  const start = day(row.startDate), end = day(row.endDate);
  const days = nights(start, end);

  /*
   * The day-by-day itinerary, WITH the supplier's own coordinates.
   *
   * This is the single most valuable field in the whole migration. Our routes
   * are drawn from port coordinates, and until now those came from geocoding
   * port names and patching the misses by hand (data/atlas/shared/port-overrides
   * .json). Here the operator states where its own ship calls.
   */
  const itinerary = (d.itineraryPoints ?? [])
    .slice()
    .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    /*
     * Four fields per stop, not eight.
     *
     * There are 87,217 stops across the selection, so every field costs about a
     * megabyte of committed feed. Day, name and position are what the atlas
     * draws and what the guide searches; the port-call clock times and the
     * at-sea flag were carried because the API offered them, and nothing reads
     * them. The date is `startDate + day` when anyone needs it.
     */
    .map(p => {
      const [lat, lng] = coord(p.portLatitude, p.portLongitude);
      return { d: p.dayOfCruise ?? null, n: String(p.portName ?? p.poIname ?? '').trim() || null, lat, lng };
    })
    .filter(p => p.n);

  const sailing = (d.sailings ?? [])[0] ?? null;

  return {
    id: String(row.id),
    atlases,
    name: String(d.cruiseName ?? row.name ?? '').trim(),
    line: (row.company ?? d.companyName ?? '').trim() || null,
    ship: d.shipName ?? (row.ships ?? [])[0] ?? null,

    startDate: start,
    endDate: end,
    days,
    lengthLabel: d.cruiseLength ?? row.travelLength ?? null,

    startPort: place(row.startLocation),
    endPort: place(row.endLocation),
    countries: row.countries ?? [],
    destinationRegions: row.destinationRegions ?? [],

    itinerary,
    portCount: itinerary.filter(p => p.lat != null).length,

    description: clip(prose(d.cruiseDescription), 700),
    // What the fare covers — the dossier's second most useful block after the
    // itinerary. Capped at six: the lists run long and repeat the brand's
    // standard inclusions on every sailing.
    included: (d.whatIsIncludedItems ?? []).map(text).filter(Boolean).slice(0, 6),
    // Offers ride along on the cruise record rather than needing the promotions join.
    promotions: (d.promotions ?? []).map(p => ({
      name: String(p.promotionName ?? '').trim(),
      exclusive: Boolean(p.isVirtuosoExclusiveExperience),
      dates: p.formattedTravelDates ?? null,
    })).filter(p => p.name).slice(0, 3),

    hasVirtuosoVoyages: row.hasVirtuosoVoyages ?? null,
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

    image: row.defaultImageUrl || d.cruiseImagePath || null,
    // A relative path on virtuoso.com; the advisor prefix is added at merge time.
    path: sailing?.url ?? null,
  };
}

/*
 * Keep only the fields the normalizer reads before caching a detail record.
 *
 * The raw responses cached out at 1.35GB, of which `addOns` alone was 1,022MB —
 * shore excursions and pre/post packages nothing here touches — with another
 * 141MB of `visibleRegions` region trees. Slimming on the way in keeps the cache
 * around a sixth of the size, which matters twice: reading it back, and the
 * nightly Action carrying it between runs.
 */
const CACHED_DETAIL_FIELDS = [
  'cruiseName', 'shipName', 'cruiseLength', 'cruiseDescription', 'itineraryPoints',
  'sailings', 'promotions', 'cruiseImagePath', 'companyName', 'productId',
  // Added after the first crawl, so it stays empty until a record is refetched —
  // the nightly sync fills it in as departures roll over.
  'whatIsIncludedItems',
];
const slimDetail = d => {
  if (!d) return null;
  const out = {};
  for (const k of CACHED_DETAIL_FIELDS) if (d[k] !== undefined) out[k] = d[k];
  return out;
};

// ---------- main ----------

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = readNdjsonCache(CACHE_FILE, { force: FORCE });
  console.log(`cache: ${cache.size} sailing details on disk`);

  /** id -> { row, atlases:Set } */
  let selected = new Map();

  if (NORMALIZE_ONLY) {
    if (!fs.existsSync(CATALOG_FILE)) throw new Error('--normalize-only needs a cached catalog; run a full sync first.');
    for (const rec of JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'))) {
      selected.set(String(rec.row.id), { row: rec.row, atlases: new Set(rec.atlases) });
    }
    console.log(`catalog: ${selected.size} sailings (from cache)`);
  } else {
    const v = createClient({ log: msg => console.log(msg) });
    for (const spec of SELECTIONS) {
      if (ONLY_ATLAS && spec.atlas !== ONLY_ATLAS) continue;
      let kept = 0, seen = 0;
      for (const line of spec.lines) {
        // One request per line: the API takes a single value for `cruiselines`,
        // and comma or pipe lists come back empty rather than erroring.
        const { rows } = await v.searchAll('/v2/cruises', { cruiselines: line, ...spec.params });
        seen += rows.length;
        for (const row of rows) {
          if (spec.minDays) {
            const d = nights(day(row.startDate), day(row.endDate));
            if (d == null || d < spec.minDays) continue;
          }
          const id = String(row.id);
          const hit = selected.get(id);
          if (hit) hit.atlases.add(spec.atlas);
          else selected.set(id, { row, atlases: new Set([spec.atlas]) });
          kept++;
        }
      }
      console.log(`  ${spec.atlas}: ${kept} kept of ${seen} returned`);
    }
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(
      [...selected.values()].map(s => ({ row: s.row, atlases: [...s.atlases] }))));
  }

  const ids = [...selected.keys()].slice(0, LIMIT || undefined);
  console.log(`selected ${ids.length} sailings across the three sea atlases`);

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
          const res = await v.call('/v2/cruise', { id });
          const rec = { id, detail: slimDetail(res.result?.data) };
          cache.set(id, rec);
          stream.write(JSON.stringify(rec) + '\n');
        } catch (err) {
          failed++;
          console.warn(`  ! ${id}: ${err.message}`);
        }
        if (++done % 200 === 0 || done === todo.length) {
          const rate = done / ((Date.now() - started) / 1000);
          const left = Math.round((todo.length - done) / rate);
          console.log(`  ${done}/${todo.length} (${rate.toFixed(1)}/s, ~${Math.floor(left / 60)}m ${left % 60}s left, ${failed} failed)`);
        }
      }
      await new Promise(r => stream.end(r));
    }
  }

  const feed = ids
    .map(id => {
      const sel = selected.get(id);
      return normalize(sel.row, cache.get(id)?.detail, [...sel.atlases].sort());
    })
    .filter(c => c.name)
    .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '') || a.name.localeCompare(b.name));

  const byAtlas = {};
  for (const c of feed) for (const a of c.atlases) byAtlas[a] = (byAtlas[a] ?? 0) + 1;

  const out = {
    _meta: {
      source: 'Virtuoso Partner API /v2/cruises + /v2/cruise',
      count: feed.length,
      byAtlas,
      selection: SELECTIONS.map(s => ({ atlas: s.atlas, lines: s.lines.length, ...s.params, minDays: s.minDays ?? null })),
      note: 'Day-by-day itineraries carry the supplier\'s own port coordinates.',
    },
    cruises: feed,
  };
  writeFeed(path.relative(repoRoot, OUT_FILE), out, { label: 'cruises', arrayKey: 'cruises' });

  const withItin = feed.filter(c => c.itinerary.length).length;
  const withCoords = feed.filter(c => c.portCount).length;
  console.log(`\nwrote ${path.relative(repoRoot, OUT_FILE)} — ${feed.length} sailings`);
  console.log(`  by atlas: ${Object.entries(byAtlas).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  console.log(`  with day-by-day itinerary: ${withItin} · with port coordinates: ${withCoords}`);
}

main().catch(err => { console.error(`\nsync failed: ${err.message}`); process.exit(1); });

#!/usr/bin/env node
// Pulls the Virtuoso hotel catalog and every property's detail record, then
// writes a normalized feed the atlas can merge against.
//
// The detail crawl is ~2,000 sequential calls at ~800ms each (single-use bearer
// tokens forbid parallelism), so it takes roughly half an hour. Raw responses
// are cached to disk as NDJSON and the crawl resumes from that cache, which
// makes re-runs cheap and lets an interrupted run pick up where it stopped.
//
//   node scripts/sync-virtuoso-hotels.mjs            # resume, write feed
//   node scripts/sync-virtuoso-hotels.mjs --force    # ignore cache, refetch all
//   node scripts/sync-virtuoso-hotels.mjs --limit 50 # short run for development
//   node scripts/sync-virtuoso-hotels.mjs --normalize-only   # rebuild feed from cache

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
const CACHE_FILE = path.join(CACHE_DIR, 'hotels-detail.ndjson');
const OUT_FILE = path.join(repoRoot, 'data/atlas/hotel/virtuoso-hotels.json');

// ---------- helpers ----------

const text = html => String(html ?? '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<\/(p|li|div|h\d)>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'")
  .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

/**
 * The year the supplier's benefit block is written for.
 *
 * `virtuosoAmenitiesHtml` opens with "For 2026:" and the list items follow. The
 * heading is not a perk and must not be shown as one, but the year is the most
 * important thing on the block: 157 properties are still stamped 2024 or 2025,
 * and an advisor quoting a two-year-old benefit is the failure this catches.
 */
const perkYear = html => {
  const m = /For\s+([\d\s&]+?)\s*:/i.exec(String(html ?? ''));
  if (!m) return null;
  const years = m[1].match(/\d{4}/g);
  return years?.length ? Number(years[years.length - 1]) : null;   // "2025 & 2026" → 2026
};

/** The perk list is the one thing guests actually compare, so keep its items intact. */
const listItems = html => {
  const items = String(html ?? '').match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
  return items.map(text).filter(Boolean);
};

const selected = (arr, key = 'label') =>
  (Array.isArray(arr) ? arr : []).filter(x => x?.isSelected).map(x => x?.[key]).filter(Boolean);

const num = v => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : null; };

// Suppliers publish far more than a card or a dossier can use — one property
// ships 836 images and another 44 room types. Uncapped, the feed lands at 35MB,
// too heavy to commit or bundle. The full payload stays in the local cache; what
// gets committed is what the site actually renders.
const MAX_IMAGES = 8;
const MAX_ROOM_TYPES = 6;
const MAX_SUMMARY = 700;
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s);

/** Search rows carry `location` as a JSON string, not an object. */
function parseLocation(raw) {
  if (!raw) return {};
  try { const l = JSON.parse(raw); return { city: l.City ?? null, state: l.State ?? null, stateAbbr: l.StateAbbr ?? null, country: l.Country ?? null }; }
  catch { return {}; }
}

function normalize(summary, detail) {
  const d = detail ?? {};
  const loc = parseLocation(summary?.location);
  const reviews = (() => {
    try { const r = JSON.parse(d.reviewsInfoJson || '{}');
      return r.TotalReviews ? { total: r.TotalReviews, recommendedPercent: Number(r.TotalRecommendedPercent) || null } : null; }
    catch { return null; }
  })();

  return {
    vid: String(d.productId ?? summary.id),
    companyId: d.companyId ?? null,
    name: String(d.companyName ?? summary.name ?? '').trim(),
    chain: d.propertyChainName || summary.company || null,
    propertyType: d.propertyType || summary.type || null,

    city: loc.city ?? null,
    state: loc.state ?? null,
    stateAbbr: loc.stateAbbr ?? null,
    country: loc.country ?? null,
    countryCodeISO3: d.countryCodeISO3 || null,
    subdivisionCode: d.subdivisionCode || null,
    postalCode: d.supplierPostalCode || null,
    lat: num(d.latitude),
    lng: num(d.longitude),

    // Supplier-provided classification — this is what replaces our AI guesses.
    experiences: selected(d.hotelExperiences).length ? selected(d.hotelExperiences) : (summary.experiences ?? []),
    vibes: selected(d.hotelVibes),
    roomStyle: selected(d.roomStyle),
    features: selected(d.hotelFeatures),

    numberOfRooms: d.numberOfRooms ?? null,
    roomTypes: (d.guestRooms ?? [])
      .map(r => ({ r, rank: roomRank(r.roomTypeName, text(r.descriptionHtml)) }))
      .sort((a, b) => b.rank - a.rank)              // best of the house first
      .slice(0, MAX_ROOM_TYPES)
      .map(({ r }) => ({
      name: r.roomTypeName,
      description: clip(text(r.descriptionHtml), 160),
      // Only the flags actually set. A traveller asks for a private pool or
      // connecting rooms; the "false" entries are noise and triple the payload.
      amenities: [r.amenities, r.services, r.features]
        .flatMap(g => (g?.features ?? []).filter(f => f.isSelected).map(f => f.featureName)),
    })),
    roomTypeCount: (d.guestRooms ?? []).length,

    // Authoritative Virtuoso benefits, year-stamped by the supplier.
    perks: listItems(d.virtuosoAmenitiesHtml),
    perksYear: perkYear(d.virtuosoAmenitiesHtml),
    hasVirtuosoBenefits: summary.hasVirtuosoBenefits ?? null,
    hasSpecialAmenities: d.hasSpecialAmenities ?? d.productHasSpecialAmenities ?? null,
    hideAmenitiesFromConsumer: d.hideVirtuosoAmenitiesFromConsumer ?? false,

    // Prose the guide can search and quote.
    summary: clip(text(d.propertySummaryHtml), MAX_SUMMARY),
    folioDescription: text(d.asSeenInTravelFolioDescription),
    folioInTheKnow: text(d.asSeenInTravelFolioInTheKnow),

    image: d.defaultImageUrl || summary.defaultImageUrl || null,
    images: (d.imageLibraryItems ?? []).slice(0, MAX_IMAGES).map(i => ({ url: i.url, caption: i.caption || null })),
    imageCount: (d.imageLibraryItems ?? []).length,
    video: d.supplierVideos?.[0]?.webContentURL || null,

    nearestAirport: d.nearestAirportDescription || null,
    nearestAirportMiles: d.nearestAirportDistanceInMiles ?? null,
    sustainability: (d.sustainabilityCertifications ?? []).map(c => c.certificationName).filter(Boolean),
    reviews,
    businessRegions: summary.businessRegions ?? [],
    joinDate: d.joinDate || null,
  };
}


/*
 * Rank room types so the best of the house comes first.
 *
 * The feed lists rooms the supplier's way, which is usually smallest upward —
 * "Cosy Double" was leading a nine-room property whose Signature Suites are the
 * reason anyone books it. Since the list is capped, taking the first six showed
 * the six least interesting rooms.
 *
 * Name is the signal that actually exists: only 10% of rooms state a size, but
 * 874 of 5,645 sampled say "suite" and 313 "villa". So tier by what the room is
 * called, and use square metres only to break ties inside a tier.
 */
const ROOM_TIERS = [
  [/\b(presidential|royal|imperial|owner'?s)\b/i, 100],
  [/\bpenthouse\b/i, 90],
  [/\b(villa|residence|bungalow|chalet)\b/i, 80],
  [/\b(signature|grand|premier)\s+suite\b/i, 75],
  [/\bsuite\b/i, 60],
  [/\b(signature|grand)\b/i, 50],
  [/\b(premier|executive|club)\b/i, 40],
  [/\b(deluxe|superior)\b/i, 30],
  [/\bstudio\b/i, 20],
];

const roomRank = (name, descriptionText) => {
  const n = String(name ?? '');
  let tier = 10;                                   // a plain room
  for (const [re, score] of ROOM_TIERS) if (re.test(n)) { tier = score; break; }
  // "Junior Suite" is a suite, but not one of the best rooms in the house.
  if (/\bjunior\b/i.test(n)) tier -= 25;
  const sqm = Number(/([\d,.]+)\s*m²/.exec(descriptionText ?? '')?.[1]?.replace(/,/g, '')) || 0;
  return tier * 10000 + Math.min(sqm, 9999);
};

// ---------- crawl ----------

function readCache() {
  if (!fs.existsSync(CACHE_FILE) || FORCE) return new Map();
  const entries = new Map();
  for (const line of fs.readFileSync(CACHE_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const rec = JSON.parse(line); if (rec?.id) entries.set(String(rec.id), rec); } catch { /* skip torn line */ }
  }
  return entries;
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = readCache();
  console.log(`cache: ${cache.size} detail records on disk`);

  let catalog;
  const catalogFile = path.join(CACHE_DIR, 'hotels-catalog.json');

  if (NORMALIZE_ONLY) {
    if (!fs.existsSync(catalogFile)) throw new Error('--normalize-only needs a cached catalog; run a full sync first.');
    catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    console.log(`catalog: ${catalog.length} rows (from cache)`);
  } else {
    const v = createClient({ log: msg => console.log(msg) });
    const { totalRows, rows } = await v.searchAll('/v2/hotels');
    console.log(`catalog: ${rows.length}/${totalRows} properties`);
    catalog = rows;
    fs.writeFileSync(catalogFile, JSON.stringify(rows, null, 1));

    const targets = LIMIT ? catalog.slice(0, LIMIT) : catalog;
    const todo = targets.filter(r => FORCE || !cache.has(String(r.id)));
    console.log(`detail: ${todo.length} to fetch, ${targets.length - todo.length} cached`);

    if (todo.length) {
      const stream = fs.createWriteStream(CACHE_FILE, { flags: FORCE ? 'w' : 'a' });
      const started = Date.now();
      let done = 0, failed = 0;
      for (const row of todo) {
        try {
          const res = await v.call('/v2/hotel', { id: row.id });
          const rec = { id: String(row.id), detail: res.result?.data ?? null };
          cache.set(rec.id, rec);
          stream.write(JSON.stringify(rec) + '\n');
        } catch (err) {
          failed++;
          console.warn(`  ! ${row.id} ${String(row.name).trim()}: ${err.message}`);
        }
        if (++done % 100 === 0 || done === todo.length) {
          const rate = done / ((Date.now() - started) / 1000);
          const left = Math.round((todo.length - done) / rate);
          console.log(`  ${done}/${todo.length} (${rate.toFixed(1)}/s, ~${Math.floor(left / 60)}m ${left % 60}s left, ${failed} failed)`);
        }
      }
      await new Promise(r => stream.end(r));
    }
  }

  const targets = LIMIT ? catalog.slice(0, LIMIT) : catalog;
  const feed = targets.map(row => normalize(row, cache.get(String(row.id))?.detail)).filter(h => h.vid);

  const withDetail = feed.filter(h => h.lat != null).length;
  const out = {
    _meta: {
      source: 'Virtuoso Partner API /v2/hotels + /v2/hotel',
      count: feed.length,
      withDetail,
      note: 'Supplier-provided truth. Ranking and curation overlays live alongside this file, keyed by vid.',
    },
    hotels: feed.sort((a, b) => a.name.localeCompare(b.name)),
  };
  const moved = writeFeed(path.relative(repoRoot, OUT_FILE), out, { label: 'hotels' });
  console.log(`\nwrote ${path.relative(repoRoot, OUT_FILE)} — ${feed.length} properties, ${withDetail} with detail`);
  console.log(`  photos: ${feed.filter(h => h.image).length} · perks: ${feed.filter(h => h.perks.length).length} · prose: ${feed.filter(h => h.summary).length}`);
}

main().catch(err => { console.error(`\nsync failed: ${err.message}`); process.exit(1); });

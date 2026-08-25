#!/usr/bin/env node
// Builds the live hotel feed from our curated base plus Virtuoso supplier truth.
//
//   data/atlas/hotel/luxury-hotels.base.json   our records, incl. non-Virtuoso partners
// + data/atlas/hotel/virtuoso-hotels.json      supplier truth (scripts/sync-virtuoso-hotels.mjs)
// + data/atlas/hotel/virtuoso-id-map.json      the mapping (scripts/match-virtuoso-hotels.mjs)
// = data/atlas/hotel/luxury-hotels.json        what the atlas and the guide read
//
// Division of authority, per the project's ground rules: Virtuoso owns the facts
// (name, place, coordinates, category, amenities, photos, perks). We keep what
// Virtuoso has no opinion about — Cadence programme membership and ranking, the
// marquee region used for map filtering, booking links, advisor curation.
//
//   node scripts/merge-virtuoso-hotels.mjs
//   node scripts/merge-virtuoso-hotels.mjs --check   # fail if the output is stale

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/virtuoso/env.mjs';

const CHECK = process.argv.includes('--check');
const D = path.join(repoRoot, 'data/atlas/hotel');
const read = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));

const base = read('luxury-hotels.base.json');
const feedDoc = read('virtuoso-hotels.json');
const map = read('virtuoso-id-map.json');
const byVid = new Map(feedDoc.hotels.map(h => [h.vid, h]));

// ---------- category, from supplier signals instead of a guess ----------

// The old feed put 73% of every property into "City Hotel" — the classifier's
// dumping ground — and found only 15 ski properties where Virtuoso flags 99.
// These rules keep the existing eight-value vocabulary so the UI filters and
// saved links keep working, but decide it from what the supplier declares.
// Order is priority: the most specific signal wins.
function deriveCategory(v, fallback) {
  const exp = new Set(v.experiences ?? []);
  const feat = new Set(v.features ?? []);
  const type = v.propertyType ?? '';

  if (type === 'Private Island') return 'Island Resort';
  if (type === 'Villa or Luxury Residence') return 'Villas / Residences';
  if (type === 'Lodge, Ranch, Camp') return 'Lodge / Safari';
  if (exp.has('Ski') || feat.has('Ski-in/Ski-out')) return 'Mountain / Ski';
  if (type === 'Spa') return 'Spa / Wellness Resort';
  if (exp.has('Beach') || feat.has('Private Beach')) return 'Beach Resort';
  if (exp.has('Ecotourism')) return 'Lodge / Safari';
  if (exp.has('City Life') || exp.has('Landmarks')) return 'City Hotel';
  if (exp.has('Wellness') && exp.has('Seclusion')) return 'Spa / Wellness Resort';
  if (exp.size) return 'Resort / Leisure';
  return fallback ?? 'Resort / Leisure';
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Search tags: supplier experiences and vibes, plus the legacy words the old
 *  tag vocabulary used, so existing queries keep hitting. */
function deriveTags(v, category) {
  const tags = new Set();
  for (const e of v.experiences ?? []) tags.add(slug(e));
  for (const vibe of v.vibes ?? []) tags.add(slug(vibe));
  for (const s of v.roomStyle ?? []) tags.add(slug(s));
  const legacy = {
    'City Hotel': ['urban'], 'Beach Resort': ['beach', 'resort'], 'Island Resort': ['island', 'resort'],
    'Mountain / Ski': ['mountain', 'ski'], 'Lodge / Safari': ['lodge', 'safari'],
    'Spa / Wellness Resort': ['spa', 'wellness'], 'Villas / Residences': ['villa', 'residences'],
    'Resort / Leisure': ['resort'],
  }[category] ?? [];
  for (const t of legacy) tags.add(t);
  if ((v.features ?? []).some(f => /spa/i.test(f))) tags.add('spa');
  if ((v.features ?? []).some(f => /golf/i.test(f))) tags.add('golf');
  if (v.propertyType === 'Private Island') tags.add('private-island');
  return [...tags].sort();
}

// ---------- merge ----------

const dropped = new Map();                     // dropped local id -> kept local id
for (const d of map.duplicates ?? []) dropped.set(d.drop, d.keep);
for (const c of map.collisions ?? []) {
  // Collisions found by exact matching: keep the first, fold the rest in.
  const [keep, ...rest] = c.localIds;
  for (const r of rest) if (!dropped.has(r)) dropped.set(r, keep);
}

// Records that are obviously not real properties.
const JUNK = /^iceportal hotel test/i;

const merged = [];
const stats = { upgraded: 0, localOnly: 0, added: 0, dropped: 0, junk: 0, categoryChanged: 0, perksReplaced: 0, photos: 0 };

for (const h of base) {
  if (JUNK.test(h.name)) { stats.junk++; continue; }
  if (dropped.has(h.id)) { stats.dropped++; continue; }

  const vid = map.matched[h.id]?.vid;
  const v = vid ? byVid.get(vid) : null;

  if (!v) {
    // A partner Virtuoso doesn't carry — Cadence-only, Belmond, Marriott STARS.
    // Left exactly as curated; nothing here is supplier-verifiable.
    merged.push({ ...h, vid: null, source: 'local' });
    stats.localOnly++;
    continue;
  }

  const category = deriveCategory(v, h.category);
  if (category !== h.category) stats.categoryChanged++;
  if (v.perks.length) stats.perksReplaced++;
  if (v.image) stats.photos++;

  merged.push({
    id: h.id,
    vid: v.vid,
    name: v.name || h.name,
    brand: h.brand,                                   // ours: drives brand grouping
    chain: v.chain ?? null,
    program: h.program,                               // ours: Cadence programme membership
    category,
    country: v.country || h.country,
    city: v.city || h.city,
    address: h.address,                               // API carries no street address
    postalCode: v.postalCode ?? null,
    lat: v.lat ?? h.lat,
    lng: v.lng ?? h.lng,
    region: h.region,                                 // ours: marquee region for map filtering
    adminRegion: v.state || h.adminRegion,
    countryCode: v.countryCodeISO3 ?? null,

    vipUpgrades: v.perks.length ? v.perks : h.vipUpgrades,
    hideAmenities: v.hideAmenitiesFromConsumer || false,

    bookUrl: h.bookUrl,                               // ours
    bookPassword: h.bookPassword,                     // ours

    thumb: v.image ?? h.thumb,
    // The guide's card renderer takes `photos` as plain URL strings and shows up
    // to three (lib/search-offerings.js). The full library stays in the Virtuoso
    // feed, looked up by vid when a dossier needs it.
    images: (v.images ?? []).slice(0, 3).map(i => i.url).filter(Boolean),
    imageCount: v.imageCount ?? 0,
    propertyType: v.propertyType ?? null,
    numberOfRooms: v.numberOfRooms ?? null,
    nearestAirport: v.nearestAirport ?? null,
    nearestAirportMiles: v.nearestAirportMiles ?? null,
    experiences: v.experiences ?? [],
    vibes: v.vibes ?? [],
    sustainability: v.sustainability ?? [],
    reviews: v.reviews ?? null,
    tags: deriveTags(v, category),
    source: 'virtuoso',
  });
  stats.upgraded++;
}

// Properties Virtuoso carries that we never had. `region` is a sparse marquee
// tag that is null for most of the existing feed, so leaving it null here is
// consistent rather than a gap. Ids are derived from the Virtuoso product id so
// they stay stable as the catalogue grows.
const claimedVids = new Set(Object.values(map.matched).map(m => m.vid));
for (const v of feedDoc.hotels) {
  if (claimedVids.has(v.vid)) continue;
  if (JUNK.test(v.name)) { stats.junk++; continue; }
  const category = deriveCategory(v, null);
  merged.push({
    id: `h_v${v.vid}`, vid: v.vid, name: v.name, brand: null, chain: v.chain ?? null,
    program: 'Virtuoso', category,
    country: v.country, city: v.city, address: null, postalCode: v.postalCode ?? null,
    lat: v.lat, lng: v.lng, region: null, adminRegion: v.state ?? null,
    countryCode: v.countryCodeISO3 ?? null,
    vipUpgrades: v.perks, hideAmenities: v.hideAmenitiesFromConsumer || false,
    bookUrl: 'https://www.VipTravelAi.com', bookPassword: 'VIP',
    thumb: v.image, images: (v.images ?? []).slice(0, 3).map(i => i.url).filter(Boolean),
    imageCount: v.imageCount ?? 0,
    propertyType: v.propertyType ?? null, numberOfRooms: v.numberOfRooms ?? null,
    nearestAirport: v.nearestAirport ?? null, nearestAirportMiles: v.nearestAirportMiles ?? null,
    experiences: v.experiences ?? [], vibes: v.vibes ?? [], sustainability: v.sustainability ?? [],
    reviews: v.reviews ?? null, tags: deriveTags(v, category), source: 'virtuoso-new',
  });
  stats.added++;
}

merged.sort((a, b) => a.name.localeCompare(b.name));

// ---------- keep the overlays pointing at surviving records ----------

// travelwits-overlay is keyed by our local id. When a duplicate is folded away,
// its booking link has to follow, or the surviving record dead-ends.
const tw = read('travelwits-overlay.json');
let twMoved = 0;
for (const [drop, keep] of dropped) {
  if (tw.matched?.[drop] && !tw.matched?.[keep]) { tw.matched[keep] = tw.matched[drop]; twMoved++; }
  delete tw.matched?.[drop];
}

// hotel-fit is our curation, keyed by `name|city|country` — which breaks the
// moment we adopt supplier names. Re-key it to the local id, which never moves.
// It reads from hotel-fit.base.json and writes hotel-fit.json: re-keying is not
// idempotent, so the source must not be the file this step overwrites.
// Must match lib/atlas/hotels.js exactly, or the carried-over curation silently
// misses: that file folds every non-alphanumeric run to a single space.
const keyPart = s => String(s == null ? '' : s).toLowerCase().trim().replace(/[^a-z0-9|]+/g, ' ').trim();
const oldFit = read('hotel-fit.base.json');   // immutable input: re-keying is not idempotent
const newFit = {};
let fitKept = 0, fitLost = 0;
for (const h of merged) {
  if (String(h.id).startsWith('h_v')) continue;                 // newly added, no curation yet
  const original = base.find(b => b.id === h.id);
  const legacyKey = original ? [original.name, original.city, original.country].map(keyPart).join('|') : null;
  const fit = (legacyKey && oldFit[legacyKey]) || null;
  if (fit) { newFit[h.id] = fit; fitKept++; } else fitLost++;
}
// Duplicates being folded away may carry the curation the survivor lacks.
for (const [drop, keep] of dropped) {
  if (newFit[keep]) continue;
  const original = base.find(b => b.id === drop);
  const legacyKey = original ? [original.name, original.city, original.country].map(keyPart).join('|') : null;
  if (legacyKey && oldFit[legacyKey]) { newFit[keep] = oldFit[legacyKey]; fitKept++; fitLost--; }
}

// ---------- write ----------

const out = JSON.stringify(merged, null, 1);
const outPath = path.join(D, 'luxury-hotels.json');

if (CHECK) {
  const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (current !== out) { console.error('luxury-hotels.json is stale — run: node scripts/merge-virtuoso-hotels.mjs'); process.exit(1); }
  console.log(`ok — ${merged.length} properties`);
  process.exit(0);
}

fs.writeFileSync(outPath, out);
fs.writeFileSync(path.join(D, 'travelwits-overlay.json'), JSON.stringify(tw, null, 1));
fs.writeFileSync(path.join(D, 'hotel-fit.json'), JSON.stringify(newFit, null, 1));
fs.writeFileSync(path.join(D, 'hotel-aliases.json'), JSON.stringify({
  _meta: { purpose: 'Old ids folded into a surviving record by de-duplication. Kept so existing deep links still resolve.', generated: new Date().toISOString() },
  aliases: Object.fromEntries(dropped),
}, null, 1));

console.log(`luxury-hotels.json — ${merged.length} properties`);
console.log(`  ${stats.upgraded} upgraded from Virtuoso · ${stats.added} newly added · ${stats.localOnly} local-only partners`);
console.log(`  ${stats.dropped} duplicates folded away · ${stats.junk} junk records removed`);
console.log(`  ${stats.categoryChanged} categories corrected · ${stats.perksReplaced} perk lists from supplier · ${stats.photos} photos attached`);
console.log(`  overlays: ${twMoved} booking links moved to survivors · hotel-fit re-keyed to id (${fitKept} kept, ${fitLost} without curation)`);

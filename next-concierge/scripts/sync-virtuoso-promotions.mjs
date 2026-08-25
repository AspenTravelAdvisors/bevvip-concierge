#!/usr/bin/env node
// Pulls Virtuoso's live promotions — the supplier offers attached to a property,
// sailing or tour — and writes a normalized feed the atlases can filter on.
//
// The search endpoint returns the offer's NAME but not its substance
// (`whatsIncluded` is empty on all 2,028 rows), and an offer called "Suite Deal"
// is useless without its terms. So this crawls the detail endpoint too, the same
// resumable NDJSON-cached way as the hotel sync, and for the same reason:
// ~2,000 sequential calls at ~800ms is half an hour that nobody should pay twice.
//
//   node scripts/sync-virtuoso-promotions.mjs
//   node scripts/sync-virtuoso-promotions.mjs --normalize-only
//   node scripts/sync-virtuoso-promotions.mjs --limit 40

import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, repoRoot } from '../lib/virtuoso/env.mjs';
import { createClient } from '../lib/virtuoso/client.mjs';

loadEnv();

const args = process.argv.slice(2);
const has = f => args.includes(f);
const value = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const FORCE = has('--force');
const NORMALIZE_ONLY = has('--normalize-only');
const LIMIT = Number(value('--limit') || 0);

const CACHE_DIR = path.join(repoRoot, 'scripts/cache/virtuoso');
const CACHE_FILE = path.join(CACHE_DIR, 'promotions-detail.ndjson');
const CATALOG_FILE = path.join(CACHE_DIR, 'promotions-catalog.json');
const OUT_FILE = path.join(repoRoot, 'data/atlas/shared/virtuoso-promotions.json');

const MAX_DESCRIPTION = 600;

const text = html => String(html ?? '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<\/(p|li|div|h\d)>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'")
  .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s);

/** Promotions carry location as "City|State|Country", not the hotels' JSON blob. */
function parseLocation(raw) {
  const [city = null, state = null, country = null] = String(raw ?? '').split('|').map(s => s.trim() || null);
  return { city, state, country };
}

const day = d => (d ? String(d).slice(0, 10) : null);

function normalize(row, detail) {
  const d = detail ?? {};
  const loc = parseLocation(row.location);
  return {
    id: String(row.id),
    name: String(row.name ?? row.title ?? '').trim(),
    type: row.type ?? null,
    company: (row.company ?? d.companyName ?? '').trim() || null,
    companyId: d.companyId ?? null,

    startDate: day(row.startDate),
    endDate: day(row.endDate),
    departureMonths: row.departureMonths ?? [],

    city: loc.city, state: loc.state, country: loc.country,
    businessRegions: row.businessRegions ?? [],

    // What the offer actually gives you — the reason to surface it at all.
    description: clip(text(d.promotionDescription), MAX_DESCRIPTION),
    website: d.promotionWebsite || d.businessWebsiteUri || null,
    // Virtuoso's own flag for the offers only its members can book.
    exclusive: Boolean(d.isVirtuosoExclusiveExperience) || /Virtuoso Exclusive/i.test(row.type ?? ''),
    hasVirtuosoBenefits: row.hasVirtuosoBenefits ?? null,
    image: row.defaultImageUrl || null,
  };
}

function readCache() {
  if (!fs.existsSync(CACHE_FILE) || FORCE) return new Map();
  const entries = new Map();
  for (const line of fs.readFileSync(CACHE_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const rec = JSON.parse(line); if (rec?.id) entries.set(String(rec.id), rec); } catch { /* torn line */ }
  }
  return entries;
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = readCache();
  console.log(`cache: ${cache.size} promotion details on disk`);

  let catalog;
  if (NORMALIZE_ONLY) {
    if (!fs.existsSync(CATALOG_FILE)) throw new Error('--normalize-only needs a cached catalog; run a full sync first.');
    catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    console.log(`catalog: ${catalog.length} promotions (from cache)`);
  } else {
    const v = createClient({ log: msg => console.log(msg) });
    const { totalRows, rows } = await v.searchAll('/v2/promotions');
    console.log(`catalog: ${rows.length}/${totalRows} promotions`);
    catalog = rows;
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(rows));

    const targets = LIMIT ? catalog.slice(0, LIMIT) : catalog;
    const todo = targets.filter(r => FORCE || !cache.has(String(r.id)));
    console.log(`detail: ${todo.length} to fetch, ${targets.length - todo.length} cached`);

    if (todo.length) {
      const stream = fs.createWriteStream(CACHE_FILE, { flags: FORCE ? 'w' : 'a' });
      const started = Date.now();
      let done = 0, failed = 0;
      for (const row of todo) {
        try {
          const res = await v.call('/v2/promotion', { id: row.id });
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
  const feed = targets.map(row => normalize(row, cache.get(String(row.id))?.detail)).filter(p => p.id && p.name);

  const byType = {};
  for (const p of feed) byType[p.type ?? 'unknown'] = (byType[p.type ?? 'unknown'] ?? 0) + 1;

  const out = {
    _meta: {
      source: 'Virtuoso Partner API /v2/promotions + /v2/promotion',
      lastSynced: new Date().toISOString(),
      count: feed.length,
      byType,
      note: 'Live supplier offers. Linked to atlas records by company name in scripts/merge-virtuoso-hotels.mjs.',
    },
    promotions: feed.sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? '')),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
  console.log(`\nwrote ${path.relative(repoRoot, OUT_FILE)} — ${feed.length} promotions`);
  console.log(`  by type: ${Object.entries(byType).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  console.log(`  with description: ${feed.filter(p => p.description).length} · exclusive: ${feed.filter(p => p.exclusive).length}`);
}

main().catch(err => { console.error(`\nsync failed: ${err.message}`); process.exit(1); });

// scripts/test-guide.mjs — Base Camp T6 tests
// Run: node scripts/test-guide.mjs
//  1. search_offerings against the LIVE Hotel Atlas API (integration).
//  2. runGuideTurn tool-loop with a MOCKED Claude caller (no API key needed).

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  searchOfferings,
  chartRegionFrom,
  clampLimit,
  normalizeMonth,
  normalizeCountry,
  normalizeRegionKey,
  prioritizeMentionedPlace,
  SEARCH_OFFERINGS_TOOL,
} from '../lib/search-offerings.js';
import { runGuideTurn, summarizeMeta } from '../api/guide.js';

const require = createRequire(import.meta.url);
const hotelAtlas = require('../../Luxury-Hotel-Atlas/lib/hotels.js');
const cruiseAtlas = require('../../Expedition-Cruise-Map/lib/cruises.js');
const yachtAtlas = require('../../Luxury-Hotel-Brand-Yacht-Atlas/lib/sailings.js');
const jetAtlas = require('../../Private-Jet-Expeditions/lib/journeys.js');
const worldCruiseAtlas = require('../../World-Cruise-Atlas/lib/cruises.js');

const localAtlasFetch = async (url) => {
  const u = new URL(url);
  const params = Object.fromEntries(u.searchParams);
  let body;
  if (u.pathname === '/api/luxury-hotels') body = hotelAtlas.query(params);
  else if (u.pathname === '/api/expedition-cruises') body = cruiseAtlas.query(params);
  else if (u.pathname === '/api/yacht-sailings') body = yachtAtlas.query(params);
  else if (u.pathname === '/api/jet-journeys') body = jetAtlas.query(params);
  else if (u.pathname === '/api/world-cruises') body = worldCruiseAtlas.query(params);
  else body = { total: 0, count: 0, results: [], deepLink: null };
  return { ok: true, json: async () => body };
};
const localSearch = (input) => searchOfferings(input, { fetchImpl: localAtlasFetch });

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok  ' + name); }

// ── unit: helpers ────────────────────────────────────────────────────────────
await test('tool schema shape (Anthropic input_schema)', () => {
  assert.equal(SEARCH_OFFERINGS_TOOL.name, 'search_offerings');
  assert.deepEqual(SEARCH_OFFERINGS_TOOL.input_schema.properties.type.enum,
    ['hotel', 'cruise', 'jet', 'yacht', 'worldcruise', 'any']);
  assert.ok(SEARCH_OFFERINGS_TOOL.input_schema.properties.intent.enum.includes('wildlife'));
  assert.ok(SEARCH_OFFERINGS_TOOL.input_schema.properties.intent.enum.includes('wellness'));
});

await test('clampLimit default 6, capped at four per category', () => {
  assert.equal(clampLimit(undefined, 6), 4);
  assert.equal(clampLimit(0, 6), 4);
  assert.equal(clampLimit(100, 6), 4);
  assert.equal(clampLimit(3, 6), 3);
});

await test('chartRegionFrom prefers explicit marquee key', () => {
  assert.equal(chartRegionFrom('japan', []), 'japan');
  assert.equal(chartRegionFrom('New York', []), null); // not a marquee key
  assert.equal(chartRegionFrom('', [{ region: 'mediterranean' }, { region: 'mediterranean' }, { region: 'japan' }]),
    'mediterranean');
});

await test('normalizeMonth maps bare months to their next calendar occurrence', () => {
  const june2026 = new Date('2026-06-09T12:00:00Z');
  assert.equal(normalizeMonth('August', june2026), '2026-08');
  assert.equal(normalizeMonth('May', june2026), '2027-05');
  assert.equal(normalizeMonth('August 2026', june2026), '2026-08');
  assert.equal(normalizeMonth('2026 August', june2026), '2026-08');
});

// ── integration: local atlas search ──────────────────────────────────────────
await test('searchOfferings hotel: Aman in Japan returns real records + deepLink', async () => {
  const r = await searchOfferings(
    { type: 'hotel', brand: 'Aman', region: 'japan', limit: 3 },
    { fetchImpl: localAtlasFetch }
  );
  assert.equal(r.type, 'hotel');
  assert.ok(r.total >= 3);
  assert.equal(r.results.length, 3);
  assert.ok(r.results.every((h) => h.brand === 'Aman' && h.region === 'japan'));
  assert.ok(r.results[0].name && r.results[0].bookUrl);
  assert.ok(Number.isFinite(r.results[0].lat) && Number.isFinite(r.results[0].lng));
  assert.equal(r.results[0].bookPassword, 'VIP');
  assert.ok(r.deepLink.includes('brand=Aman') && r.deepLink.includes('region=japan'));
  assert.equal(r.chartRegion, 'japan');
});

await test('searchOfferings honest count for a broad query (limit < total)', async () => {
  const r = await searchOfferings(
    { type: 'hotel', country: 'Italy', limit: 3 },
    { fetchImpl: localAtlasFetch }
  );
  assert.ok(r.total > r.count);   // total is unpaginated
  assert.equal(r.count, r.results.length);
});

await test('searchOfferings type=any defaults to hotels', async () => {
  const r = await searchOfferings(
    { type: 'any', q: 'aman', limit: 2 },
    { fetchImpl: localAtlasFetch }
  );
  assert.equal(r.type, 'hotel');
  assert.equal(r.results.length, 2);
});

// Shared helper: respond with empty inventory for non-hotel sidecar lookups.
const emptyOk = () => ({ ok: true, json: async () => ({ total: 0, count: 0, results: [] }) });

await test('searchOfferings hotel treats bare month text as a date, not q', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    assert.equal(u.searchParams.get('month'), '2026-08');
    assert.equal(u.searchParams.get('q'), null);
    assert.equal(u.searchParams.get('country'), 'Italy');
    assert.equal(u.searchParams.get('limit'), '24'); // candidate overfetch for brand diversity
    return { ok: true, json: async () => ({ total: 6, count: 6, results: [
      { id: 'h_1', name: 'One', country: 'Italy' },
      { id: 'h_2', name: 'Two', country: 'Italy' },
      { id: 'h_3', name: 'Three', country: 'Italy' },
      { id: 'h_4', name: 'Four', country: 'Italy' },
      { id: 'h_5', name: 'Five', country: 'Italy' },
      { id: 'h_6', name: 'Six', country: 'Italy' },
    ], deepLink: 'https://luxury-hotel-atlas-two.vercel.app?country=Italy&month=2026-08' }) };
  };
  const r = await searchOfferings({ type: 'hotel', country: 'Italy', q: 'hotels in August' }, { fetchImpl });
  assert.equal(r.count, 3); // curated to the default display limit
  assert.equal(r.total, 6); // honest unpaginated count
});

await test('searchOfferings drops intent on an open cruise/yacht search, keeps it when a brand is named', async () => {
  // Regression: intent only re-sorts the cruise/yacht atlas page (it does not
  // filter — the total is unchanged), so on an open search a strong intent sorts
  // the top page down to one or two operators and hides the rest (a Galápagos
  // "expedition" search came back all Silversea + Lindblad). An open search now
  // drops intent to recover supplier breadth; a branded ask keeps it.
  let seen = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    seen.push({ path: u.pathname, intent: u.searchParams.get('intent') });
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: u.pathname.includes('yacht') ? 'yc_1' : 'cr_1', type: u.pathname.includes('yacht') ? 'yacht' : 'cruise',
        name: 'Antarctica fit check', brand: 'Seabourn', region: 'antarctica' },
    ], deepLink: 'https://example.test' }) };
  };
  await searchOfferings({ type: 'cruise', region: 'antarctica', intent: 'wildlife', limit: 2 }, { fetchImpl });
  assert.ok(seen.some((x) => x.path.includes('expedition-cruises')) && seen.every((x) => x.intent === null));

  // Branded ask: the traveler wants that one operator, so intent is forwarded to
  // rank within it.
  seen = [];
  await searchOfferings({ type: 'cruise', region: 'antarctica', intent: 'wildlife', brand: 'Seabourn', limit: 2 }, { fetchImpl });
  assert.ok(seen.some((x) => x.intent === 'wildlife'));
});

await test('searchOfferings cruise promotes a destination left in q to the region filter', async () => {
  // Regression: the cruise atlas AND-filters `q` over fields that do NOT index
  // the destination name, so "Galapagos" left in q zeroed an otherwise-valid
  // region+month search (44 real departures returned as 0 supplier, no cards).
  const cruiseUrls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('yacht-sailings')) return emptyOk();
    cruiseUrls.push(u);
    // Mimic the live atlas: a destination name in q matches nothing.
    if ((u.searchParams.get('q') || '').toLowerCase().includes('galapagos')) {
      return { ok: true, json: async () => ({ total: 0, count: 0, results: [] }) };
    }
    if (u.searchParams.get('region') !== 'galapagos') return emptyOk();
    return { ok: true, json: async () => ({ total: 44, count: 2, results: [
      { id: 'cr_1', type: 'cruise', name: 'Galapagos 7nt', operator: 'Silversea', region: 'galapagos' },
      { id: 'cr_2', type: 'cruise', name: 'Galapagos West', operator: 'National Geographic-Lindblad Expeditions', region: 'galapagos' },
    ], deepLink: 'https://expedition-cruise-map.vercel.app?region=galapagos' }) };
  };
  const r = await searchOfferings(
    { type: 'cruise', q: 'Galapagos expedition cruises', month: 'February' },
    { fetchImpl });
  assert.ok(r.count >= 2, 'recovers the region inventory instead of zeroing out');
  const cruise = cruiseUrls.find((u) => u.searchParams.get('region') === 'galapagos');
  assert.ok(cruise, 'destination is promoted to the region filter');
  assert.ok(!(cruise.searchParams.get('q') || '').toLowerCase().includes('galapagos'),
    'destination name is stripped from the q text');
});

await test('searchOfferings cruise drops a non-indexed descriptor when a geo anchor holds', async () => {
  // "wildlife" is not in the atlas q-index; with a region anchor it must broaden
  // past the descriptor rather than return nothing.
  const seen = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('yacht-sailings')) return emptyOk();
    seen.push(u.searchParams.get('q'));
    if (u.searchParams.get('q')) {
      return { ok: true, json: async () => ({ total: 0, count: 0, results: [] }) };
    }
    return { ok: true, json: async () => ({ total: 44, count: 1, results: [
      { id: 'cr_1', type: 'cruise', name: 'Galapagos 7nt', operator: 'Silversea', region: 'galapagos' },
    ], deepLink: 'https://expedition-cruise-map.vercel.app?region=galapagos' }) };
  };
  const r = await searchOfferings(
    { type: 'cruise', region: 'galapagos', q: 'wildlife', month: 'February' },
    { fetchImpl });
  assert.equal(r.count, 1);
  assert.ok(seen.includes('wildlife') && seen.includes(null),
    'retries once without q after the descriptor over-filters');
});

await test('searchOfferings cruise does not broaden a q-only search with no geo anchor', async () => {
  // Without a region/country anchor, dropping q would balloon to the whole
  // month; the search must stay scoped to whatever q honestly matched.
  let calls = 0;
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('yacht-sailings')) return emptyOk();
    calls++;
    return { ok: true, json: async () => ({ total: 0, count: 0, results: [] }) };
  };
  const r = await searchOfferings(
    { type: 'cruise', q: 'penguins', month: 'February' }, { fetchImpl });
  assert.equal(r.count, 0);
  assert.equal(calls, 1, 'no q-drop retry fires without a geographic anchor');
});

await test('searchOfferings hotel gives a named place priority over broad country', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    assert.equal(u.searchParams.get('country'), 'United States');
    assert.equal(u.searchParams.get('q'), 'Aspen');
    assert.equal(u.searchParams.get('limit'), '24');
    return { ok: true, json: async () => ({ total: 3, count: 3, results: [
      { id: 'h_1', name: 'The Little Nell', city: 'Aspen', country: 'United States',
        vipUpgrades: ['Room Upgrade', '$100 hotel credit'] },
      { id: 'h_2', name: 'Hotel Jerome', city: 'Aspen', country: 'United States' },
      { id: 'h_3', name: 'MOLLIE Aspen', city: 'Aspen', country: 'United States' },
    ], deepLink: 'https://luxury-hotel-atlas-two.vercel.app?country=United+States&q=Aspen' }) };
  };
  const r = await searchOfferings({
    type: 'hotel',
    country: 'United States',
    place: 'Aspen',
    q: 'whats the nicest hotel',
    limit: 3,
  }, { fetchImpl });
  assert.equal(r.results[0].city, 'Aspen');
  assert.deepEqual(r.results[0].vipUpgrades, ['"First Priority" Room Upgrade', '$100 hotel credit']);
});

await test('searchOfferings hotel retries place-only when descriptors over-filter', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    seen.push(u.searchParams.get('q'));
    if (seen.length === 1) {
      assert.equal(u.searchParams.get('q'), 'Aspen ski-in');
      return { ok: true, json: async () => ({ total: 0, count: 0, results: [] }) };
    }
    assert.equal(u.searchParams.get('q'), 'Aspen');
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: 'h_1', name: 'The Little Nell', city: 'Aspen', country: 'United States' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'hotel', place: 'Aspen', q: 'ski-in' }, { fetchImpl });
  assert.deepEqual(seen, ['Aspen ski-in', 'Aspen']);
  assert.equal(r.count, 1);
});

await test('searchOfferings hotel falls back to country/region when a place zeroes out', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    seen.push(u.searchParams.get('q'));
    if (u.searchParams.get('q')) {
      return { ok: true, json: async () => ({ total: 0, count: 0, results: [] }) };
    }
    assert.equal(u.searchParams.get('country'), 'Italy');
    return { ok: true, json: async () => ({ total: 2, count: 2, results: [
      { id: 'h_1', name: 'Villa d\'Este', city: 'Cernobbio', country: 'Italy' },
      { id: 'h_2', name: 'Grand Hotel Tremezzo', city: 'Tremezzo', country: 'Italy' },
    ] }) };
  };
  const r = await searchOfferings(
    { type: 'hotel', place: 'Lake Komo', country: 'Italy' }, { fetchImpl });
  assert.deepEqual(seen, ['Lake Komo', null]); // place-only, then constraint-only
  assert.equal(r.count, 2);
});

await test('searchOfferings keeps independent (unbranded) hotels distinct in shortlists', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    return { ok: true, json: async () => ({ total: 4, count: 4, results: [
      { id: 'h_1', name: 'Castello di Velona', brand: null, country: 'Italy' },
      { id: 'h_2', name: 'Villa San Michele', brand: null, country: 'Italy' },
      { id: 'h_3', name: 'Rosapetra Spa Resort', brand: null, country: 'Italy' },
      { id: 'h_4', name: 'Four Seasons Firenze', brand: 'Four Seasons', country: 'Italy' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'hotel', country: 'Italy', limit: 3 }, { fetchImpl });
  // The top three independents hold their rank instead of collapsing into one
  // shared "unbranded" slot behind the chain property.
  assert.deepEqual(r.results.map((h) => h.id), ['h_1', 'h_2', 'h_3']);
});

await test('searchOfferings hotel attaches related yacht sailings for yacht-capable brands', async () => {
  const yachtParams = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('yacht-sailings')) {
      yachtParams.push(u.searchParams);
      return { ok: true, json: async () => ({ total: 27, count: 2, results: [
        { id: 'yc_2', type: 'yacht', name: 'The Rivieras Featuring Porto Venere',
          brand: 'Four Seasons Yachts', from: 'Monte-Carlo, Monaco',
          ports: ['Monte-Carlo, Monaco', 'Porto Venere, Italy', 'Porto Cervo, Italy'] },
        { id: 'yc_9', type: 'yacht', name: 'Amalfi Coast in Depth',
          brand: 'Four Seasons Yachts', from: 'Rome (Civitavecchia), Italy' },
      ], deepLink: 'https://luxury-hotel-brand-yacht-atlas.vercel.app?brand=Four+Seasons+Yachts&country=Italy' }) };
    }
    return { ok: true, json: async () => ({ total: 3, count: 3, results: [
      { id: 'h_1', name: 'Four Seasons Hotel Firenze', brand: 'Four Seasons', city: 'Florence', country: 'Italy' },
      { id: 'h_2', name: 'Four Seasons Hotel Milano', brand: 'Four Seasons', city: 'Milan', country: 'Italy' },
      { id: 'h_3', name: 'San Domenico Palace', brand: 'Four Seasons', city: 'Taormina', country: 'Italy' },
    ], deepLink: 'https://luxury-hotel-atlas-two.vercel.app?brand=Four+Seasons&country=Italy' }) };
  };
  const r = await searchOfferings({ type: 'hotel', brand: 'Four Seasons', country: 'Italy', limit: 3 }, { fetchImpl });
  assert.equal(r.count, 3);
  assert.ok(Array.isArray(r.related) && r.related.length === 1);
  const rel = r.related[0];
  assert.equal(rel.kind, 'yacht');
  assert.equal(rel.total, 27);
  assert.equal(rel.count, 2);
  assert.equal(rel.results.length, 2);
  assert.match(rel.reason, /Four Seasons Yachts/);
  assert.match(rel.reason, /Italy/);
  assert.equal(yachtParams[0].get('brand'), 'Four Seasons Yachts');
  assert.equal(yachtParams[0].get('country'), 'Italy');
  assert.ok(rel.results[0].ports.includes('Porto Venere, Italy'));
});

await test('searchOfferings hotel attaches curated expedition and jet cross-references for the same region', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    seen.push(u.pathname);
    if (u.pathname.includes('expedition-cruises')) {
      assert.equal(u.searchParams.get('region'), 'japan');
      return { ok: true, json: async () => ({ total: 4, count: 2, results: [
        { id: 'cr_1', type: 'cruise', name: 'Japan Expedition', operator: 'Ponant', region: 'japan' },
        { id: 'cr_2', type: 'cruise', name: 'Japan Coast', operator: 'Seabourn', region: 'japan' },
      ], deepLink: 'https://expedition-cruise-map.vercel.app?region=japan' }) };
    }
    if (u.pathname.includes('jet-journeys')) {
      assert.equal(u.searchParams.get('region'), 'japan');
      return { ok: true, json: async () => ({ total: 3, count: 2, results: [
        { id: 'jt_1', type: 'jet', name: 'Japan by Private Jet', brand: 'TCS', region: 'japan' },
        { id: 'jt_2', type: 'jet', name: 'East Asia Icons', brand: 'Four Seasons', region: 'japan' },
      ], deepLink: 'https://private-jet-expeditions.vercel.app?region=japan' }) };
    }
    if (u.pathname.includes('yacht-sailings')) return emptyOk();
    return { ok: true, json: async () => ({ total: 2, count: 2, results: [
      { id: 'h_1', name: 'Aman Tokyo', brand: 'Aman', city: 'Tokyo', country: 'Japan', region: 'japan' },
      { id: 'h_2', name: 'Aman Kyoto', brand: 'Aman', city: 'Kyoto', country: 'Japan', region: 'japan' },
    ], deepLink: 'https://luxury-hotel-atlas-two.vercel.app?region=japan' }) };
  };
  const r = await searchOfferings({ type: 'hotel', region: 'japan', limit: 2 }, { fetchImpl });
  assert.equal(r.count, 2);
  assert.ok(seen.some((p) => p.includes('expedition-cruises')));
  assert.ok(seen.some((p) => p.includes('jet-journeys')));
  const byKind = Object.fromEntries(r.related.map((rel) => [rel.kind, rel]));
  assert.equal(byKind.cruise.count, 2);
  assert.deepEqual(byKind.cruise.results.map((x) => x.id), ['cr_1', 'cr_2']);
  assert.equal(byKind.jet.count, 2);
  assert.deepEqual(byKind.jet.results.map((x) => x.id), ['jt_1', 'jt_2']);
});

await test('searchOfferings hotel skips the yacht sidecar for non-yacht brands', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url).pathname);
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: 'h_1', name: 'Rosewood Miramar Beach', brand: 'Rosewood', country: 'United States' },
    ] }) };
  };
  await searchOfferings({ type: 'hotel', brand: 'Rosewood', country: 'United States' }, { fetchImpl });
  assert.ok(calls.every((p) => p.includes('luxury-hotels')));
});

await test('searchOfferings yacht attaches pre/post hotel stays near embarkation', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('yacht-sailings')) {
      return { ok: true, json: async () => ({ total: 1, count: 1, results: [
        { id: 'yc_5', type: 'yacht', name: 'Monte Carlo to Rome',
          brand: 'Ritz-Carlton Yacht Collection', from: 'Monte-Carlo, Monaco', to: 'Rome, Italy' },
      ] }) };
    }
    assert.equal(u.searchParams.get('q'), 'Monte-Carlo');
    return { ok: true, json: async () => ({ total: 2, count: 2, results: [
      { id: 'h_7', name: 'Hotel de Paris', city: 'Monte Carlo', country: 'Monaco' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'yacht', brand: 'Ritz Carlton' }, { fetchImpl });
  assert.equal(r.count, 1);
  assert.equal(r.related[0].kind, 'hotel');
  assert.match(r.related[0].reason, /Monte-Carlo/);
  assert.equal(r.related[0].results[0].name, 'Hotel de Paris');
});

await test('prioritizeMentionedPlace infers hotel intent from trip-reason words', () => {
  const honeymoon = prioritizeMentionedPlace(
    { type: 'hotel', country: 'Italy' }, 'honeymoon hotels in positano');
  assert.equal(honeymoon.intent, 'honeymoon');
  const family = prioritizeMentionedPlace(
    { type: 'hotel', country: 'Greece' }, 'somewhere the kids will love staying');
  assert.equal(family.intent, 'family');
  const explicit = prioritizeMentionedPlace(
    { type: 'hotel', country: 'Italy', intent: 'uhnw' }, 'honeymoon hotels in positano');
  assert.equal(explicit.intent, 'uhnw'); // model-set intent wins
});

await test('prioritizeMentionedPlace recovers lowercase place from user text', () => {
  const input = prioritizeMentionedPlace(
    { type: 'hotel', country: 'United States', limit: 3 },
    'whats the nicest hotel in aspen',
  );
  assert.equal(input.place, 'Aspen');
  assert.equal(input.country, 'United States');
});

await test('prioritizeMentionedPlace routes broad cruise text to combined cruise search', () => {
  const input = prioritizeMentionedPlace(
    { type: 'any', brand: 'Ritz Carlton', limit: 5 },
    'show me Ritz Carlton cruises',
  );
  assert.equal(input.type, 'cruise');
  assert.equal(input.brand, 'Ritz Carlton');
});

await test('searchOfferings routes advisor-led Luxury Cruise brands outside current live inventory', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return emptyOk();
  };
  const r = await searchOfferings({ type: 'cruise', brand: 'Regent Seven Seas', limit: 3 }, { fetchImpl });
  assert.equal(calls, 0);
  assert.equal(r.type, 'cruise');
  assert.equal(r.count, 0);
  assert.equal(r.advisorOnly, true);
  assert.match(r.note, /advisor-led Luxury Cruise/i);
  assert.match(r.note, /Regent Seven Seas/i);
});

await test('searchOfferings routes generic Luxury Cruises to advisor unless current inventory is named', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return emptyOk();
  };
  const r = await searchOfferings({ type: 'any', q: 'luxury cruises in Alaska' }, { fetchImpl });
  assert.equal(calls, 0);
  assert.equal(r.advisorOnly, true);
  assert.match(r.note, /source sailings/i);
});

await test('searchOfferings cruise searches expedition cruise and yacht atlases', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('/api/expedition-cruises?')) {
      return { ok: true, json: async () => ({
        total: 375, count: 1,
        results: [{ id: 'cr_1', type: 'cruise', name: 'The Great White Continent',
          operator: 'Seabourn', region: 'antarctica', regionLabel: 'Antarctica',
          bookUrl: 'https://www.virtuoso.com/x' }],
        deepLink: 'https://expedition-cruise-map.vercel.app?region=antarctica',
      }) };
    }
    assert.ok(url.includes('/api/yacht-sailings?'), 'calls yacht atlas too: ' + url);
    return { ok: true, json: async () => ({
      total: 8, count: 1,
      results: [{ id: 'yc_1', type: 'yacht', name: 'Monte Carlo to Rome',
        brand: 'Ritz-Carlton Yacht Collection', region: 'mediterranean',
        bookUrl: 'https://www.virtuoso.com/y' }],
      deepLink: 'https://luxury-hotel-brand-yacht-atlas.vercel.app?region=antarctica',
    }) };
  };
  const r = await searchOfferings({ type: 'cruise', region: 'antarctica', limit: 4 }, { fetchImpl });
  assert.equal(r.type, 'cruise');
  assert.equal(seen.length, 2);
  assert.equal(r.total, 383);
  assert.equal(r.count, 2);
  assert.deepEqual(r.results.map((x) => x.type), ['cruise', 'yacht']);
  assert.ok(r.sources.find((s) => s.type === 'cruise'));
  assert.ok(r.sources.find((s) => s.type === 'yacht'));
  assert.equal(r.chartRegion, 'antarctica');
  assert.ok(r.deepLink.includes('region=antarctica'));
});

await test('searchOfferings open cruise surfaces every operator in the region, one card each', async () => {
  // Regression: a Galápagos search returned only two operators because intent
  // collapsed the page. An open search must show one sailing per operator and
  // cover them all (here four cruise lines), not crop to the small shortlist.
  const fetchImpl = async (url) => {
    if (url.includes('/api/expedition-cruises?')) {
      return { ok: true, json: async () => ({
        total: 52, count: 4,
        results: ['Aqua Expeditions', 'National Geographic-Lindblad Expeditions', 'Silversea', 'HX Expeditions']
          .map((op, i) => ({ id: `cr_${i + 1}`, type: 'cruise', name: `Cruise ${i + 1}`, operator: op })),
        deepLink: 'https://expedition-cruise-map.vercel.app',
      }) };
    }
    return { ok: true, json: async () => ({ total: 0, count: 0, results: [] }) };
  };
  const r = await searchOfferings({ type: 'cruise', region: 'galapagos', intent: 'expedition', limit: 3 }, { fetchImpl });
  const operators = r.results.filter((x) => x.type === 'cruise').map((x) => x.operator);
  assert.equal(operators.length, 4);
  assert.equal(new Set(operators).size, 4);
});

await test('searchOfferings cruise caps each atlas at the supplier ceiling while keeping cross-category results', async () => {
  // The one-per-operator sweep is bounded by MAX_SUPPLIERS_PER_CATEGORY (8) so a
  // busy category cannot run away; both atlases still contribute.
  const fetchImpl = async (url) => {
    if (url.includes('/api/expedition-cruises?')) {
      return { ok: true, json: async () => ({
        total: 20, count: 10,
        results: Array.from({ length: 10 }, (_, i) => ({
          id: `cr_${i + 1}`, type: 'cruise', name: `Cruise ${i + 1}`, operator: `Operator ${i + 1}`,
        })),
        deepLink: 'https://expedition-cruise-map.vercel.app',
      }) };
    }
    return { ok: true, json: async () => ({
      total: 20, count: 10,
      results: Array.from({ length: 10 }, (_, i) => ({
        id: `yc_${i + 1}`, type: 'yacht', name: `Yacht ${i + 1}`, brand: `Brand ${i + 1}`,
      })),
      deepLink: 'https://luxury-hotel-brand-yacht-atlas.vercel.app',
    }) };
  };
  const r = await searchOfferings({ type: 'cruise', limit: 24 }, { fetchImpl });
  assert.equal(r.results.filter((x) => x.type === 'cruise').length, 8);
  assert.equal(r.results.filter((x) => x.type === 'yacht').length, 8);
  assert.equal(r.count, 16);
});

await test('searchOfferings yacht normalizes Ritz-Carlton brand aliases', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    assert.ok(url.includes('/api/yacht-sailings?'));
    assert.equal(u.searchParams.get('brand'), 'Ritz-Carlton Yacht Collection');
    assert.equal(u.searchParams.get('limit'), '4');
    return { ok: true, json: async () => ({ total: 188, count: 4, results: [
      { id: 'yc_1', type: 'yacht', name: 'Tokyo to Incheon', brand: 'Ritz-Carlton Yacht Collection', region: 'japan' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'yacht', brand: 'Ritz Carlton', limit: 5 }, { fetchImpl });
  assert.equal(r.type, 'yacht');
  assert.equal(r.total, 188);
  assert.equal(r.results[0].brand, 'Ritz-Carlton Yacht Collection');
});

await test('searchOfferings caps caller limits at four per category', async () => {
  const fetchImpl = async (url) => {
    assert.match(url, /limit=4\b/);
    return { ok: true, json: async () => ({ total: 12, count: 4, results: [
      { id: 'jt_1', type: 'jet', name: 'One', region: 'japan' },
      { id: 'jt_2', type: 'jet', name: 'Two', region: 'japan' },
      { id: 'jt_3', type: 'jet', name: 'Three', region: 'japan' },
      { id: 'jt_4', type: 'jet', name: 'Four', region: 'japan' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'jet', region: 'japan', limit: 8 }, { fetchImpl });
  assert.equal(r.count, 4);
  assert.equal(r.results.length, 4);
});

await test('searchOfferings degrades gracefully when an atlas endpoint is down', async () => {
  const down = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const r = await searchOfferings({ type: 'yacht', region: 'mediterranean' }, { fetchImpl: down });
  assert.equal(r.type, 'yacht');
  assert.equal(r.count, 0);
  assert.ok(r.unavailable);
  assert.equal(r.chartRegion, 'mediterranean'); // still hand the map the region
  assert.ok(/advisor/i.test(r.note));
});

// ── audit fixes: alias normalization, region folding, honesty notes ─────────
await test('normalizeCountry maps common aliases to inventory spellings', () => {
  assert.equal(normalizeCountry('UK'), 'United Kingdom');
  assert.equal(normalizeCountry('USA'), 'United States');
  assert.equal(normalizeCountry('UAE'), 'United Arab Emirates');
  assert.equal(normalizeCountry('St Lucia'), 'saint lucia');   // case-insensitive at the atlas
  assert.equal(normalizeCountry('St. Lucia'), 'saint lucia');
  assert.equal(normalizeCountry('Turks & Caicos'), 'Turks and Caicos');
  assert.equal(normalizeCountry('Curaçao'), 'Curacao');
  assert.equal(normalizeCountry('Italy'), 'Italy');            // canonical passes through
  assert.equal(normalizeCountry('U.S. Virgin Islands'), 'U.S. Virgin Islands');
});

await test('normalizeRegionKey maps near-marquee phrasing onto marquee keys', () => {
  assert.equal(normalizeRegionKey('the Med'), 'mediterranean');
  assert.equal(normalizeRegionKey('Antarctic'), 'antarctica');
  assert.equal(normalizeRegionKey('Galápagos'), 'galapagos');
  assert.equal(normalizeRegionKey('Norwegian Fjords'), 'norway');
  assert.equal(normalizeRegionKey('Alaska'), 'alaska');       // marquee now
  assert.equal(normalizeRegionKey('the Caribbean'), 'caribbean');
});

await test('searchOfferings hotel normalizes country and brand aliases before the API call', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    assert.equal(u.searchParams.get('country'), 'United Kingdom');
    assert.equal(u.searchParams.get('brand'), 'Four Seasons');
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: 'h_1', name: 'Four Seasons Hotel London at Park Lane', brand: 'Four Seasons', country: 'United Kingdom' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'hotel', brand: 'FS', country: 'UK' }, { fetchImpl });
  assert.equal(r.count, 1);
});

await test('searchOfferings cruise normalizes operator aliases (Ponant, Nat Geo, HX)', async () => {
  const operators = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('expedition-cruises')) return emptyOk();
    operators.push(u.searchParams.get('operator'));
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: 'cr_1', type: 'cruise', name: 'Antarctica Direct', operator: u.searchParams.get('operator'), region: 'antarctica' },
    ] }) };
  };
  await searchOfferings({ type: 'cruise', brand: 'Ponant', region: 'antarctica' }, { fetchImpl });
  await searchOfferings({ type: 'cruise', brand: 'Nat Geo', region: 'antarctica' }, { fetchImpl });
  await searchOfferings({ type: 'cruise', brand: 'HX', region: 'antarctica' }, { fetchImpl });
  assert.deepEqual(operators, [
    'PONANT EXPLORATIONS',
    'National Geographic-Lindblad Expeditions',
    'HX Expeditions',
  ]);
});

await test('searchOfferings jet normalizes brand aliases (TCS, A&K)', async () => {
  const brands = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    brands.push(u.searchParams.get('brand'));
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: 'jt_1', type: 'jet', name: 'World Tour', brand: u.searchParams.get('brand') },
    ] }) };
  };
  await searchOfferings({ type: 'jet', brand: 'TCS' }, { fetchImpl });
  await searchOfferings({ type: 'jet', brand: 'A&K' }, { fetchImpl });
  assert.deepEqual(brands, ['TCS World Travel', 'Abercrombie & Kent']);
});

await test('searchOfferings retries an unmatched exact brand as free text with a note', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('expedition-cruises')) return emptyOk();
    calls.push({ operator: u.searchParams.get('operator'), q: u.searchParams.get('q') });
    if (u.searchParams.get('operator')) {
      return { ok: true, json: async () => ({ total: 0, count: 0, results: [] }) };
    }
    return { ok: true, json: async () => ({ total: 2, count: 2, results: [
      { id: 'cr_9', type: 'cruise', name: 'Fjords by Mystery Expeditions', operator: 'Mystery Expeditions Co', region: 'norway' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'cruise', brand: 'Mystery Expeditions', region: 'norway' }, { fetchImpl });
  assert.equal(calls[0].operator, 'Mystery Expeditions');
  assert.equal(calls[1].operator, null);
  assert.match(calls[1].q, /Mystery Expeditions/);
  assert.equal(r.count, 1);
});

await test('searchOfferings binds alaska/caribbean as free text on atlases that do not filter them yet', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    assert.equal(u.searchParams.get('region'), null); // Jet backend doesn't filter alaska yet
    assert.match(u.searchParams.get('q'), /alaska/i);
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: 'jt_1', type: 'jet', name: 'Alaska by Private Jet' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'jet', region: 'alaska' }, { fetchImpl });
  assert.equal(r.count, 1);
  assert.equal(r.chartRegion, 'alaska'); // marquee region still charts the map
});

await test('searchOfferings cruise binds non-marquee places and suppresses chart drift', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('expedition-cruises')) return emptyOk();
    seen.push(Object.fromEntries(u.searchParams.entries()));
    assert.match(u.searchParams.get('q'), /alaska/i);
    return { ok: true, json: async () => ({ total: 26, count: 3, results: [
      { id: 'cr_1', type: 'cruise', name: "Alaska's Inside Passage", operator: 'National Geographic-Lindblad Expeditions', region: null, regionLabel: 'Alaska & Yukon' },
      { id: 'cr_2', type: 'cruise', name: 'Alaska Fjords and Canadian Inside Passage', operator: 'Seabourn', region: 'norway', regionLabel: 'Norway, Fjords & Coast' },
      { id: 'cr_3', type: 'cruise', name: "Alaska's Inside Passage - Fjords of The Great Land", operator: 'HX Expeditions', region: 'norway', regionLabel: 'Norway, Fjords & Coast' },
    ], deepLink: 'https://expedition-cruise-map.vercel.app?q=Alaska' }) };
  };
  const r = await searchOfferings({ type: 'cruise', place: 'Alaska', month: 'July' }, { fetchImpl });
  assert.equal(seen[0].month, '2026-07');
  assert.equal(r.count, 3);
  assert.equal(r.chartRegion, 'alaska'); // Alaska is a marquee region now and charts the map
  assert.match(r.deepLink, /ids=/);
});

await test('searchOfferings hotel folds non-marquee regions into the place text', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    assert.equal(u.searchParams.get('region'), null);
    assert.match(u.searchParams.get('q'), /alaska/i);
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: 'h_1', name: 'Sheldon Chalet', adminRegion: 'Alaska', country: 'United States' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'hotel', region: 'Alaska' }, { fetchImpl });
  assert.equal(r.count, 1);
});

await test('searchOfferings hotel filters Caribbean on the region param (the Four Seasons in Caribbean fix)', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    seen.push(Object.fromEntries(u.searchParams.entries()));
    assert.equal(u.searchParams.get('region'), 'caribbean'); // Hotel atlas filters caribbean natively
    return { ok: true, json: async () => ({ total: 5, count: 2, results: [
      { id: 'h_1', name: 'Four Seasons Resort Nevis', brand: 'Four Seasons', country: 'Saint Kitts and Nevis', region: 'caribbean' },
      { id: 'h_2', name: 'Four Seasons Resort Anguilla', brand: 'Four Seasons', country: 'Anguilla', region: 'caribbean' },
    ], deepLink: 'https://luxury-hotel-atlas-two.vercel.app?region=caribbean' }) };
  };
  // Whether the model puts Caribbean in region, place, or country, it must reach
  // the region filter (not a free-text token that matches no single property).
  for (const input of [
    { type: 'hotel', brand: 'Four Seasons', region: 'Caribbean' },
    { type: 'hotel', brand: 'Four Seasons', place: 'Caribbean' },
    { type: 'hotel', brand: 'Four Seasons', country: 'Caribbean' },
  ]) {
    seen.length = 0;
    const r = await searchOfferings(input, { fetchImpl });
    assert.equal(r.count, 2, `cards served for ${JSON.stringify(input)}`);
    assert.equal(r.chartRegion, 'caribbean'); // map refocuses on the Caribbean
    assert.ok(!('q' in seen[0]) || !/caribbean/i.test(seen[0].q || ''),
      'Caribbean is not left as a free-text token');
  }
});

await test('searchOfferings cruise charts Caribbean while binding it as text until the backend filters it', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('expedition-cruises')) return emptyOk();
    assert.equal(u.searchParams.get('region'), null); // Cruise backend doesn't filter caribbean yet
    assert.match(u.searchParams.get('q'), /caribbean/i);
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: 'cr_1', type: 'cruise', name: 'Caribbean Crossing', operator: 'Seabourn' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'cruise', region: 'caribbean' }, { fetchImpl });
  assert.equal(r.count, 1);
  assert.equal(r.chartRegion, 'caribbean');
});

await test('searchOfferings hotel treats island aliases in place as country filters', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    seen.push(Object.fromEntries(u.searchParams.entries()));
    return { ok: true, json: async () => ({ total: 2, count: 2, results: [
      { id: 'h_1', name: 'Sugar Beach', country: u.searchParams.get('country') },
      { id: 'h_2', name: 'Jade Mountain', country: u.searchParams.get('country') },
    ] }) };
  };
  const r = await searchOfferings({ type: 'hotel', place: 'St Lucia', q: 'Beach resorts' }, { fetchImpl });
  assert.equal(seen[0].country, 'saint lucia');
  assert.equal(seen[0].q, 'Beach');
  assert.equal(r.count, 2);
});

await test('searchOfferings hotel finds Turks and St Barts when the model sends place', async () => {
  const countries = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    countries.push(u.searchParams.get('country'));
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: 'h_1', name: 'COMO Parrot Cay', country: u.searchParams.get('country') },
    ] }) };
  };
  await searchOfferings({ type: 'hotel', place: 'Turks & Caicos' }, { fetchImpl });
  await searchOfferings({ type: 'hotel', place: 'St Barts' }, { fetchImpl });
  assert.deepEqual(countries, ['Turks and Caicos', 'Saint Barthélemy']);
});

await test('chartRegionFrom requires a majority, so one mistagged result cannot chart-jump', () => {
  const alaskan = [{ region: 'norway' }, {}, {}, {}, {}, {}];
  assert.equal(chartRegionFrom('', alaskan), null);
  const med = [{ region: 'mediterranean' }, { region: 'mediterranean' }, {}];
  assert.equal(chartRegionFrom('', med), 'mediterranean');
  assert.equal(chartRegionFrom('the med', []), 'mediterranean'); // alias still wins
});

await test('searchOfferings hotel maps landmarks to their city with an honest note', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    assert.equal(u.searchParams.get('q'), 'Paris');
    return { ok: true, json: async () => ({ total: 2, count: 2, results: [
      { id: 'h_1', name: 'Le Meurice', city: 'Paris', country: 'France' },
      { id: 'h_2', name: 'Cheval Blanc Paris', city: 'Paris', country: 'France' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'hotel', place: 'the Louvre' }, { fetchImpl });
  assert.equal(r.count, 2);
  assert.match(r.note, /Louvre/);
  assert.match(r.note, /Paris/);
});

await test('searchOfferings hotel flags a dropped place so typos cannot pass as matches', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    if (u.searchParams.get('q')) {
      return { ok: true, json: async () => ({ total: 0, count: 0, results: [] }) };
    }
    return { ok: true, json: async () => ({ total: 2, count: 2, results: [
      { id: 'h_1', name: 'Villa d\'Este', city: 'Cernobbio', country: 'Italy' },
      { id: 'h_2', name: 'Grand Hotel Tremezzo', city: 'Tremezzo', country: 'Italy' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'hotel', place: 'Lake Komo', country: 'Italy' }, { fetchImpl });
  assert.equal(r.count, 2);
  assert.match(r.note, /Lake Komo/);
  assert.match(r.note, /advisor/i);
});

await test('searchOfferings routes a luxury-cruise ask to advisor even when typed as yacht', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return emptyOk(); };
  const r = await searchOfferings({ type: 'yacht', q: 'luxury cruise', region: 'mediterranean' }, { fetchImpl });
  assert.equal(calls, 0);
  assert.equal(r.advisorOnly, true);
  assert.equal(r.chartRegion, 'mediterranean');
});

await test('searchOfferings does not hijack hotel-brand Regent or descriptive crystal into the cruise guard', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: 'h_1', name: 'Regent Hong Kong', brand: 'Regent', country: 'China' },
    ] }) };
  };
  const regent = await searchOfferings({ type: 'any', brand: 'Regent', place: 'Hong Kong' }, { fetchImpl });
  assert.equal(regent.type, 'hotel');
  assert.equal(regent.advisorOnly, undefined);
  const crystal = await searchOfferings({ type: 'any', q: 'crystal lagoon overwater' }, { fetchImpl });
  assert.equal(crystal.type, 'hotel');
  assert.equal(crystal.advisorOnly, undefined);
});

await test('searchOfferings hotel notes advisor-led categories like safari without blocking inventory', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (!u.pathname.includes('luxury-hotels')) return emptyOk();
    return { ok: true, json: async () => ({ total: 1, count: 1, results: [
      { id: 'h_1', name: 'Singita Sasakwa Lodge', country: 'Tanzania' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'hotel', q: 'safari lodge', country: 'Tanzania' }, { fetchImpl });
  assert.equal(r.count, 1);
  assert.match(r.note, /advisor-led/i);
});

// ── orchestration: mocked Claude tool-use loop ───────────────────────────────
function mockClaude(script) {
  // script: array of message objects to return on each call, in order.
  let i = 0;
  return async () => script[Math.min(i++, script.length - 1)];
}

await test('runGuideTurn executes the tool then returns grounded text', async () => {
  const script = [
    { // turn 1: model decides to call the tool
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'tu_1', name: 'search_offerings', input: { type: 'hotel', brand: 'Aman', region: 'japan', limit: 3 } },
      ],
    },
    { // turn 2: model writes the reply from the tool result
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Three Aman stays anchor Japan. [[CHART: japan]]' }],
    },
  ];
  const out = await runGuideTurn({
    messages: [{ role: 'user', content: 'Aman in Japan' }],
    callModel: mockClaude(script),
    search: localSearch,
  });
  assert.equal(out.stopReason, 'end_turn');
  assert.match(out.text, /Aman/);
  assert.equal(out.toolMeta.length, 1);
  assert.equal(out.toolMeta[0].name, 'search_offerings');
  assert.ok(out.toolMeta[0].result.results.length > 0); // real data flowed through
  const meta = summarizeMeta(out.toolMeta);
  assert.equal(meta.chartRegion, 'japan');
  assert.ok(meta.deepLink.includes('region=japan'));
});

await test('runGuideTurn passes correct tool_result back to the model', async () => {
  let secondCallMessages = null;
  const callModel = async ({ messages }) => {
    if (!secondCallMessages && messages.length === 1) {
      return { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 'tu_x', name: 'search_offerings', input: { type: 'hotel', region: 'japan', limit: 2 } }] };
    }
    secondCallMessages = messages;
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] };
  };
  await runGuideTurn({
    messages: [{ role: 'user', content: 'japan hotels' }],
    callModel,
    search: localSearch,
  });
  // conversation should now be: user, assistant(tool_use), user(tool_result)
  assert.equal(secondCallMessages.length, 3);
  assert.equal(secondCallMessages[1].role, 'assistant');
  const tr = secondCallMessages[2].content[0];
  assert.equal(tr.type, 'tool_result');
  assert.equal(tr.tool_use_id, 'tu_x');
  const parsed = JSON.parse(tr.content);
  assert.equal(parsed.type, 'hotel');
  assert.ok(parsed.results.length > 0);
});

await test('runGuideTurn gives mentioned place to broad hotel tool calls', async () => {
  let searchInput = null;
  const callModel = mockClaude([
    { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'tu_place', name: 'search_offerings',
        input: { type: 'hotel', country: 'United States', limit: 3 } },
    ] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Aspen stays only.' }] },
  ]);
  const search = async (input) => {
    searchInput = input;
    return { type: 'hotel', total: 1, count: 1, results: [
      { id: 'h_1', name: 'The Little Nell', city: 'Aspen', country: 'United States' },
    ], deepLink: 'https://luxury-hotel-atlas-two.vercel.app?q=Aspen' };
  };
  const out = await runGuideTurn({
    messages: [{ role: 'user', content: 'whats the nicest hotel in aspen' }],
    callModel,
    search,
  });
  assert.equal(searchInput.place, 'Aspen');
  assert.equal(out.toolMeta[0].input.place, 'Aspen');
  assert.equal(out.toolMeta[0].result.results[0].city, 'Aspen');
});

await test('runGuideTurn reroutes mistaken any search when user says cruises', async () => {
  let searchInput = null;
  const callModel = mockClaude([
    { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'tu_cruise', name: 'search_offerings',
        input: { type: 'any', brand: 'Ritz Carlton', limit: 5 } },
    ] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ritz-Carlton yacht sailings are in play.' }] },
  ]);
  const search = async (input) => {
    searchInput = input;
    return { type: 'cruise', total: 188, count: 1, results: [
      { id: 'yc_1', type: 'yacht', name: 'Tokyo to Incheon', brand: 'Ritz-Carlton Yacht Collection' },
    ], deepLink: 'https://luxury-hotel-brand-yacht-atlas.vercel.app?brand=Ritz-Carlton+Yacht+Collection' };
  };
  await runGuideTurn({
    messages: [{ role: 'user', content: 'show me Ritz Carlton cruises' }],
    callModel,
    search,
  });
  assert.equal(searchInput.type, 'cruise');
  assert.equal(searchInput.brand, 'Ritz Carlton');
});

await test('runGuideTurn no-tool path returns text directly', async () => {
  const out = await runGuideTurn({
    messages: [{ role: 'user', content: 'hello' }],
    callModel: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Where to, and roughly when?' }] }),
  });
  assert.equal(out.toolMeta.length, 0);
  assert.match(out.text, /Where to/);
});

console.log(`\n${passed} tests passed`);

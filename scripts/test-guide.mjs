// scripts/test-guide.mjs — Base Camp T6 tests
// Run: node scripts/test-guide.mjs
//  1. search_offerings against the LIVE Hotel Atlas API (integration).
//  2. runGuideTurn tool-loop with a MOCKED Claude caller (no API key needed).

import assert from 'node:assert/strict';
import {
  searchOfferings,
  chartRegionFrom,
  clampLimit,
  normalizeMonth,
  prioritizeMentionedPlace,
  SEARCH_OFFERINGS_TOOL,
} from '../lib/search-offerings.js';
import { runGuideTurn, summarizeMeta } from '../api/guide.js';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok  ' + name); }

// ── unit: helpers ────────────────────────────────────────────────────────────
await test('tool schema shape (Anthropic input_schema)', () => {
  assert.equal(SEARCH_OFFERINGS_TOOL.name, 'search_offerings');
  assert.deepEqual(SEARCH_OFFERINGS_TOOL.input_schema.properties.type.enum,
    ['hotel', 'cruise', 'jet', 'yacht', 'any']);
});

await test('clampLimit falls back to the request and caps at the tight display limit', () => {
  assert.equal(clampLimit(undefined, 3), 3);
  assert.equal(clampLimit(0, 3), 3);
  assert.equal(clampLimit(100, 3), 4);        // capped at MAX_DISPLAY_LIMIT
  assert.equal(clampLimit(3, 3), 3);
  assert.equal(clampLimit(100, 3, 24), 24);   // explicit higher ceiling (around-the-world jets)
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

// ── integration: live hotel search ───────────────────────────────────────────
await test('searchOfferings hotel: Aman in Japan returns real records + deepLink', async () => {
  const r = await searchOfferings({ type: 'hotel', brand: 'Aman', region: 'japan', limit: 3 });
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
  const r = await searchOfferings({ type: 'hotel', country: 'Italy', limit: 3 });
  assert.ok(r.total > r.count);   // total is unpaginated
  assert.equal(r.count, r.results.length);
});

await test('searchOfferings type=any defaults to hotels', async () => {
  const r = await searchOfferings({ type: 'any', q: 'aman', limit: 2 });
  assert.equal(r.type, 'hotel');
  assert.equal(r.results.length, 2);
});

await test('searchOfferings hotel treats bare month text as a date, not q', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    assert.equal(u.searchParams.get('month'), '2026-08');
    assert.equal(u.searchParams.get('q'), null);
    assert.equal(u.searchParams.get('country'), 'Italy');
    assert.equal(u.searchParams.get('limit'), '24'); // broad ranking pool; the shown list is capped separately
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
  assert.equal(r.count, 3); // curated down from the broad pool to the tight display cap
});

await test('searchOfferings hotel gives a named place priority over broad country', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    assert.equal(u.searchParams.get('country'), 'United States');
    assert.equal(u.searchParams.get('q'), 'Aspen');
    assert.equal(u.searchParams.get('limit'), '24'); // broad ranking pool
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

await test('searchOfferings yacht normalizes Ritz-Carlton brand aliases', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    assert.ok(url.includes('/api/yacht-sailings?'));
    assert.equal(u.searchParams.get('brand'), 'Ritz-Carlton Yacht Collection');
    assert.equal(u.searchParams.get('limit'), '4'); // brand-constrained pool, capped at the display max
    return { ok: true, json: async () => ({ total: 188, count: 5, results: [
      { id: 'yc_1', type: 'yacht', name: 'Tokyo to Incheon', brand: 'Ritz-Carlton Yacht Collection', region: 'japan' },
    ] }) };
  };
  const r = await searchOfferings({ type: 'yacht', brand: 'Ritz Carlton', limit: 5 }, { fetchImpl });
  assert.equal(r.type, 'yacht');
  assert.equal(r.total, 188);
  assert.equal(r.results[0].brand, 'Ritz-Carlton Yacht Collection');
});

await test('searchOfferings caps an over-large caller limit to the tight display max', async () => {
  const fetchImpl = async (url) => {
    assert.match(url, /limit=24\b/); // pulls a broad pool to rank from
    return { ok: true, json: async () => ({ total: 12, count: 8, results: [
      { id: 'jt_1', type: 'jet', name: 'One', region: 'japan' },
      { id: 'jt_2', type: 'jet', name: 'Two', region: 'japan' },
      { id: 'jt_3', type: 'jet', name: 'Three', region: 'japan' },
      { id: 'jt_4', type: 'jet', name: 'Four', region: 'japan' },
      { id: 'jt_5', type: 'jet', name: 'Five', region: 'japan' },
      { id: 'jt_6', type: 'jet', name: 'Six', region: 'japan' },
      { id: 'jt_7', type: 'jet', name: 'Seven', region: 'japan' },
      { id: 'jt_8', type: 'jet', name: 'Eight', region: 'japan' },
    ] }) };
  };
  // A bare larger limit (no explicit "more" request) stays capped at four.
  const r = await searchOfferings({ type: 'jet', region: 'japan', limit: 8 }, { fetchImpl });
  assert.equal(r.count, 4);
  assert.equal(r.results.length, 4);
});

await test('searchOfferings lifts the cap when the traveler explicitly asks for more', async () => {
  const jets = Array.from({ length: 8 }, (_, i) => ({ id: 'jt_' + i, type: 'jet', name: 'J' + i, region: 'japan' }));
  // Explicit more=true with a larger limit returns the requested count, not four.
  const withLimit = async (url) => {
    assert.match(url, /limit=8\b/);
    return { ok: true, json: async () => ({ total: 12, count: 8, results: jets }) };
  };
  const r1 = await searchOfferings({ type: 'jet', region: 'japan', more: true, limit: 8 }, { fetchImpl: withLimit });
  assert.equal(r1.count, 8);
  assert.equal(r1.results.length, 8);

  // more=true with no limit returns the full matching set (capped at 24).
  const full = async () => ({ ok: true, json: async () => ({ total: 12, count: 8, results: jets }) });
  const r2 = await searchOfferings({ type: 'jet', region: 'japan', more: true }, { fetchImpl: full });
  assert.equal(r2.count, 8);
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
  const out = await runGuideTurn({ messages: [{ role: 'user', content: 'Aman in Japan' }], callModel: mockClaude(script) });
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
  await runGuideTurn({ messages: [{ role: 'user', content: 'japan hotels' }], callModel });
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

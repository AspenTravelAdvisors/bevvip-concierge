// scripts/test-guide.mjs — Base Camp T6 tests
// Run: node scripts/test-guide.mjs
//  1. search_offerings against the LIVE Hotel Atlas API (integration).
//  2. runGuideTurn tool-loop with a MOCKED Claude caller (no API key needed).

import assert from 'node:assert/strict';
import { searchOfferings, chartRegionFrom, clampLimit, SEARCH_OFFERINGS_TOOL } from '../lib/search-offerings.js';
import { runGuideTurn, summarizeMeta } from '../api/guide.js';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok  ' + name); }

// ── unit: helpers ────────────────────────────────────────────────────────────
await test('tool schema shape (Anthropic input_schema)', () => {
  assert.equal(SEARCH_OFFERINGS_TOOL.name, 'search_offerings');
  assert.deepEqual(SEARCH_OFFERINGS_TOOL.input_schema.properties.type.enum,
    ['hotel', 'cruise', 'jet', 'yacht', 'any']);
});

await test('clampLimit default 6, capped', () => {
  assert.equal(clampLimit(undefined, 6), 6);
  assert.equal(clampLimit(0, 6), 6);
  assert.equal(clampLimit(100, 6), 24);
  assert.equal(clampLimit(3, 6), 3);
});

await test('chartRegionFrom prefers explicit marquee key', () => {
  assert.equal(chartRegionFrom('japan', []), 'japan');
  assert.equal(chartRegionFrom('New York', []), null); // not a marquee key
  assert.equal(chartRegionFrom('', [{ region: 'mediterranean' }, { region: 'mediterranean' }, { region: 'japan' }]),
    'mediterranean');
});

// ── integration: live hotel search ───────────────────────────────────────────
await test('searchOfferings hotel: Aman in Japan returns real records + deepLink', async () => {
  const r = await searchOfferings({ type: 'hotel', brand: 'Aman', region: 'japan', limit: 3 });
  assert.equal(r.type, 'hotel');
  assert.ok(r.total >= 3);
  assert.ok(r.results.length >= 1);
  assert.ok(r.results.every((h) => h.brand === 'Aman' && h.region === 'japan'));
  assert.ok(r.results[0].name && r.results[0].bookUrl);
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
  assert.ok(r.results.length > 0);
});

await test('searchOfferings cruise returns live inventory + marquee region', async () => {
  const r = await searchOfferings({ type: 'cruise', region: 'antarctica', limit: 3 });
  assert.equal(r.type, 'cruise');
  assert.ok(r.total > r.count);                 // honest unpaginated count
  assert.equal(r.count, r.results.length);
  assert.ok(r.results.length >= 1);
  assert.ok(r.results.every((x) => x.region === 'antarctica'));
  assert.ok(r.results[0].name && r.results[0].bookUrl);
  assert.equal(r.chartRegion, 'antarctica');
});

await test('searchOfferings jet + yacht return live inventory', async () => {
  const j = await searchOfferings({ type: 'jet', region: 'japan', limit: 2 });
  assert.equal(j.type, 'jet');
  assert.ok(j.results.length >= 1 && j.results[0].name && j.results[0].bookUrl);

  const y = await searchOfferings({ type: 'yacht', region: 'mediterranean', limit: 2 });
  assert.equal(y.type, 'yacht');
  assert.ok(y.results.length >= 1 && y.results[0].name && y.results[0].bookUrl);
  assert.equal(y.chartRegion, 'mediterranean');
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

await test('runGuideTurn no-tool path returns text directly', async () => {
  const out = await runGuideTurn({
    messages: [{ role: 'user', content: 'hello' }],
    callModel: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Where to, and roughly when?' }] }),
  });
  assert.equal(out.toolMeta.length, 0);
  assert.match(out.text, /Where to/);
});

console.log(`\n${passed} tests passed`);

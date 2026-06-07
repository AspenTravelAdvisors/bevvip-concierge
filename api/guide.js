// api/guide.js — Base Camp "The Guide" endpoint (Claude tool-use)
// New Base Camp surface. Does NOT replace the standalone app (api/chat.js); both
// are preserved. The Guide runs a Claude tool-use loop: the model calls
// search_offerings, we execute it against the live data layer, feed the real
// results back, and stream the grounded reply plus map metadata to the client.
//
// Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL (optional),
//      HOTEL_ATLAS_API_BASE (optional; see lib/search-offerings.js).

import { GUIDE_PROMPT } from './guide-prompt.js';
import { SEARCH_OFFERINGS_TOOL, searchOfferings } from '../lib/search-offerings.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;
const MAX_TOOL_ROUNDS = 4;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// ── Core loop (exported for tests) ──────────────────────────────────────────
// callModel({system, messages, tools}) -> resolved Anthropic message object.
// search(input) -> tool result. Returns { text, toolMeta, stopReason }.
export async function runGuideTurn({ messages, callModel, search = searchOfferings }) {
  const convo = (messages || []).map((m) => ({ role: m.role, content: m.content }));
  const toolMeta = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callModel({
      system: GUIDE_PROMPT,
      messages: convo,
      tools: [SEARCH_OFFERINGS_TOOL],
    });

    if (data.stop_reason === 'tool_use') {
      const toolUses = (data.content || []).filter((c) => c.type === 'tool_use');
      convo.push({ role: 'assistant', content: data.content });

      const toolResults = [];
      for (const tu of toolUses) {
        let result;
        try {
          result = tu.name === 'search_offerings'
            ? await search(tu.input || {})
            : { error: `unknown tool ${tu.name}` };
        } catch (e) {
          result = { error: String((e && e.message) || e) };
        }
        toolMeta.push({ name: tu.name, input: tu.input, result });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      convo.push({ role: 'user', content: toolResults });
      continue;
    }

    const text = (data.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('')
      .trim();
    return { text, toolMeta, stopReason: data.stop_reason || 'end_turn' };
  }

  return { text: '', toolMeta, stopReason: 'max_tool_rounds' };
}

// Bubble up the most relevant Atlas handoff for the client (map plot + button).
export function summarizeMeta(toolMeta) {
  const tools = toolMeta.map((t) => ({
    input: t.input,
    type: t.result && t.result.type,
    total: t.result && t.result.total,
    count: t.result && t.result.count,
    deepLink: t.result && t.result.deepLink,
    chartRegion: t.result && t.result.chartRegion,
    unavailable: !!(t.result && t.result.unavailable),
    results: (t.result && t.result.results) || [],
  }));
  // Prefer the last tool call that actually returned inventory.
  const lead = [...tools].reverse().find((t) => t.count > 0) || tools[tools.length - 1] || null;
  return {
    deepLink: lead ? lead.deepLink : null,
    chartRegion: lead ? lead.chartRegion : null,
    tools,
  };
}

// ── HTTP handler (SSE) ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages format' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Claude API key not configured. Set ANTHROPIC_API_KEY in Vercel environment variables.',
    });
  }

  const callModel = makeAnthropicCaller(process.env.ANTHROPIC_API_KEY);

  // SSE stream: one meta frame (deepLink/chartRegion/results), then text deltas.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const { text, toolMeta, stopReason } = await runGuideTurn({ messages, callModel });
    send({ type: 'meta', ...summarizeMeta(toolMeta), stopReason });
    for (const chunk of chunkText(text)) send({ type: 'delta', text: chunk });
    send({ type: 'done' });
  } catch (err) {
    console.error('Guide error:', err);
    send({ type: 'error', error: String((err && err.message) || err) });
  } finally {
    res.end();
  }
}

function makeAnthropicCaller(apiKey) {
  return async ({ system, messages, tools }) => {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages, tools }),
    });
    if (!r.ok) {
      const t = await r.text();
      const err = new Error(`anthropic ${r.status}: ${t}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  };
}

// Stream in small word-groups for a natural typing feel.
function chunkText(text, words = 6) {
  if (!text) return [];
  const parts = text.split(/(\s+)/); // keep whitespace tokens
  const out = [];
  let buf = '';
  let count = 0;
  for (const p of parts) {
    buf += p;
    if (/\S/.test(p)) count++;
    if (count >= words) { out.push(buf); buf = ''; count = 0; }
  }
  if (buf) out.push(buf);
  return out;
}

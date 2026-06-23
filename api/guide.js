// api/guide.js — Base Camp "The Guide" endpoint (Claude tool-use)
// The Guide runs a Claude tool-use loop: the model calls search_offerings, we
// execute it against the live data layer, feed the real results back, and stream
// the grounded reply plus map metadata to the client.
//
// Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL (optional),
//      HOTEL_ATLAS_API_BASE (optional; see lib/search-offerings.js).

import { GUIDE_PROMPT } from './guide-prompt.js';
import {
  SEARCH_OFFERINGS_TOOL,
  luxuryCruiseAdvisorIntent,
  prioritizeMentionedPlace,
  searchOfferings,
} from '../lib/search-offerings.js';
import { handleCors } from '../lib/guide-cors.js';
import { isRateLimited } from '../lib/guide-rate-limit.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;
const MAX_TOOL_ROUNDS = 4;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// Abort the model call if it produces nothing for this long. Without it a stalled
// upstream blocks until Vercel's maxDuration terminates the function, dropping the
// SSE stream so the browser only sees an opaque "Load failed".
const ANTHROPIC_IDLE_TIMEOUT_MS = Number(process.env.ANTHROPIC_IDLE_TIMEOUT_MS) || 30000;
// Heartbeat comment cadence: keeps the SSE connection alive through proxies during
// the gaps between rounds (model latency, atlas tool calls) so it is not dropped.
const SSE_HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS) || 10000;
// How many times to retry a transient Anthropic overload/rate-limit before giving up.
const GUIDE_MODEL_ATTEMPTS = Number(process.env.GUIDE_MODEL_ATTEMPTS) || 4;

// ── Core loop (exported for tests) ──────────────────────────────────────────
// callModel({system, messages, tools}) -> resolved Anthropic message object.
// search(input) -> tool result. Returns { text, toolMeta, stopReason }.
export async function runGuideTurn({ messages, callModel, search = searchOfferings }) {
  const convo = (messages || []).map((m) => ({ role: m.role, content: m.content }));
  const toolMeta = [];
  const latestUserText = latestUserContent(messages);

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
          const input = tu.name === 'search_offerings'
            ? prioritizeMentionedPlace(tu.input || {}, latestUserText)
            : (tu.input || {});
          result = tu.name === 'search_offerings'
            ? await search(input)
            : { error: `unknown tool ${tu.name}` };
          tu.input = input;
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

async function runGuideTurnStream({
  messages,
  callModelStream,
  search = searchOfferings,
  send = () => {},
}) {
  const convo = (messages || []).map((m) => ({ role: m.role, content: m.content }));
  const toolMeta = [];
  const latestUserText = latestUserContent(messages);
  let text = '';

  send({ type: 'status', text: 'Reading your trip style...' });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callModelStream({
      system: GUIDE_PROMPT,
      messages: convo,
      tools: [SEARCH_OFFERINGS_TOOL],
      send,
      onText: (delta) => {
        text += delta;
        send({ type: 'delta', text: delta });
      },
    });

    if (data.stop_reason === 'tool_use') {
      const toolUses = (data.content || []).filter((c) => c.type === 'tool_use');
      convo.push({ role: 'assistant', content: data.content });

      if (toolUses.length) {
        send({ type: 'status', text: statusForToolUses(toolUses) });
      }

      const toolResults = [];
      for (const tu of toolUses) {
        let result;
        try {
          const input = tu.name === 'search_offerings'
            ? prioritizeMentionedPlace(tu.input || {}, latestUserText)
            : (tu.input || {});
          result = tu.name === 'search_offerings'
            ? await search(input)
            : { error: `unknown tool ${tu.name}` };
          tu.input = input;
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

      send({ type: 'status', text: 'Narrowing the strongest fit...' });
      convo.push({ role: 'user', content: toolResults });
      continue;
    }

    return { text: text.trim(), toolMeta, stopReason: data.stop_reason || 'end_turn' };
  }

  return { text: text.trim(), toolMeta, stopReason: 'max_tool_rounds' };
}

function statusForToolUses(toolUses = []) {
  const input = toolUses.find((tu) => tu.name === 'search_offerings')?.input || {};
  const type = String(input.type || 'any').toLowerCase();
  if ((type === 'cruise' || type === 'yacht' || type === 'any') && luxuryCruiseAdvisorIntent(input, type)) {
    return 'Routing the Luxury Cruise request to an advisor...';
  }
  if (type === 'cruise') return 'Checking approved Expedition Cruise and yacht inventory...';
  if (type === 'jet') return 'Checking private jet journey inventory...';
  if (type === 'yacht') return 'Checking hotel-brand yacht sailings...';
  return 'Checking approved hotel inventory...';
}

function latestUserContent(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((c) => c && c.type === 'text')
        .map((c) => c.text || '')
        .join(' ')
        .trim();
    }
  }
  return '';
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
    sources: (t.result && t.result.sources) || null,
    results: (t.result && t.result.results) || [],
    related: (t.result && t.result.related) || null,
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
  // CORS: reflect only allowlisted origins and answer the OPTIONS preflight.
  // Every legitimate caller is same-origin; see lib/guide-cors.js.
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Best-effort per-IP throttle so a single client can't drain the quota.
  if (isRateLimited(req, res)) return;

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages format' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Claude API key not configured. Set ANTHROPIC_API_KEY in Vercel environment variables.',
    });
  }

  const callModelStream = makeAnthropicStreamCaller(process.env.ANTHROPIC_API_KEY);

  // SSE stream: one meta frame (deepLink/chartRegion/results), then text deltas.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  // Comment-only frames (": ...") are ignored by the client's SSE parser but keep
  // the connection warm across the gaps between rounds, where intermediaries would
  // otherwise time out an idle stream.
  const heartbeat = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch { /* connection already closed */ }
  }, SSE_HEARTBEAT_MS);

  try {
    const { toolMeta, stopReason } = await runGuideTurnStream({
      messages,
      callModelStream,
      send,
    });
    send({ type: 'meta', ...summarizeMeta(toolMeta), stopReason });
    send({ type: 'done' });
  } catch (err) {
    console.error('Guide error:', err);
    send({ type: 'error', error: String((err && err.message) || err) });
  } finally {
    clearInterval(heartbeat);
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

// Returns true for Anthropic errors that are transient and safe to retry.
function isRetryable(err) {
  const s = err && err.status;
  const msg = String((err && err.message) || '');
  return s === 529 || s === 429 || (s >= 500 && s !== 501)
    || /overloaded_error|rate_limit_error/i.test(msg);
}

// Converts a raw Anthropic error into a traveler-friendly message.
// Never leaks provider JSON or HTTP status codes.
function friendlyModelError(err) {
  if (isRetryable(err)) {
    return new Error('The Guide is in high demand right now — please try again in a moment.');
  }
  if (err && err.status === 401) {
    return new Error('API key issue — please contact Book@BeVvip.com.');
  }
  const plain = String((err && err.message) || err || 'Unknown error')
    .replace(/\{[\s\S]*\}/, '')   // strip raw JSON blobs
    .replace(/^anthropic \d+:\s*/i, '')
    .trim();
  return new Error(plain || 'The Guide could not complete that reply. Please try again.');
}

function makeAnthropicStreamCaller(apiKey) {
  return async ({ system, messages, tools, onText, send = () => {} }) => {
    let lastErr;
    for (let attempt = 0; attempt < GUIDE_MODEL_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        // Exponential backoff with jitter: 1s, 2s, 4s …
        const delay = (Math.pow(2, attempt - 1) * 1000) + Math.random() * 400;
        send({ type: 'status', text: 'The Guide is in high demand — retrying…' });
        await new Promise((r) => setTimeout(r, delay));
      }
      const controller = new AbortController();
      let idleTimer;
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), ANTHROPIC_IDLE_TIMEOUT_MS);
      };
      resetIdle();
      try {
        const r = await fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages, tools, stream: true }),
          signal: controller.signal,
        });
        if (!r.ok) {
          const t = await r.text();
          const err = new Error(`anthropic ${r.status}: ${t}`);
          err.status = r.status;
          if (isRetryable(err) && attempt < GUIDE_MODEL_ATTEMPTS - 1) {
            lastErr = err;
            continue;
          }
          throw friendlyModelError(err);
        }
        return await readAnthropicStream(r.body, onText, resetIdle);
      } catch (err) {
        if (controller.signal.aborted) {
          throw new Error('The model stalled and the request timed out. Please try again.');
        }
        if (isRetryable(err) && attempt < GUIDE_MODEL_ATTEMPTS - 1) {
          lastErr = err;
          continue;
        }
        throw friendlyModelError(err);
      } finally {
        clearTimeout(idleTimer);
      }
    }
    throw friendlyModelError(lastErr);
  };
}

async function readAnthropicStream(body, onText = () => {}, onActivity = () => {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const content = [];
  let stopReason = null;
  let buf = '';

  const handle = (evt) => {
    if (!evt || !evt.type) return;

    if (evt.type === 'content_block_start') {
      const block = evt.content_block || {};
      content[evt.index] = block.type === 'tool_use'
        ? { type: 'tool_use', id: block.id, name: block.name, input: block.input || {}, inputJson: '' }
        : { type: block.type || 'text', text: block.text || '' };
    }

    if (evt.type === 'content_block_delta') {
      const block = content[evt.index] || { type: 'text', text: '' };
      content[evt.index] = block;
      if (evt.delta?.type === 'text_delta') {
        block.text = (block.text || '') + (evt.delta.text || '');
        if (evt.delta.text) onText(evt.delta.text);
      }
      if (evt.delta?.type === 'input_json_delta') {
        block.inputJson = (block.inputJson || '') + (evt.delta.partial_json || '');
      }
    }

    if (evt.type === 'content_block_stop') {
      const block = content[evt.index];
      if (block?.type === 'tool_use') {
        try {
          block.input = block.inputJson ? JSON.parse(block.inputJson) : (block.input || {});
        } catch {
          block.input = block.input || {};
        }
        delete block.inputJson;
      }
    }

    if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
      stopReason = evt.delta.stop_reason;
    }
    if (evt.type === 'error') {
      throw new Error(evt.error?.message || evt.error?.type || 'anthropic stream error');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() || '';
    for (const frame of frames) {
      const evt = parseAnthropicFrame(frame);
      handle(evt);
    }
  }

  if (buf.trim()) {
    handle(parseAnthropicFrame(buf));
  }

  return {
    stop_reason: stopReason || 'end_turn',
    content: content.filter(Boolean),
  };
}

function parseAnthropicFrame(frame) {
  const data = String(frame || '')
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  return JSON.parse(data);
}

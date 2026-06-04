// BeVvip Luxury Travel Concierge  —  OpenAI Streaming Proxy
// Deployed as a Vercel Serverless Function.
// Set OPENAI_API_KEY in your Vercel project environment variables.
//
// To update AI behavior, brand rules, or knowledge — edit api/prompt.js, not this file.

import { SYSTEM_PROMPT } from './prompt.js';

// ── MODEL CONFIG ─────────────────────────────────────────────
// gpt-5.5 is OpenAI's flagship (Apr 2026): 1M context, strongest
// instruction-following + spelling accuracy — the fix for prior typos.
// Override with OPENAI_MODEL in Vercel env without touching code.
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const MAX_OUTPUT_TOKENS = 12000;
const TEMPERATURE = 0.15; // low = deterministic spelling; auto-dropped if unsupported

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export default async function handler(req, res) {
  // ── CORS preflight ──
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

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: 'OpenAI API key not configured. Set OPENAI_API_KEY in Vercel environment variables.',
    });
  }

  const payload = {
    model: MODEL,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    stream: true,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    temperature: TEMPERATURE,
  };

  // ── Request with graceful fallback ──
  // Some flagship models reject a custom temperature; one model line still
  // expects the legacy `max_tokens`. Detect those 400s and retry once, cleanly,
  // so a parameter mismatch never surfaces to the traveler as an error.
  let openAIResponse;
  try {
    openAIResponse = await callOpenAI(payload);

    if (!openAIResponse.ok && openAIResponse.status === 400) {
      const errText = await openAIResponse.text();
      const retry = { ...payload };
      let shouldRetry = false;

      if (/temperature/i.test(errText)) { delete retry.temperature; shouldRetry = true; }
      if (/max_completion_tokens|max_tokens/i.test(errText)) {
        delete retry.max_completion_tokens;
        retry.max_tokens = MAX_OUTPUT_TOKENS;
        shouldRetry = true;
      }
      if (shouldRetry) {
        openAIResponse = await callOpenAI(retry);
      } else {
        console.error('OpenAI 400:', errText);
        return res.status(400).json({ error: errText });
      }
    }
  } catch (fetchError) {
    console.error('Fetch error:', fetchError);
    return res.status(502).json({ error: 'Failed to connect to OpenAI' });
  }

  if (!openAIResponse.ok) {
    const errorText = await openAIResponse.text();
    console.error('OpenAI error:', errorText);
    return res.status(openAIResponse.status).json({ error: errorText });
  }

  // ── Stream response back to client ──
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const reader = openAIResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value)); // forward raw SSE bytes
    }
  } catch (streamError) {
    console.error('Stream error:', streamError);
  } finally {
    res.end();
  }
}

function callOpenAI(body) {
  return fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

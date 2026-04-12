// BeVvip Luxury Travel Concierge  -  OpenAI Streaming Proxy
// Deployed as a Vercel Serverless Function
// Set OPENAI_API_KEY in your Vercel project environment variables
//
// To update AI behavior, brand rules, or knowledge — edit api/prompt.js, not this file.

import { SYSTEM_PROMPT } from './prompt.js';

export default async function handler(req, res) {
  // Handle CORS preflight
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

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages format' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured. Set OPENAI_API_KEY in Vercel environment variables.' });
  }

  let openAIResponse;
  try {
    openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages,
        ],
        stream: true,
        max_tokens: 10000,
        temperature: 0.1,
      }),
    });
  } catch (fetchError) {
    console.error('Fetch error:', fetchError);
    return res.status(502).json({ error: 'Failed to connect to OpenAI' });
  }

  if (!openAIResponse.ok) {
    const errorText = await openAIResponse.text();
    console.error('OpenAI error:', errorText);
    return res.status(openAIResponse.status).json({ error: errorText });
  }

  // Stream response back to client
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
      res.write(Buffer.from(value)); // forward raw bytes
    }
  } catch (streamError) {
    console.error('Stream error:', streamError);
  } finally {
    res.end();
  }
}

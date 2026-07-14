// lib/location-resolver.js — AI fringe-location resolver
//
// The atlases index inventory by exact city / country / marquee-region names.
// Travelers, though, name places colloquially: "the French Riviera", "the
// Amalfi Coast", "Napa", "the Cotswolds". None of those strings appear on a
// hotel record, so a literal `q` search zeroes out — the classic fringe-request
// miss. Rather than hand-maintaining an ever-growing alias table (see
// REGION_ALIASES / COUNTRY_ALIASES in search-offerings.js), we let the model do
// what it already knows: decompose a colloquial area into the concrete country,
// constituent cities, an approximate bounding box, and (when it maps to one) a
// marquee region. The hotel atlas then matches on geography instead of spelling.
//
// Resolution is layered, cheapest first:
//   1. an in-process Map cache (per warm lambda),
//   2. a committed seed file (data/fringe-locations.json) — works with no API
//      key and documents the shape,
//   3. a single cheap Haiku call, forced to structured JSON via a tool.
//
// A resolved entry is memoized in-process and best-effort appended to the seed
// file. In a read-only serverless filesystem that append silently no-ops (the
// in-process cache still saves repeat calls within a warm instance); locally it
// grows the committed seed so the table maintains itself from real traffic
// instead of by hand. Every failure path returns null so the caller falls back
// to its existing honest "nothing matched that name" behavior.

import SEED from "../data/fringe-locations.json" with { type: "json" };

// Cheap, fast model for a narrow structured lookup. Overridable for tuning.
const RESOLVER_MODEL = process.env.LOCATION_RESOLVER_MODEL || "claude-haiku-4-5-20251001";

// Normalize a place phrase to a stable cache key: fold diacritics, lowercase,
// strip punctuation and a leading "the", collapse whitespace.
function keyFor(raw) {
  return String(raw == null ? "" : raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

// In-process cache, seeded from the committed file (normalized keys).
const CACHE = new Map();
for (const [k, v] of Object.entries(SEED || {})) CACHE.set(keyFor(k), v);

// Reject an area too broad to be a "fringe" place: a bare country or continent
// is already a first-class filter, so resolving it adds nothing and a huge bbox
// would only broaden the search. These never reach the model.
const TOO_BROAD = new Set([
  "usa", "us", "united states", "america", "canada", "mexico", "france",
  "italy", "spain", "portugal", "greece", "japan", "australia", "england",
  "uk", "united kingdom", "germany", "switzerland", "europe", "asia",
  "africa", "south america", "north america", "caribbean", "mediterranean",
]);

// The SDK is imported lazily so the seed/cache path carries no dependency on it
// and warm instances only pay the load cost once a real cache-miss needs the
// model. Returns null when no key is configured (seed-only mode).
let clientPromise = null;
async function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!clientPromise) {
    clientPromise = import("@anthropic-ai/sdk").then((m) => new m.default());
  }
  return clientPromise;
}

const RESOLVE_TOOL = {
  name: "report_location",
  description:
    "Report the concrete geography a colloquial or sub-national travel area covers, " +
    "so a hotel inventory indexed by city and country can be matched by location.",
  input_schema: {
    type: "object",
    properties: {
      known: {
        type: "boolean",
        description: "True only if this is a real, identifiable travel area you can place confidently.",
      },
      label: { type: "string", description: "Natural display name, e.g. \"the French Riviera\"." },
      country: {
        type: "string",
        description: "The single country the area sits in, spelled in full (e.g. France, Italy, United States). Empty if it spans several.",
      },
      region: {
        type: "string",
        description:
          "One marquee key if the area clearly maps to one, else empty. Keys: antarctica, arctic, " +
          "galapagos, amazon, polynesia, patagonia, kimberley, mediterranean, norway, japan, namibia, " +
          "alaska, caribbean, northwest passage.",
      },
      places: {
        type: "array",
        items: { type: "string" },
        description: "3-8 concrete cities/towns a luxury hotel there would be filed under, most notable first.",
      },
      bbox: {
        type: "array",
        items: { type: "number" },
        description: "Approximate bounding box [minLng, minLat, maxLng, maxLat] tight around the area.",
      },
    },
    required: ["known"],
  },
};

const MARQUEE = new Set([
  "antarctica", "arctic", "galapagos", "amazon", "polynesia", "patagonia",
  "kimberley", "mediterranean", "norway", "japan", "namibia", "alaska",
  "caribbean", "northwest passage",
]);

// Coerce the model's tool input into a clean resolution or null.
function sanitize(raw) {
  if (!raw || raw.known !== true) return null;
  const out = {};
  out.label = String(raw.label || "").trim() || null;
  out.country = String(raw.country || "").trim() || null;
  const region = String(raw.region || "").trim().toLowerCase();
  out.region = MARQUEE.has(region) ? region : null;
  out.places = Array.isArray(raw.places)
    ? raw.places.map((p) => String(p || "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const b = Array.isArray(raw.bbox) ? raw.bbox.map(Number) : [];
  out.bbox = b.length === 4 && b.every(Number.isFinite) &&
    b[0] < b[2] && b[1] < b[3] ? b : null;
  // A resolution with neither cities, a box, nor a country is unusable.
  if (!out.places.length && !out.bbox && !out.country && !out.region) return null;
  return out;
}

// Best-effort persistence so the seed grows from real traffic. Guarded end to
// end: a read-only FS (serverless prod) throws and we swallow it — the
// in-process cache still covers repeats within the warm instance.
async function persist(key, value) {
  try {
    const fs = await import("node:fs/promises");
    const url = await import("node:url");
    const path = new URL("../data/fringe-locations.json", import.meta.url);
    const file = url.fileURLToPath(path);
    const current = JSON.parse(await fs.readFile(file, "utf8"));
    if (current[key]) return;
    current[key] = value;
    await fs.writeFile(file, JSON.stringify(current, null, 2) + "\n", "utf8");
  } catch {
    /* read-only filesystem or bundle: in-process cache still applies */
  }
}

// Resolve a colloquial area to concrete geography, or null if unresolvable.
// Layered: cache -> seed (both already in CACHE) -> one Haiku call.
export async function resolveFringeLocation(phrase) {
  const key = keyFor(phrase);
  if (!key || key.length < 3 || TOO_BROAD.has(key)) return null;
  if (CACHE.has(key)) return CACHE.get(key);

  const client = await anthropic();
  if (!client) return null;

  try {
    const msg = await client.messages.create({
      model: RESOLVER_MODEL,
      max_tokens: 400,
      tool_choice: { type: "tool", name: "report_location" },
      tools: [RESOLVE_TOOL],
      messages: [{
        role: "user",
        content:
          `A luxury traveler named this destination area: "${String(phrase).trim()}". ` +
          `Report the concrete geography it covers via report_location. If it is not a ` +
          `real identifiable area, set known false.`,
      }],
    });
    const block = (msg.content || []).find((c) => c.type === "tool_use");
    const resolved = sanitize(block && block.input);
    // Cache the outcome either way: a null memo stops us re-calling the model
    // for the same unresolvable phrase within this warm instance.
    CACHE.set(key, resolved);
    if (resolved) persist(key, resolved); // fire-and-forget
    return resolved;
  } catch {
    return null;
  }
}

export const __test = { keyFor, sanitize, CACHE };

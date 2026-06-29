// lib/experiences.js — Project Expedition "things to do" layer
//
// A prose-only sidecar to the five Atlas pillars. The Guide calls
// search_experiences to enrich pre/post cruise & jet days, hotel stays, and
// "what is there to do in <area>" questions with REAL tours and day
// experiences from Project Expedition. It surfaces the Private / Elevate picks
// first (the advisor's recommendations), then a few from the broader catalog.
//
// This is discovery, NOT booking: we deliberately drop pricing and booking_meta
// and never return a checkout/booking URL. Results feed the Guide's wording
// only — they are intentionally kept out of the result-card / map pipeline
// (see app/api/guide/route.ts, which does not push these into toolMeta).
//
// Env:
//   PROJECT_EXPEDITION_TOKEN  required; sent as the `access-token` header.
//   PE_API_BASE               optional; defaults to staging (no IP whitelisting).
//
// Failure is always graceful: a missing token, a timeout, or any upstream error
// returns { unavailable:true, total:0, preferred:[], others:[], note } and never
// throws into the guide loop, so the Guide simply advises without experiences.

import { normalizeCountry } from "./search-offerings.js";

const PE_API_BASE = process.env.PE_API_BASE || "https://apistage.projectexpedition.com/v1";
const PE_TOKEN = process.env.PROJECT_EXPEDITION_TOKEN || "";

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 6;
// How many raw tours to consider before trimming to the per-list limit. A wide
// pool lets the Private/Elevate picks float to the top even when the catalog
// returns the popular group tours first.
const CANDIDATE_POOL = 60;
const REQUEST_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 10 * 60 * 1000; // catalog is near-static within a session

// In-memory response cache keyed by the normalized query. Survives across
// requests in a warm serverless instance; cold starts simply re-fetch.
const cache = new Map(); // key -> { at:number, value:object }

// ── Anthropic tool schema ────────────────────────────────────────────────────
export const SEARCH_EXPERIENCES_TOOL = {
  name: "search_experiences",
  description:
    "Find real things to do at a destination — tours, private guides, and day " +
    "experiences from Project Expedition — to enrich an itinerary. Call this when " +
    "shaping the days before or after an Expedition Cruise or private jet journey, " +
    "padding a hotel stay with what to do nearby, or when the traveler asks what " +
    "there is to do in an area. It returns Private and Elevate picks first (the " +
    "advisor's recommendations) followed by a few from the broader catalog. This is " +
    "for inspiration only, never booking: there is no pricing and no booking path. " +
    "Do not use it for the core hotel, cruise, jet, yacht, or world-cruise search — " +
    "that is search_offerings.",
  input_schema: {
    type: "object",
    properties: {
      place: {
        type: "string",
        description:
          "The city, town, island, or area the traveler will be in, e.g. Rome, " +
          "Kyoto, Maui, Lisbon. Use this whenever a specific place is known.",
      },
      country: {
        type: "string",
        description: "Country name, e.g. Italy, Japan, Portugal. Helps locate the catalog.",
      },
      q: {
        type: "string",
        description:
          "Activity descriptors only, e.g. 'cooking class', 'private guide', " +
          "'wine tasting', 'food tour', 'sailing'. Never put a place or country here.",
      },
      category: {
        type: "string",
        description: "Optional broad category such as food, culture, outdoors, water, family.",
      },
      limit: {
        type: "integer",
        default: DEFAULT_LIMIT,
        description: "How many experiences to return per group (preferred and other). Default 3, max 6.",
      },
    },
  },
};

function clampLimit(raw) {
  let n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) n = DEFAULT_LIMIT;
  if (n > MAX_LIMIT) n = MAX_LIMIT;
  return n;
}

const str = (v) => (v == null ? "" : String(v)).trim();
const lower = (v) => str(v).toLowerCase();

// ── Private / Elevate classification ─────────────────────────────────────────
// CALIBRATE ME: how Project Expedition exposes "Private" and "Elevate" is not
// documented, so this checks every field where the signal plausibly lives. Once
// a real /return_tours response is in hand, tighten this to the actual fields
// (verify against tour.type / tour.collection / tour.tags / the booking_meta).
const PRIVATE_RE = /\bprivate\b|\bexclusive\b|\bprivate[\s-]?guide\b/i;
const ELEVATE_RE = /\belevate\b|\belevated\b|\bpremium\b|\bcurated\b|\bsignature\b/i;

function classifyExperience(tour = {}, about = {}) {
  // Gather the likely-textual signal fields into one haystack.
  const tagFields = []
    .concat(tour.tags || tour.labels || tour.collections || [])
    .concat(tour.collection || tour.tier || tour.experience_type || [])
    .map(lower);
  const hay = [
    about.name || tour.name || tour.title,
    tour.type || tour.tour_type || tour.product_type,
    tour.category || about.category,
    tour.collection || tour.tier,
    ...tagFields,
  ]
    .map(lower)
    .filter(Boolean)
    .join(" | ");

  // Explicit boolean flags win if the API exposes them.
  const flaggedPrivate = tour.is_private === true || tour.private === true;
  const flaggedElevate =
    tour.is_elevate === true || tour.elevate === true || lower(tour.tier) === "elevate";

  const isPrivate = flaggedPrivate || PRIVATE_RE.test(hay);
  const isElevate = flaggedElevate || ELEVATE_RE.test(hay);
  return { preferred: isPrivate || isElevate, isPrivate, isElevate };
}

// ── Normalization ────────────────────────────────────────────────────────────
// Trim a raw tour to what the Guide needs to speak about it. Defensive to the
// documented shape (about / itinerary / logistics) and common flat variants.
// Intentionally omits pricing and booking_meta — discovery, not booking.
function normalizeTour(tour = {}) {
  const about = tour.about || {};
  const itinerary = tour.itinerary || {};
  const logistics = tour.logistics || {};

  const name = str(about.name || tour.name || tour.title);
  if (!name) return null;

  const highlightsRaw = itinerary.highlights || tour.highlights || [];
  const highlights = (Array.isArray(highlightsRaw) ? highlightsRaw : [highlightsRaw])
    .map(str)
    .filter(Boolean)
    .slice(0, 4);

  const location = str(
    logistics.location ||
      logistics.town ||
      logistics.city ||
      about.town ||
      about.city ||
      tour.location,
  );
  const country = str(about.country || logistics.country || tour.country);
  const duration = str(itinerary.duration || tour.duration);
  const summary = str(
    about.summary || about.description || tour.summary || tour.description || itinerary.summary,
  ).slice(0, 280);
  const category = str(tour.category || about.category || (itinerary.category || ""));

  const rating = Number(about.rating ?? tour.rating ?? about.review_score);
  const reviewCount = Number(about.review_count ?? tour.review_count ?? about.reviews);

  const { preferred, isPrivate, isElevate } = classifyExperience(tour, about);

  return {
    name,
    location: location || country || "",
    country,
    duration: duration || null,
    category: category || null,
    summary: summary || null,
    highlights,
    rating: Number.isFinite(rating) ? rating : null,
    reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
    tier: isPrivate ? "Private" : isElevate ? "Elevate" : null,
    preferred,
  };
}

function tourHaystack(tour) {
  return [tour.name, tour.location, tour.country, tour.summary, tour.category]
    .concat(tour.highlights || [])
    .map(lower)
    .join(" | ");
}

// How many activity/category words the traveler named appear in the record — a
// soft relevance boost layered on top of quality, so "food tour" floats food
// experiences up without excluding everything else.
function descriptorScore(tour, descriptorNeedles) {
  if (!descriptorNeedles.length) return 0;
  const hay = tourHaystack(tour);
  return descriptorNeedles.reduce((n, d) => (hay.includes(d) ? n + 1 : n), 0);
}

// Place is the hard filter: the catalog pull is country-level, so this narrows
// it to the city/area the traveler actually named. Activity words do NOT filter
// (they only rank), and an empty place keeps the whole country pull.
function matchesPlace(tour, placeNeedles) {
  if (!placeNeedles.length) return true;
  const hay = tourHaystack(tour);
  return placeNeedles.every((n) => hay.includes(n));
}

// Rank: descriptor relevance first, then higher rating, then more reviews.
function ranker(descriptorNeedles) {
  return (a, b) => {
    const da = descriptorScore(a, descriptorNeedles);
    const db = descriptorScore(b, descriptorNeedles);
    if (db !== da) return db - da;
    const ra = a.rating ?? 0;
    const rb = b.rating ?? 0;
    if (rb !== ra) return rb - ra;
    return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function fetchTours(params) {
  const url = `${PE_API_BASE}/return_tours?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { "access-token": PE_TOKEN, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`project expedition ${r.status}`);
    const body = await r.json();
    // Tolerate a few likely envelope shapes: bare array, { tours }, { results }, { data }.
    if (Array.isArray(body)) return body;
    return body.tours || body.results || body.data || [];
  } finally {
    clearTimeout(timer);
  }
}

const unavailableResult = (note) => ({
  unavailable: true,
  total: 0,
  preferredCount: 0,
  preferred: [],
  others: [],
  note,
});

// ── Main entry ───────────────────────────────────────────────────────────────
// input is the validated tool input from the model.
export async function searchExperiences(input = {}) {
  if (!PE_TOKEN) {
    return unavailableResult(
      "The experiences catalog is not configured (no Project Expedition token). " +
        "An advisor can source local tours and private guides directly.",
    );
  }

  const limit = clampLimit(input.limit);
  const place = str(input.place);
  const country = normalizeCountry(input.country) || normalizeCountry(place);
  // place text is split so "Rome" matches even when the record says "Rome, Italy".
  const toNeedles = (s) =>
    lower(s)
      .split(/\s+/)
      .filter((n) => n.length > 2);
  const placeNeedles = toNeedles(place);
  const descriptorNeedles = [...toNeedles(input.q), ...toNeedles(input.category)];

  const cacheKey = JSON.stringify({ country, place: lower(place) });
  const cached = cache.get(cacheKey);
  let raw;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    raw = cached.value;
  } else {
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    params.set("currency", "USD");
    try {
      raw = await fetchTours(params);
      cache.set(cacheKey, { at: Date.now(), value: raw });
    } catch (err) {
      return unavailableResult(
        "Project Expedition experiences are momentarily unreachable. " +
          "An advisor can source local tours and private guides directly.",
      );
    }
  }

  const normalized = (raw || []).slice(0, CANDIDATE_POOL).map(normalizeTour).filter(Boolean);
  let matched = normalized.filter((t) => matchesPlace(t, placeNeedles));
  if (!matched.length) matched = normalized; // never zero out a real country pull

  const rank = ranker(descriptorNeedles);
  const preferred = matched.filter((t) => t.preferred).sort(rank);
  const others = matched.filter((t) => !t.preferred).sort(rank);

  const note =
    !preferred.length && matched.length
      ? "No Private or Elevate experiences surfaced for this query; these are from the broader catalog."
      : undefined;

  return {
    total: matched.length,
    preferredCount: preferred.length,
    preferred: preferred.slice(0, limit),
    others: others.slice(0, limit),
    ...(note ? { note } : {}),
  };
}

export { classifyExperience, normalizeTour };

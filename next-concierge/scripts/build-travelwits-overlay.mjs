#!/usr/bin/env node
// scripts/build-travelwits-overlay.mjs — resolve each Hotel Atlas property to
// its TravelWits hotelId via the portal's own autocomplete API.
//
// Why: a TravelWits deep link only auto-runs the search when sa[hotelId] (or a
// Google Place id in sa[value]) identifies the place. A label-only link strands
// the client at the search form with "Address is required". The autocomplete
// endpoint returns { hotelId, lat, lon, label } per property, so we harvest it
// once offline and ship the mapping as an overlay keyed by our hotel id.
//
// Rebuild after luxury-hotels.json changes:
//   node scripts/build-travelwits-overlay.mjs
// Resumable: already-resolved ids (matches AND recorded misses) are skipped on
// re-run; delete data/atlas/hotel/travelwits-overlay.json to start fresh.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOTELS_PATH = join(ROOT, "data/atlas/hotel/luxury-hotels.json");
const OUT_PATH = join(ROOT, "data/atlas/hotel/travelwits-overlay.json");

const API = "https://www.travelwitsapi.com/autocomplete";
// The API resolves the agency from the request origin; without it: 500
// "Travel agency not found".
const ORIGIN = "https://aspentraveladvisors.travelwits.com";
const CONCURRENCY = 4;
const DELAY_MS = 120; // per-worker pause between requests; stay polite

// Candidates farther than this from our own coordinates are never accepted —
// same-brand properties in other cities routinely share most name tokens.
const MAX_KM = 15;
// Within this radius the coordinates alone are decisive.
const NEAR_KM = 1.5;
const MIN_NAME_SIM = 0.5;

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const NAME_STOP = new Set([
  "the", "a", "an", "and", "of", "at", "by", "hotel", "hotels", "resort",
  "resorts", "spa", "residences", "collection", "luxury",
]);
const tokens = (s) => new Set(norm(s).split(" ").filter((t) => t && !NAME_STOP.has(t)));

// Overlap coefficient: |A ∩ B| / min(|A|,|B|). Forgiving of the extra suffix
// tokens TravelWits appends ("Aspen A Marriott Hotel").
function nameSim(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function suggestHotels(query) {
  const url = `${API}?types=9&types=10&query=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: { Origin: ORIGIN, Referer: ORIGIN + "/" } });
  if (!r.ok) throw new Error(`autocomplete ${r.status} for "${query}"`);
  const j = await r.json();
  const group = (j.groups || []).find((g) => g.value === "hotels");
  return (group && group.suggests) || [];
}

// Best hotel suggestion for one property, or null with a reason.
function pickMatch(hotel, suggests) {
  let best = null;
  for (const s of suggests) {
    if (!s || !s.hotelId || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const km = haversineKm(hotel.lat, hotel.lng, s.lat, s.lon);
    if (km > MAX_KM) continue;
    const sim = nameSim(hotel.name, s.label);
    if (km > NEAR_KM && sim < MIN_NAME_SIM) continue;
    const score = sim - km / 100; // prefer name agreement, break ties by distance
    if (!best || score > best.score) best = { s, km, sim, score };
  }
  return best;
}

async function resolveHotel(hotel) {
  const queries = [
    `${hotel.name} ${hotel.city || ""}`.trim(),
    hotel.name,
  ];
  let sawAny = false;
  for (const q of queries) {
    let suggests;
    try {
      suggests = await suggestHotels(q);
    } catch (err) {
      return { miss: `error: ${err.message}` };
    }
    sawAny = sawAny || suggests.length > 0;
    const best = pickMatch(hotel, suggests);
    if (best) {
      return {
        match: {
          hotelId: String(best.s.hotelId),
          lat: best.s.lat,
          lon: best.s.lon,
          label: best.s.label,
        },
      };
    }
  }
  return { miss: sawAny ? "no candidate within range" : "no suggestions" };
}

async function main() {
  const hotels = JSON.parse(readFileSync(HOTELS_PATH, "utf8"));
  const out = existsSync(OUT_PATH)
    ? JSON.parse(readFileSync(OUT_PATH, "utf8"))
    : { generatedAt: null, matched: {}, misses: {} };

  const pending = hotels.filter(
    (h) => h.id && !(h.id in out.matched) && !(h.id in out.misses)
  );
  console.log(`${hotels.length} hotels; ${pending.length} to resolve.`);

  let done = 0;
  const save = () => {
    out.generatedAt = new Date().toISOString();
    writeFileSync(OUT_PATH, JSON.stringify(out, null, 1) + "\n");
  };

  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= pending.length) return;
      const h = pending[i];
      const res = await resolveHotel(h);
      if (res.match) out.matched[h.id] = res.match;
      else out.misses[h.id] = { name: h.name, city: h.city, reason: res.miss };
      done++;
      if (done % 50 === 0) {
        save();
        console.log(`${done}/${pending.length} (${Object.keys(out.matched).length} matched total)`);
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();
  console.log(
    `done: ${Object.keys(out.matched).length} matched, ` +
    `${Object.keys(out.misses).length} unmatched → ${OUT_PATH}`
  );
}

main().catch((err) => { console.error(err); process.exit(1); });

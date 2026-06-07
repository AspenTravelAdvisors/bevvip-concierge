// api/atlas-points.js — Base Camp: compact hotel coordinate feed for the globe.
//
// The Living Atlas (Mapbox globe) plots the full hotel set as an ambient GPU dot
// field. The standalone atlas only exposes /api/luxury-hotels capped at 200 per
// page, so this proxy paginates the whole inventory once, server-side, and hands
// the client a single compact GeoJSON FeatureCollection (lng/lat + id + region).
// Kept in module memory and on the CDN so the client pays one small request.
//
// Env: HOTEL_ATLAS_API_BASE (optional; defaults to the live atlas).

const BASE =
  process.env.HOTEL_ATLAS_API_BASE || "https://luxury-hotel-atlas-two.vercel.app";
const PAGE = 200;                 // atlas hard cap per request
const TTL = 1000 * 60 * 60 * 6;   // refresh the in-memory feed every 6h

let CACHE = null;
let CACHE_AT = 0;

async function page(offset) {
  const r = await fetch(`${BASE}/api/luxury-hotels?limit=${PAGE}&offset=${offset}`);
  if (!r.ok) throw new Error(`atlas ${r.status} at offset ${offset}`);
  return r.json();
}

async function build() {
  const first = await page(0);
  const total = Number(first.total) || (first.results || []).length;

  const offsets = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
  const rest = await Promise.all(offsets.map(page));

  const features = [];
  for (const p of [first, ...rest]) {
    for (const h of p.results || []) {
      const lng = Number(h.lng);
      const lat = Number(h.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { id: h.id, region: h.region || null },
      });
    }
  }
  return { type: "FeatureCollection", count: features.length, features };
}

export default async function handler(req, res) {
  try {
    const now = Date.now();
    if (!CACHE || now - CACHE_AT > TTL) {
      CACHE = await build();
      CACHE_AT = now;
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=21600, stale-while-revalidate=86400"
    );
    res.status(200).json(CACHE);
  } catch (e) {
    // Never break the globe: an empty field just means no ambient dots.
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json({ type: "FeatureCollection", count: 0, features: [] });
  }
}

import { NextResponse } from "next/server";

// app/api/atlas-points/route.ts — compact hotel coordinate feed for the globe.
//
// Port of api/atlas-points.js. The Living Atlas plots the full hotel set as an
// ambient dot field; the standalone atlas only exposes /api/luxury-hotels
// capped at 200/page, so this paginates the whole inventory once server-side
// and hands the client one compact GeoJSON FeatureCollection.

export const runtime = "nodejs";
export const revalidate = 21600; // 6h

const BASE =
  process.env.HOTEL_ATLAS_API_BASE || "https://luxury-hotel-atlas-two.vercel.app";
const PAGE = 200;
const TTL = 1000 * 60 * 60 * 6;

interface Feature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { id: string; region: string | null };
}
interface FeatureCollection {
  type: "FeatureCollection";
  count: number;
  features: Feature[];
}

let CACHE: FeatureCollection | null = null;
let CACHE_AT = 0;

async function page(offset: number) {
  const r = await fetch(`${BASE}/api/luxury-hotels?limit=${PAGE}&offset=${offset}`);
  if (!r.ok) throw new Error(`atlas ${r.status} at offset ${offset}`);
  return r.json();
}

function pointForHotel(h: Record<string, unknown>): [number, number] | null {
  const geometry = h.geometry as { coordinates?: unknown } | undefined;
  const coords = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null;
  const lng = Number(h.lng ?? h.longitude ?? (coords && coords[0]));
  const lat = Number(h.lat ?? h.latitude ?? (coords && coords[1]));
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

async function build(): Promise<FeatureCollection> {
  const first = await page(0);
  const total = Number(first.total) || (first.results || []).length;

  const offsets: number[] = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
  const rest = await Promise.all(offsets.map((o) => page(o).catch(() => ({ results: [] }))));

  const features: Feature[] = [];
  for (const p of [first, ...rest]) {
    for (const h of p.results || []) {
      const point = pointForHotel(h);
      if (!point) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: point },
        properties: { id: h.id, region: h.region || null },
      });
    }
  }
  return { type: "FeatureCollection", count: features.length, features };
}

export async function GET() {
  try {
    const now = Date.now();
    if (!CACHE || now - CACHE_AT > TTL) {
      CACHE = await build();
      CACHE_AT = now;
    }
    return NextResponse.json(CACHE, {
      headers: {
        "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
      },
    });
  } catch {
    // Never break the globe: an empty field just means no ambient dots.
    return NextResponse.json({ type: "FeatureCollection", count: 0, features: [] });
  }
}

// api/atlas-points.js — Base Camp: compact coordinate feeds for the globe.
//
// The Living Atlas (Mapbox globe) plots each inventory type as an ambient GPU
// dot field. This single proxy paginates / normalizes every type's live source
// once, server-side, and hands the client one compact GeoJSON FeatureCollection
// per type. Kept in module memory and on the CDN so the client pays one small
// same-origin request instead of fanning out to four separate apps.
//
//   /api/atlas-points              -> hotels (default, back-compatible)
//   /api/atlas-points?type=hotel   -> hotels
//   /api/atlas-points?type=cruise  -> expedition-cruise regions (centroids + counts)
//   /api/atlas-points?type=jet     -> private-jet route destinations
//   /api/atlas-points?type=yacht   -> brand-yacht ports
//
// Granularity is honest per source: hotels & yacht ports & jet stops are true
// per-point fields; cruise exposes only region centroids (no per-sailing coords),
// so its field is region-weighted. All four route through one cache.
//
// Env: HOTEL_ATLAS_API_BASE (optional; defaults to the live hotel atlas).

const HOTEL_BASE =
  process.env.HOTEL_ATLAS_API_BASE || "https://luxury-hotel-atlas-two.vercel.app";

// Per-type live source for cruise/jet/yacht (static feeds published by each app).
const SOURCES = {
  cruise: "https://expedition-cruise-map.vercel.app/atlas-meta.json",
  jet:    "https://private-jet-expeditions.vercel.app/itinerary.json",
  yacht:  "https://luxury-hotel-brand-yacht-atlas.vercel.app/itinerary.json",
};

const PAGE = 200;                 // hotel atlas hard cap per request
const TTL = 1000 * 60 * 60 * 6;   // refresh each in-memory feed every 6h

// Per-type cache: { type: { fc, at } }
const CACHE = {};

const num = (v) => Number(v);
const finite2 = (lng, lat) => Number.isFinite(lng) && Number.isFinite(lat);

// ---- hotels: paginate the live atlas into a per-hotel point field -----------
async function hotelPage(offset) {
  const r = await fetch(`${HOTEL_BASE}/api/luxury-hotels?limit=${PAGE}&offset=${offset}`);
  if (!r.ok) throw new Error(`atlas ${r.status} at offset ${offset}`);
  return r.json();
}

async function buildHotels() {
  const first = await hotelPage(0);
  const total = Number(first.total) || (first.results || []).length;

  const offsets = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
  const rest = await Promise.all(offsets.map(hotelPage));

  const features = [];
  for (const p of [first, ...rest]) {
    for (const h of p.results || []) {
      const lng = num(h.lng), lat = num(h.lat);
      if (!finite2(lng, lat)) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { id: h.id, region: h.region || null },
      });
    }
  }
  return { type: "FeatureCollection", count: features.length, features };
}

// ---- cruise: region centroids + sailing counts ------------------------------
// atlas-meta.json REGIONS: { KEY: { name, coord:[lat,lng], count } }
async function buildCruise() {
  const j = await (await fetch(SOURCES.cruise)).json();
  const R = j.REGIONS || {};
  const features = [];
  for (const k of Object.keys(R)) {
    const r = R[k];
    if (!r || !Array.isArray(r.coord) || r.coord.length < 2) continue;
    const name = r.name || k;
    if (/^other$/i.test(name)) continue;            // skip catch-all buckets
    const lat = num(r.coord[0]), lng = num(r.coord[1]);
    if (!finite2(lng, lat)) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { name, region: name, count: r.count ?? null },
    });
  }
  return { type: "FeatureCollection", count: features.length, features };
}

// ---- jet: per-destination route points --------------------------------------
// itinerary.json ROUTES: { routeSlug: [ { n, r, ll:[lat,lng] }, ... ], ... }
// Flatten every itinerary's waypoints into one deduped point field.
async function buildJet() {
  const j = await (await fetch(SOURCES.jet)).json();
  const R = j.ROUTES || {};
  const lists = Array.isArray(R) ? [R] : Object.values(R);
  const features = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      if (!r || !Array.isArray(r.ll) || r.ll.length < 2) continue;
      const lat = num(r.ll[0]), lng = num(r.ll[1]);
      if (!finite2(lng, lat)) continue;
      const key = `${r.n}|${lng.toFixed(3)},${lat.toFixed(3)}`;
      if (seen.has(key)) continue;            // collapse stops shared across itineraries
      seen.add(key);
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { name: r.n || null, region: r.r || null },
      });
    }
  }
  return { type: "FeatureCollection", count: features.length, features };
}

// ---- yacht: per-port points -------------------------------------------------
// itinerary.json PORTS: [ ["Name", [lat,lng]], ... ]  (may also be an object)
async function buildYacht() {
  const j = await (await fetch(SOURCES.yacht)).json();
  const entries = Array.isArray(j.PORTS)
    ? j.PORTS
    : Object.entries(j.PORTS || {});
  const features = [];
  const seen = new Set();
  for (const e of entries) {
    const name = Array.isArray(e) ? e[0] : e?.[0];
    const ll = Array.isArray(e) ? e[1] : e?.[1];
    if (!name || !Array.isArray(ll) || ll.length < 2) continue;
    const lat = num(ll[0]), lng = num(ll[1]);
    if (!finite2(lng, lat)) continue;
    const key = String(name);
    if (seen.has(key)) continue;
    seen.add(key);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { name },
    });
  }
  return { type: "FeatureCollection", count: features.length, features };
}

const BUILDERS = {
  hotel: buildHotels,
  cruise: buildCruise,
  jet: buildJet,
  yacht: buildYacht,
};

export default async function handler(req, res) {
  const type = String((req.query && req.query.type) || "hotel").toLowerCase();
  const build = BUILDERS[type] || BUILDERS.hotel;
  const key = BUILDERS[type] ? type : "hotel";

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const now = Date.now();
    const c = CACHE[key];
    if (!c || now - c.at > TTL) {
      CACHE[key] = { fc: await build(), at: now };
    }
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=21600, stale-while-revalidate=86400"
    );
    res.status(200).json(CACHE[key].fc);
  } catch (e) {
    // Never break the globe: an empty field just means no ambient dots.
    res.status(200).json({ type: "FeatureCollection", count: 0, features: [] });
  }
}

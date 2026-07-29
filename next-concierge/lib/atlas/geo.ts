/**
 * The coordinate seam.
 *
 * Six data sources in this repo disagree about coordinate order:
 *
 *   data/atlas/hotel/luxury-hotels.json   {lat, lng}           named
 *   public/maps/hotel/hotel-points.json   GeoJSON coordinates  [lng, lat]
 *   data/villas-of-distinction.json       geo.{lat, lon}       named — `lon`, not `lng`
 *   jet / train  ROUTES[*][].ll           ll                   [lat, lng]
 *   jet / yacht / worldcruise REGIONS.coord                    [lat, lng]
 *   yacht / worldcruise PORTS[name]                            [lat, lng]
 *   AtlasShell PIN_NUDGE / REGION_FALLBACK                     [lng, lat]
 *
 * Mapbox and GeoJSON both want [lng, lat]. Every conversion in the UI layer
 * goes through this module: a bare [number, number] can no longer be passed
 * where a LngLat is expected, so the order becomes un-mixable rather than
 * merely documented in a comment. Each parser is named for the shape it
 * accepts, so the call site reads as an assertion about its input.
 */

declare const lngLatBrand: unique symbol;

/** A [longitude, latitude] pair. Only this module can mint one. */
export type LngLat = readonly [number, number] & { readonly [lngLatBrand]: true };

/** A pair whose order we have not established yet. */
export type Pair = readonly [number, number];

const mint = (lng: number, lat: number): LngLat => [lng, lat] as unknown as LngLat;

/**
 * True when both slots are real, finite numbers — use before minting or plotting.
 *
 * Deliberately stricter than `Number.isFinite(Number(x))`, which is what the
 * inline guards used to do: `Number(null)` and `Number("")` are both 0, so a
 * null coordinate passed and then plotted at [0, 0] — a point in the Gulf of
 * Guinea, off West Africa, which reads as a legitimate pin. Some ports in
 * public/maps/cruise/data/itinerary-routes.json carry exactly that.
 */
function isFiniteNumeric(x: unknown): boolean {
  if (x === null || x === undefined || x === "") return false;
  if (typeof x === "boolean") return false;
  return Number.isFinite(Number(x));
}

export function isFinitePair(v: unknown): v is Pair {
  return Array.isArray(v) && v.length >= 2 && isFiniteNumeric(v[0]) && isFiniteNumeric(v[1]);
}

/**
 * [lat, lng] → LngLat. The majority shape in this repo: jet/train `ll`,
 * REGIONS[*].coord, PORTS[name], and the villa pin feed's [id, lat, lon, …].
 */
export function fromLatLngPair(ll: Pair): LngLat {
  return mint(Number(ll[1]), Number(ll[0]));
}

/**
 * [lng, lat] → LngLat. Already in GeoJSON/Mapbox order: hotel-points.json,
 * /api/hotel/regions centers, AtlasShell's PIN_NUDGE and REGION_FALLBACK.
 * Not a no-op — it is the point at which "already correct" is stated once,
 * checkably, instead of assumed.
 */
export function fromLngLatPair(xy: Pair): LngLat {
  return mint(Number(xy[0]), Number(xy[1]));
}

/**
 * {lat, lng} or {lat, lon} → LngLat. Hotels use `lng`; the Villas of
 * Distinction dataset uses `lon`. `lng` wins when a record carries both.
 */
export function fromNamed(p: { lat: number; lng?: number; lon?: number }): LngLat {
  return mint(Number(p.lng ?? p.lon), Number(p.lat));
}

/** Longitude only, holding latitude — for nudging a pin sideways. */
export function withLng(p: LngLat, lng: number): LngLat {
  return mint(Number(lng), p[1]);
}

/** Offset a point by degrees, e.g. the spiral that unstacks co-located pins. */
export function offset(p: LngLat, dLng: number, dLat: number): LngLat {
  return mint(p[0] + dLng, p[1] + dLat);
}

/**
 * Unwrap a line so consecutive points never jump more than 180° of longitude.
 *
 * Without this a Tokyo → Napa leg reads as +139° → -122°, a 261° step, and
 * renders as a line the long way round the world instead of a Pacific
 * crossing. Ported from the `unroll()` in public/maps/worldcruise/index.html,
 * which does the same thing in [lat, lng] order. Longitudes may leave the
 * ±180 range by design — Mapbox draws the continuation correctly.
 */
export function unrollLine(pts: readonly LngLat[]): LngLat[] {
  if (pts.length === 0) return [];
  const out: LngLat[] = [mint(pts[0][0], pts[0][1])];
  for (let i = 1; i < pts.length; i++) {
    let lng = pts[i][0];
    const prev = out[i - 1][0];
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    out.push(mint(lng, pts[i][1]));
  }
  return out;
}

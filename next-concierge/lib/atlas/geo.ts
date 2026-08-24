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

/**
 * The great-circle path between two points, densified enough to draw.
 *
 * Jet legs used to be a quadratic bezier — `arcPts` in sea-router.mjs, with a
 * control point pushed perpendicular to the lat/lng chord. That is the right
 * call for a SHORT sea hop, where the bow is a chart convention and the true
 * track is a matter of a few kilometres either way. It is the wrong one for an
 * aircraft, which flies a geodesic you can look up. (Long sea crossings have
 * since moved to a great circle too, for the same reason — see GC_MIN_DEG in
 * sea-router.mjs. This module stays the jet path; the sea router keeps its own
 * copy because it works in [lat, lng] and must not import the branded type.)
 *
 * The bezier was wrong in a way that showed. Its bulge takes the sign of the
 * leg's direction (`cy = my + dx * k`), so an eastbound leg bows north and a
 * westbound leg bows SOUTH. Tokyo → Los Angeles bowed the right way and
 * undershot the true track by about 7° of latitude; the return leg bowed down
 * past Hawaii, which is not a route any aircraft has ever flown. Any itinerary
 * with an out-and-back pair drew a lens instead of a path.
 *
 * A real slerp costs nothing to compute and is, on regional legs, cheaper to
 * draw than what it replaces: point count follows the leg's actual length
 * rather than being fixed at 101, so a Mediterranean hop ships a quarter of
 * the vertices and a transpacific crossing ships the same.
 *
 * FRAME. The caller unrolls its stops first, so a leg may legitimately start
 * at +241° — see unrollLine. Slerp returns longitudes in ±180, so every point
 * is re-anchored to the one before it and the path stays continuous in the
 * frame it was handed, antimeridian and all.
 *
 * @param maxStepDeg target angular spacing. 0.8° holds the drawn chord under
 *        a pixel at the zoom a traced route actually gets framed at.
 */
export function geodesicLine(a: LngLat, b: LngLat, maxStepDeg = 0.8): LngLat[] {
  const RAD = Math.PI / 180;
  const la1 = a[1] * RAD, lo1 = a[0] * RAD;
  const la2 = b[1] * RAD, lo2 = b[0] * RAD;
  const x1 = Math.cos(la1) * Math.cos(lo1);
  const y1 = Math.cos(la1) * Math.sin(lo1);
  const z1 = Math.sin(la1);
  const x2 = Math.cos(la2) * Math.cos(lo2);
  const y2 = Math.cos(la2) * Math.sin(lo2);
  const z2 = Math.sin(la2);
  const dot = Math.min(1, Math.max(-1, x1 * x2 + y1 * y2 + z1 * z2));
  const ang = Math.acos(dot);
  const sin = Math.sin(ang);
  /*
   * Two degenerate cases share one guard, because they share one symptom.
   *
   * A zero-length leg (a stop repeated) and an antipodal pair (no unique great
   * circle between them) both make the slerp unstable. Neither is reachable
   * from a real itinerary, and both would emit garbage — NaN in the antipodal
   * case, which Mapbox does not reject loudly: it drops the whole LineString,
   * so the failure reads as "this one trip has no route" rather than as a bug.
   *
   * The angle is tested directly rather than its sine. Testing `sin(ang)`
   * looks equivalent and is not, at either end. A repeated stop gives a dot
   * product of 0.9999999999999999 rather than exactly 1, so `ang` lands near
   * 1.5e-8 and `sin` clears any threshold tight enough to be safe — the guard
   * silently missed the case it was written for and emitted a couple of dozen
   * float-jitter points on top of each other. At the far end, slerp is already
   * unstable for a NEARLY antipodal pair, while `sin` is still comfortably
   * non-zero. 1e-7 rad is 64 cm on the ground: below any two distinct stops.
   */
  if (!Number.isFinite(ang) || ang < 1e-7 || Math.PI - ang < 1e-7) {
    return [mint(a[0], a[1]), mint(b[0], b[1])];
  }
  const n = Math.min(192, Math.max(24, Math.ceil(ang / RAD / maxStepDeg)));
  const out: LngLat[] = [];
  let prevLng = a[0];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const f1 = Math.sin((1 - t) * ang) / sin;
    const f2 = Math.sin(t * ang) / sin;
    const x = f1 * x1 + f2 * x2;
    const y = f1 * y1 + f2 * y2;
    const z = f1 * z1 + f2 * z2;
    const lat = Math.atan2(z, Math.hypot(x, y)) / RAD;
    let lng = Math.atan2(y, x) / RAD;
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    out.push(mint(lng, lat));
  }
  return out;
}

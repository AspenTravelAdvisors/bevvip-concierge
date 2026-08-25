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
 * Bow height as a fraction of the chord, for the parabolic loft below.
 *
 * 0.08 is not a taste call — it is the sagitta the quadratic bezier this
 * replaced produced at k = 0.16, measured at its midpoint. Matching it means
 * the drawn curvature is exactly what the atlas looked like before, on top of
 * a track that is now correct.
 */
export const LOFT_K = 0.08;

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
 * LOFT. The track is right; the drawn line is the track plus a parabolic bow,
 * for the reason airline route maps have always drawn one. A true great circle
 * only LOOKS curved when it is a high-latitude east-west leg: measured over the
 * 553 legs in the jet atlas, the bezier this replaced bowed a constant 8% of
 * its chord and the bare geodesic bows a median of 1.3%, leaving 62% of legs
 * drawing as good as straight. That is the "reads as a wire rather than a
 * journey" this file's callers have always been trying to avoid, and losing it
 * was a real regression even though the geometry underneath got more honest.
 *
 * So the bow is added back on top of the correct track rather than instead of
 * it, at the amplitude the bezier used, and — unlike the bezier — symmetrically:
 * see the canonical ordering below.
 *
 * @param maxStepDeg target angular spacing. 0.8° holds the drawn chord under
 *        a pixel at the zoom a traced route actually gets framed at.
 * @param loft bow height as a fraction of the chord. 0 draws the bare geodesic.
 */
export function geodesicLine(
  a: LngLat,
  b: LngLat,
  maxStepDeg = 0.8,
  loft = LOFT_K,
): LngLat[] {
  /*
   * Canonical endpoint order — this is what keeps the bow honest.
   *
   * The bezier's actual defect was never the bow itself, it was that the bow
   * took the sign of the leg's DIRECTION, so the same city pair flown the other
   * way bowed the other way and an out-and-back itinerary drew a lens. Any
   * perpendicular offset reintroduces that unless the offset is computed from
   * the unordered pair. Sorting the endpoints first, and reversing the result
   * at the end, makes A→B and B→A the identical polyline by construction.
   *
   * The two frames a caller may hand us (unrollLine puts Tokyo→LAX at +241°
   * and LAX→Tokyo at -220°) differ by exactly 360°, so every quantity derived
   * from the DIFFERENCE of the endpoints — chord, perpendicular, amplitude —
   * is frame-independent and matches across the pair.
   */
  const flip = a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  const p0 = flip ? b : a;
  const p1 = flip ? a : b;
  const out = geodesicRun(p0, p1, maxStepDeg, loft);
  return flip ? out.reverse() : out;
}

/** The ordered half of geodesicLine. Assumes p0/p1 are already canonical. */
function geodesicRun(a: LngLat, b: LngLat, maxStepDeg: number, loft: number): LngLat[] {
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
  /*
   * The bow, perpendicular to the chord in lat/lng space.
   *
   * Deliberately computed in raw degrees rather than on the sphere, because
   * the point is to reproduce what the bezier drew — which worked in degrees,
   * and so bowed a little wider on screen at high latitude. Matching the old
   * look means matching that too.
   *
   * Direction is POLEWARD wherever the perpendicular has a real latitude
   * component: that is the way a great circle already leans, so the bow
   * exaggerates the truth instead of fighting it. On a due north-south leg the
   * perpendicular is purely east-west and "poleward" means nothing — there the
   * canonical ordering above is what settles it, consistently for both
   * directions of travel.
   */
  const dLng = b[0] - a[0];
  const dLat = b[1] - a[1];
  const chord = Math.hypot(dLng, dLat);
  let px = 0;
  let py = 0;
  let amp = 0;
  if (loft !== 0 && chord > 1e-12) {
    px = -dLat / chord;
    py = dLng / chord;
    const midLat = (a[1] + b[1]) / 2;
    if (py * midLat < 0) { px = -px; py = -py; }
    /*
     * Top the geodesic's own bow UP to `loft`, rather than adding to it.
     *
     * The bezier's charm was that every leg bowed by the same fraction of its
     * chord, which is what gave a multi-stop itinerary its rhythm. A geodesic
     * already bows on its own — by almost nothing on a north-south or
     * equatorial leg, and by a lot on a high-latitude east-west one — so
     * simply adding a constant bow on top stacked the two on exactly the legs
     * that were already the most curved: measured across the jet atlas, the
     * drawn bow ranged from 8% to 26% of chord instead of a steady 8%, and the
     * longest, most prominent crossings were the ones thrown off.
     *
     * So the loft supplies only the DIFFERENCE. A leg that already bows the
     * full amount gets none and is drawn as the bare great circle; a leg that
     * bows more than that keeps its own shape, since the truth is never worth
     * flattening to hit a number.
     */
    const gx = x1 + x2, gy = y1 + y2, gz = z1 + z2;
    const gn = Math.hypot(gx, gy, gz);
    let own = 0;
    if (gn > 1e-12) {
      const mLat = Math.atan2(gz / gn, Math.hypot(gx / gn, gy / gn)) / RAD;
      let mLng = Math.atan2(gy / gn, gx / gn) / RAD;
      while (mLng - a[0] > 180) mLng -= 360;
      while (mLng - a[0] < -180) mLng += 360;
      own = Math.abs((mLng - a[0]) * dLat - (mLat - a[1]) * dLng) / chord / chord;
    }
    amp = Math.max(0, loft - own) * chord;
  }
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
    // 4t(1-t): a parabola, zero at both ends and 1 at the midpoint, so the
    // endpoints stay pinned exactly on their stops and the peak sagitta is
    // `amp` — i.e. LOFT_K of the chord.
    const bow = amp * 4 * t * (1 - t);
    out.push(mint(lng + bow * px, lat + bow * py));
  }
  return out;
}

/**
 * Sea routing — extracted, near-verbatim, from public/maps/worldcruise/index.html
 * (the same ~11 KB block is duplicated in the cruise and yacht atlases).
 *
 * Plain ESM: no DOM, no Leaflet, no fetch. The caller injects the land-mask
 * bytes, so this runs in Node at build time and, if ever needed, in a worker.
 *
 * WHAT IT DOES, AND WHY EACH PIECE EARNS ITS PLACE
 *
 *   buildOcean()   flood-fills the open ocean from six seeds, so a leg can
 *                  never start or end in a landlocked lake or a closed bay
 *                  that merely happens to be wet.
 *   aStarSea()     A* over ocean cells. Cosine-latitude cost correction keeps
 *                  distances honest near the poles; a 1.6x penalty on cells
 *                  adjacent to land sits ships ~1 cell offshore instead of
 *                  scraping the coast; search boxes widen 45 -> 140 -> 280 ->
 *                  440 for round-the-continent detours, under a 1.4M-cell guard.
 *   rdp + chaikin  Douglas-Peucker, then corner-cutting. This is what turns the
 *                  A* staircase into something that reads as a shipping lane.
 *   arcPts()       quadratic bezier for SHORT legs that don't hit land. An arc
 *                  reads as a voyage; a straight line reads as a ruler.
 *                  k = 0.16 is the constant that makes that true — do not
 *                  "clean it up".
 *   gcPts()        the great circle, for long open-water legs. Past ~1,500 km
 *                  the bezier stops being a stylisation and starts being
 *                  wrong; see GC_MIN_DEG for where the line is drawn and why.
 *
 * NOT PORTED: reanchorRoutes / bump / setLatLngs — Leaflet world-copy panning.
 * Mapbox handles that itself.
 *
 * COORDINATE ORDER. Internals stay in the original [lat, lng] so the ported
 * arithmetic is line-for-line comparable with the Leaflet source. Conversion to
 * [lng, lat] happens once, at the public boundary, in `leg()`. Callers hand in
 * [lat, lng] because that is what PORTS / ll / REGIONS.coord already hold.
 */

const W = 3600;
const H = 1700;
const RES = 10; // cells per degree — 0.1 deg
const LAT_MAX = 85;
export const MASK_BYTES = (W * H) / 8; // 765,000

/** Bezier bulge. The arcs stop reading as voyages if you touch this. */
export const ARC_K = 0.16;

const normLng = (lng) => (((lng + 180) % 360) + 360) % 360 - 180;
const col = (lng) => { let c = Math.round((normLng(lng) + 180) * RES); if (c >= W) c -= W; if (c < 0) c += W; return c; };
const row = (lat) => Math.round((LAT_MAX - lat) * RES);
const cellLng = (c) => -180 + c / RES;
const cellLat = (r) => LAT_MAX - r / RES;

/** Quadratic bezier through a control point offset perpendicular to the leg. */
/**
 * @param {number[]} a  [lat, lng]
 * @param {number[]} b  [lat, lng]
 * @param {number} step curve resolution; 0.04 gives the original's 26 points.
 *        Long flight arcs need more or they render as visible chords.
 */
export function arcPts(a, b, step = 0.04) {
  const la1 = a[0], lo1 = a[1], la2 = b[0], lo2 = b[1];
  const mx = (lo1 + lo2) / 2, my = (la1 + la2) / 2, dx = lo2 - lo1, dy = la2 - la1;
  const cx = mx - dy * ARC_K, cy = my + dx * ARC_K;
  const p = [];
  for (let t = 0; t <= 1.0001; t += step) {
    const x = (1 - t) * (1 - t) * lo1 + 2 * (1 - t) * t * cx + t * t * lo2;
    const y = (1 - t) * (1 - t) * la1 + 2 * (1 - t) * t * cy + t * t * la2;
    p.push([y, x]);
  }
  return p;
}

/**
 * Minimum leg length, in degrees of arc, before a great circle replaces the
 * bezier. ~13.5° is about 1,500 km.
 *
 * Chosen from the shipped data rather than taste. Of the 912 open-water legs
 * across the three sea collections, 740 are under 500 km, and on those the
 * bezier's midpoint sits a median of 13 km from the great circle's — a
 * difference no zoom level will ever show. Below this threshold the two curves
 * are the same drawing, so the bezier keeps the legs it was designed for: a
 * short hop that would otherwise be a ruler-straight line between two islands.
 *
 * Above it they diverge for real — up to 871 km on a 5,148 km world-cruise
 * crossing — and the bezier is the one that is wrong. A ship on a long ocean
 * passage sails a great circle; that is what great-circle sailing IS, not a
 * stylisation of it.
 */
export const GC_MIN_DEG = 13.5;

/** Great-circle central angle between two [lat, lng] points, in degrees. */
export function centralAngleDeg(a, b) {
  const RAD = Math.PI / 180;
  const la1 = a[0] * RAD, la2 = b[0] * RAD, dLo = (b[1] - a[1]) * RAD;
  const c = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dLo);
  return Math.acos(Math.min(1, Math.max(-1, c))) / RAD;
}

/**
 * The great circle between two points, in [lat, lng] — the track a ship on a
 * long open-ocean passage actually sails.
 *
 * Companion to arcPts, not a replacement for it: see GC_MIN_DEG for which legs
 * get which, and why. The bezier's flaw at this range is not merely that it is
 * approximate — its bulge takes the sign of the leg's direction, so a crossing
 * sailed eastbound bows north and the same crossing sailed westbound bows
 * south. 140 port pairs in the shipped data are sailed both ways, and each one
 * drew a lens instead of a route.
 *
 * FRAME. route() unrolls before it calls this, so `a` may legitimately sit at
 * +241°. Slerp returns longitudes in ±180, so each point is re-anchored to the
 * one before it and the track stays continuous in the frame it was handed.
 * Endpoints are pinned exactly, so legs still meet at their ports.
 */
export function gcPts(a, b) {
  const RAD = Math.PI / 180;
  const ang = centralAngleDeg(a, b) * RAD;
  const sin = Math.sin(ang);
  // Degenerate and antipodal alike: no unique great circle, and the slerp
  // denominator vanishes. Tested on the angle, not its sine — see geo.ts.
  if (!Number.isFinite(ang) || ang < 1e-7 || Math.PI - ang < 1e-7) {
    return [a.slice(), b.slice()];
  }
  const la1 = a[0] * RAD, lo1 = a[1] * RAD, la2 = b[0] * RAD, lo2 = b[1] * RAD;
  const x1 = Math.cos(la1) * Math.cos(lo1), y1 = Math.cos(la1) * Math.sin(lo1), z1 = Math.sin(la1);
  const x2 = Math.cos(la2) * Math.cos(lo2), y2 = Math.cos(la2) * Math.sin(lo2), z2 = Math.sin(la2);
  const n = Math.min(192, Math.max(24, Math.ceil(ang / RAD / 0.8)));
  const p = [];
  let prevLng = a[1];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const f1 = Math.sin((1 - t) * ang) / sin;
    const f2 = Math.sin(t * ang) / sin;
    const x = f1 * x1 + f2 * x2, y = f1 * y1 + f2 * y2, z = f1 * z1 + f2 * z2;
    const lat = Math.atan2(z, Math.hypot(x, y)) / RAD;
    let lng = Math.atan2(y, x) / RAD;
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    p.push([lat, lng]);
  }
  // Pin the ends. The slerp lands within float epsilon of both, and legs are
  // expected to meet exactly at their shared port.
  p[0] = a.slice();
  p[p.length - 1] = b.slice();
  return p;
}

/** Unwrap in [lat, lng] order — the Leaflet original. See geo.ts unrollLine. */
export function unroll(coords) {
  const out = [coords[0].slice()];
  for (let i = 1; i < coords.length; i++) {
    let lo = coords[i][1];
    const prevLo = out[i - 1][1];
    while (lo - prevLo > 180) lo -= 360;
    while (lo - prevLo < -180) lo += 360;
    out.push([coords[i][0], lo]);
  }
  return out;
}

export function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-9;
  let dmax = 0, k = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / len;
    if (d > dmax) { dmax = d; k = i; }
  }
  if (dmax > eps) return rdp(pts.slice(0, k + 1), eps).slice(0, -1).concat(rdp(pts.slice(k), eps));
  return [a, b];
}

export function chaikin(pts, iters) {
  let p = pts;
  for (let it = 0; it < iters && p.length >= 3; it++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

function hPush(h, n) {
  h.push(n);
  let i = h.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (h[p].f <= h[i].f) break; const t = h[p]; h[p] = h[i]; h[i] = t; i = p; }
}
function hPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0; const n = h.length;
    for (;;) {
      let l = 2 * i + 1, r = l + 1, s = i;
      if (l < n && h[l].f < h[s].f) s = l;
      if (r < n && h[r].f < h[s].f) s = r;
      if (s === i) break;
      const t = h[s]; h[s] = h[i]; h[i] = t; i = s;
    }
  }
  return top;
}

/**
 * Build a router over one land-mask buffer.
 *
 * @param {Uint8Array|ArrayBuffer|Buffer} maskBuffer bit-packed land grid,
 *        exactly MASK_BYTES long (3600 x 1700 / 8).
 */
export function createSeaRouter(maskBuffer, { cellBudget = 1400000 } = {}) {
  const mask =
    maskBuffer instanceof Uint8Array
      ? maskBuffer
      : new Uint8Array(maskBuffer.buffer ?? maskBuffer, maskBuffer.byteOffset ?? 0, maskBuffer.byteLength ?? maskBuffer.length);
  if (mask.length !== MASK_BYTES) {
    throw new Error(`landmask must be ${MASK_BYTES} bytes (3600x1700/8), got ${mask.length}`);
  }

  const isLandCell = (c, r) => {
    if (r < 0 || r >= H) return false;
    if (c < 0) c += W;
    if (c >= W) c -= W;
    const i = r * W + c;
    return (mask[i >> 3] >> (i & 7)) & 1;
  };
  const isLandLL = (lat, lng) => {
    if (lat > LAT_MAX || lat < -LAT_MAX) return false;
    const r = row(lat);
    if (r < 0 || r >= H) return false;
    return isLandCell(col(lng), r);
  };
  const nearLandCell = (c, r) => isLandCell(c + 1, r) || isLandCell(c - 1, r) || isLandCell(c, r + 1) || isLandCell(c, r - 1);

  // Flood-fill the open ocean from six seeds spread across the major basins.
  const N = W * H;
  const ocean = new Uint8Array((N + 7) >> 3);
  {
    const getO = (i) => (ocean[i >> 3] >> (i & 7)) & 1;
    const setO = (i) => { ocean[i >> 3] |= 1 << (i & 7); };
    const q = new Int32Array(N);
    let head = 0, tail = 0;
    for (const [la, lo] of [[0, -150], [0, -30], [0, 80], [40, -45], [60, -180], [-40, 60]]) {
      const c = col(lo), r = row(la);
      if (r < 0 || r >= H) continue;
      const i = r * W + c;
      if (!isLandCell(c, r) && !getO(i)) { setO(i); q[tail++] = i; }
    }
    while (head < tail) {
      const i = q[head++], r = (i / W) | 0, c = i - r * W;
      let nc, ni;
      nc = c + 1 >= W ? 0 : c + 1; ni = r * W + nc; if (!getO(ni) && !isLandCell(nc, r)) { setO(ni); q[tail++] = ni; }
      nc = c - 1 < 0 ? W - 1 : c - 1; ni = r * W + nc; if (!getO(ni) && !isLandCell(nc, r)) { setO(ni); q[tail++] = ni; }
      if (r + 1 < H) { ni = (r + 1) * W + c; if (!getO(ni) && !isLandCell(c, r + 1)) { setO(ni); q[tail++] = ni; } }
      if (r - 1 >= 0) { ni = (r - 1) * W + c; if (!getO(ni) && !isLandCell(c, r - 1)) { setO(ni); q[tail++] = ni; } }
    }
  }
  const oceanAt = (c, r) => {
    if (r < 0 || r >= H) return false;
    if (c < 0) c += W;
    if (c >= W) c -= W;
    const i = r * W + c;
    return (ocean[i >> 3] >> (i & 7)) & 1;
  };

  const lineHitsLand = (a, b) => {
    const dlat = b[0] - a[0], dlng = normLng(b[1] - a[1]);
    const steps = Math.max(2, Math.ceil(Math.hypot(dlat, dlng) * RES * 1.5));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      if (isLandLL(a[0] + dlat * f, normLng(a[1] + dlng * f))) return true;
    }
    return false;
  };
  const polyHitsLand = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) if (lineHitsLand(pts[i], pts[i + 1])) return true;
    return false;
  };
  const densify = (a, b, n) => {
    const p = [];
    for (let i = 0; i <= n; i++) { const f = i / n; p.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
    return p;
  };

  // Snap to the connected open ocean, not just any wet pixel.
  const nearestSeaCell = (lat, lng) => {
    const c0 = col(lng), r0 = row(lat);
    if (oceanAt(c0, r0)) return [c0, r0];
    for (let rad = 1; rad <= 30; rad++)
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          if (oceanAt(c0 + dx, r0 + dy)) return [c0 + dx, r0 + dy];
        }
    return null;
  };

  const searchSea = (sa, sb, pad) => {
    const minC = Math.min(sa[0], sb[0]) - pad, maxC = Math.max(sa[0], sb[0]) + pad;
    const minR = Math.max(0, Math.min(sa[1], sb[1]) - pad), maxR = Math.min(H - 1, Math.max(sa[1], sb[1]) + pad);
    const bw = maxC - minC + 1, bh = maxR - minR + 1;
    // Budget guard. 1.4M was the right ceiling when this ran in a visitor's
    // main thread; at build time it can be raised so the longest legs
    // (Walvis Bay -> Scotland and friends) get a search box big enough to
    // succeed instead of falling back to an arc straight over Africa.
    if (bw * bh > cellBudget) return null;
    const idx = (c, r) => (r - minR) * bw + (c - minC);
    const inBox = (c, r) => c >= minC && c <= maxC && r >= minR && r <= maxR;
    const g = new Float64Array(bw * bh).fill(Infinity);
    const came = new Int32Array(bw * bh).fill(-1);
    const closed = new Uint8Array(bw * bh);
    const cosR = (r) => Math.max(0.15, Math.cos((cellLat(r) * Math.PI) / 180));
    const hcost = (c, r) => Math.hypot(Math.abs(c - sb[0]) * cosR(r), Math.abs(r - sb[1]));
    g[idx(sa[0], sa[1])] = 0;
    const heap = [];
    hPush(heap, { c: sa[0], r: sa[1], f: hcost(sa[0], sa[1]) });
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let found = false;
    while (heap.length) {
      const cur = hPop(heap), ci = idx(cur.c, cur.r);
      if (closed[ci]) continue;
      closed[ci] = 1;
      if (cur.c === sb[0] && cur.r === sb[1]) { found = true; break; }
      const base = g[ci], cl = cosR(cur.r);
      for (const [dx, dy] of dirs) {
        const nc = cur.c + dx, nr = cur.r + dy;
        if (!inBox(nc, nr) || isLandCell(nc, nr)) continue;
        const ni = idx(nc, nr);
        if (closed[ni]) continue;
        let step = dx && dy ? Math.hypot(cl, 1) : dx ? cl : 1;
        if (nearLandCell(nc, nr)) step *= 1.6; // sit ~1 cell offshore
        const ng = base + step;
        if (ng < g[ni]) { g[ni] = ng; came[ni] = ci; hPush(heap, { c: nc, r: nr, f: ng + hcost(nc, nr) }); }
      }
    }
    if (!found) return null;
    const path = [];
    let ci = idx(sb[0], sb[1]);
    while (ci !== -1) { path.push([cellLat(minR + Math.floor(ci / bw)), cellLng(minC + (ci % bw))]); ci = came[ci]; }
    return path.reverse();
  };

  const aStarSea = (a, b) => {
    const sa = nearestSeaCell(a[0], a[1]), sb = nearestSeaCell(b[0], b[1]);
    if (!sa || !sb) return null;
    // ANTIMERIDIAN. col() normalizes both endpoints into [0, W), so a Tokyo ->
    // Honolulu leg reads as spanning almost the whole grid and the search box
    // gets drawn the long way — across Eurasia — where it either blows the
    // budget or finds nothing, and the leg falls back to an arc over land.
    // Shift the western endpoint one full turn east so the box spans the short
    // way across the Pacific instead. isLandCell and oceanAt already wrap their
    // column reads, and route() unrolls afterwards, so the out-of-range columns
    // and the >180 longitudes they produce are both handled downstream.
    if (Math.abs(sa[0] - sb[0]) > W / 2) {
      if (sa[0] < sb[0]) sa[0] += W;
      else sb[0] += W;
    }
    const span = Math.max(Math.abs(sa[0] - sb[0]), Math.abs(sa[1] - sb[1]));
    const pads = [Math.max(45, Math.round(span * 0.9))];
    for (const p of [140, 280, 440]) if (p > pads[pads.length - 1]) pads.push(p);
    for (const pad of pads) { const r = searchSea(sa, sb, pad); if (r) return r; }
    return null;
  };

  const cache = new Map();

  /**
   * Geometry for one leg, in the original [lat, lng] order.
   * @returns {{pts: number[][], mode: "arc"|"densified"|"sea"|"arc-fallback"}}
   *   mode "arc"          open water, bezier
   *   mode "densified"    open water, but the bezier bulged onto land
   *   mode "sea"          A* routed around land
   *   mode "arc-fallback" A* found nothing — an arc that MAY cross land
   */
  function legGeometryLatLng(a, b) {
    const key = `${a[0].toFixed(2)},${a[1].toFixed(2)}|${b[0].toFixed(2)},${b[1].toFixed(2)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let out;
    if (!lineHitsLand(a, b)) {
      /*
       * Open water. Long crossings get the great circle a ship actually
       * sails; short hops keep the bezier, which at that range draws the same
       * curve and is doing deliberate work. See GC_MIN_DEG.
       *
       * A great circle can bow onto land where the straight line between the
       * same two ports did not — a northern crossing rides up over a landmass
       * the rhumb line misses — so it is checked like any other candidate and
       * falls back to the bezier before anything gives up on a curve at all.
       */
      let curve = null;
      let mode = "arc";
      if (centralAngleDeg(a, b) >= GC_MIN_DEG) {
        const gc = gcPts(a, b);
        if (!polyHitsLand(gc)) { curve = gc; mode = "great-circle"; }
      }
      if (!curve) {
        const arc = arcPts(a, b);
        if (!polyHitsLand(arc)) { curve = arc; mode = "arc"; }
      }
      out = curve ? { pts: curve, mode } : { pts: densify(a, b, 14), mode: "densified" };
    } else {
      const raw = aStarSea(a, b);
      if (raw && raw.length >= 2) {
        let body = chaikin(rdp(raw, 0.12), 2);
        if (polyHitsLand(body)) body = rdp(raw, 0.12);
        if (polyHitsLand(body)) body = raw;
        // Realign A* (which works in normalized lng) to the leg's own frame.
        const off = a[1] - normLng(a[1]);
        if (off) body = body.map((p) => [p[0], p[1] + off]);
        out = { pts: [a.slice(), ...body, b.slice()], mode: "sea" };
      } else {
        out = { pts: arcPts(a, b), mode: "arc-fallback" };
      }
    }
    cache.set(key, out);
    return out;
  }

  return {
    /** Cache key for a leg — dedupe across trips with this. */
    legKey: (a, b) => `${a[0].toFixed(2)},${a[1].toFixed(2)}|${b[0].toFixed(2)},${b[1].toFixed(2)}`,

    /**
     * Route a whole port sequence. THIS IS THE ENTRY POINT TO USE.
     *
     * The unrolling has to happen on the port list *before* any leg is routed,
     * not on the finished geometry after. A Tokyo (139.8E) -> Napa (122.3W) leg
     * handed to legGeometry raw draws its bezier from +139.8 to -122.3 — sweeping
     * west across Asia, Africa and the Atlantic, 3.3x the great-circle distance.
     * Unroll first and the same leg runs +139.8 -> +237.7: east, across the
     * Pacific, as a ship would. legGeometry is built for this — its
     * `off = a[1] - normLng(a[1])` line exists precisely to realign A* results
     * (computed on normalized longitude) back into the unrolled frame.
     *
     * @param {number[][]} ports consecutive [lat, lng] calls
     * @returns {{coordinates: number[][], modes: string[]}} [lng, lat] polyline
     */
    route(ports) {
      if (!Array.isArray(ports) || ports.length < 2) return { coordinates: [], modes: [] };
      const frame = unroll(ports);
      const coordinates = [];
      const modes = [];
      for (let i = 0; i < frame.length - 1; i++) {
        const { pts, mode } = legGeometryLatLng(frame[i], frame[i + 1]);
        modes.push(mode);
        // Re-unroll within the leg: A* bodies come back on normalized longitude
        // and the realignment above only shifts by whole turns.
        const legPts = unroll(pts);
        for (let j = coordinates.length ? 1 : 0; j < legPts.length; j++) {
          coordinates.push([legPts[j][1], legPts[j][0]]);
        }
      }
      return { coordinates, modes };
    },

    /**
     * One leg, for the verifier and for callers that have already established
     * the frame. `a` and `b` must be in the SAME unrolled frame — see route().
     */
    leg(a, b) {
      const { pts, mode } = legGeometryLatLng(a, b);
      const unrolled = unroll(pts);
      return { coordinates: unrolled.map(([lat, lng]) => [lng, lat]), mode };
    },

    /** Escape hatch for the verifier, which compares against Leaflet's order. */
    legLatLng: legGeometryLatLng,

    /**
     * Kilometres from a coordinate to the nearest cell of the connected open
     * ocean — 0 when the coordinate already sits on one, Infinity when nothing
     * wet is within the 30-cell (~330 km) search radius.
     *
     * The mask is 0.1 deg, so a genuine sea port reads 0-15 km and anything
     * past ~40 km is either a river port a long way upstream or a "port" the
     * geocoder put on dry land. scripts/audit-port-locations.mjs uses it for
     * exactly that second case; see its landlocked check for the threshold and
     * the river-port exceptions.
     */
    seaAccessKm(lat, lng) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Infinity;
      const cell = nearestSeaCell(lat, lng);
      if (!cell) return Infinity;
      const [c, r] = cell;
      const sLat = cellLat(r), sLng = cellLng(c);
      const dLat = ((sLat - lat) * Math.PI) / 180;
      const dLng = (normLng(sLng - lng) * Math.PI) / 180;
      const h = Math.sin(dLat / 2) ** 2
        + Math.cos((lat * Math.PI) / 180) * Math.cos((sLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
    },
    isLandLL,
    lineHitsLand,
    polyHitsLand,
    cacheSize: () => cache.size,
  };
}

/**
 * Put a traced route into ONE longitude frame, in travel order.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The precomputed sea geometry deduplicates legs across trips: 45,011 raw legs
 * collapse to 8,025 unique ones, each tagged with the `tripIds` that use it
 * (see adapters/sea-geometry.ts). That is a real saving, and it quietly breaks
 * anything that spans the antimeridian.
 *
 * Each leg was unrolled — longitudes accumulated past ±180 so a Tokyo → Napa
 * crossing draws across the Pacific rather than back over Asia — inside the
 * frame of whichever trip happened to generate it. A leg shared by a voyage
 * that started in Southampton and one that started in Sydney can only be stored
 * in one of those frames. So a single world cruise's legs come back scattered
 * across several: measured on the shipped file, one collection's legs run from
 * lng -254 to +286, a span of 540°.
 *
 * Nothing about the DRAWING went wrong — Mapbox renders world copies, so the
 * route appears in every one. The camera is what broke. fitBounds over a 540°
 * span puts the centre at ~15°E and the zoom on the floor, which is a map of
 * Africa with a Pacific itinerary running off both edges: the "world cruise
 * loading broken in half" report, exactly.
 *
 * The same dedup also throws away leg ORDER ("legs render as separate
 * LineStrings, so their order does not matter" — true then, not any more) and
 * leg ORIENTATION. A dash animation that marches along the line needs both, or
 * the route animates in two directions at once, which is what the rail atlas
 * showed: track segments are stored in whichever direction the source drew
 * them, not the direction anyone travels.
 *
 * So this module does three things, in order, and every consumer of a traced
 * route goes through it:
 *
 *   1. wrap  every longitude back into [-180, 180)
 *   2. chain the legs into travel order, flipping any that run backwards,
 *      anchored on the itinerary's first stop
 *   3. unroll the whole chain continuously, so the route occupies one frame
 *
 * Ports and rail stations do not line up to the metre, so every match here is
 * nearest-endpoint rather than exact.
 */

/** [lng, lat]. */
export type Pt = [number, number];

export interface FrameLeg {
  mode: string;
  coordinates: Pt[];
}

/** Longitude into [-180, 180). */
export function wrapLng(lng: number): number {
  return (((lng + 180) % 360) + 360) % 360 - 180;
}

/**
 * Squared distance between two points, good enough for "which end is nearer".
 *
 * Longitude is scaled by cos(latitude) so that two points a degree apart in
 * Svalbard are not judged as far apart as two a degree apart on the equator —
 * without which the chain picks the wrong leg near the poles.
 */
function near(a: Pt, b: Pt): number {
  const dLat = a[1] - b[1];
  const dLng = wrapLng(a[0] - b[0]);
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return dLng * k * (dLng * k) + dLat * dLat;
}

/** Endpoints are "the same place" within roughly a degree. */
const SAME_PLACE = 1;

/**
 * Order and orient legs so the route runs from the first stop onward, then
 * unroll it into a single frame.
 *
 * `stops` is the itinerary in order and is what makes the result deterministic
 * on a round trip: the first and last leg both touch the departure port, so
 * proximity to the start alone cannot tell you which way round to go. The
 * second stop breaks that tie.
 */
export function frameRoute(legs: readonly FrameLeg[], stops?: readonly Pt[]): FrameLeg[] {
  const pool: FrameLeg[] = [];
  for (const leg of legs) {
    if (!leg?.coordinates || leg.coordinates.length < 2) continue;
    pool.push({
      mode: leg.mode,
      coordinates: leg.coordinates.map((c) => [wrapLng(c[0]), c[1]] as Pt),
    });
  }
  if (pool.length === 0) return [];

  const anchor = stops && stops.length ? ([wrapLng(stops[0][0]), stops[0][1]] as Pt) : null;
  // The next distinct stop — the direction the journey sets off in.
  let second: Pt | null = null;
  if (anchor && stops) {
    for (let i = 1; i < stops.length; i++) {
      const s: Pt = [wrapLng(stops[i][0]), stops[i][1]];
      if (near(s, anchor) > SAME_PLACE) { second = s; break; }
    }
  }

  const used = new Array<boolean>(pool.length).fill(false);
  const ordered: FrameLeg[] = [];
  let cursor: Pt | null = anchor;

  for (let placed = 0; placed < pool.length; placed++) {
    let pick = -1;
    let pickReversed = false;
    let best = Infinity;

    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      const c = pool[i].coordinates;
      if (cursor === null) { pick = i; pickReversed = false; best = 0; break; }
      const head = near(c[0], cursor);
      const tail = near(c[c.length - 1], cursor);
      const d = Math.min(head, tail);
      if (d < best) { best = d; pick = i; pickReversed = tail < head; }
    }
    if (pick < 0) break;

    /*
     * First leg only: several legs may touch the departure port (a round trip
     * leaves from and returns to it). Among those that do, take the one heading
     * for the second stop — otherwise the whole route can be traversed, and
     * animated, backwards.
     */
    if (placed === 0 && cursor && second) {
      let bestOnward = Infinity;
      for (let i = 0; i < pool.length; i++) {
        if (used[i]) continue;
        const c = pool[i].coordinates;
        const head = near(c[0], cursor);
        const tail = near(c[c.length - 1], cursor);
        if (Math.min(head, tail) > best + SAME_PLACE) continue; // not at the start
        const reversed = tail < head;
        const far = reversed ? c[0] : c[c.length - 1];
        const onward = near(far, second);
        if (onward < bestOnward) { bestOnward = onward; pick = i; pickReversed = reversed; }
      }
    }

    used[pick] = true;
    const leg = pool[pick];
    const coords = pickReversed ? [...leg.coordinates].reverse() : leg.coordinates;
    ordered.push({ mode: leg.mode, coordinates: coords });
    cursor = coords[coords.length - 1];
  }

  // Anything the chain could not reach (a genuinely disconnected segment) still
  // has to be drawn — append it rather than dropping geometry.
  for (let i = 0; i < pool.length; i++) if (!used[i]) ordered.push(pool[i]);

  return unrollChain(ordered);
}

/**
 * Unroll a chain so no step — within a leg OR across a leg boundary — jumps
 * more than 180°. After this the whole route lives in one continuous frame,
 * which is what makes a bounding box mean anything.
 */
function unrollChain(legs: FrameLeg[]): FrameLeg[] {
  let prev: number | null = null;
  return legs.map((leg) => {
    const out: Pt[] = [];
    for (const [lng, lat] of leg.coordinates) {
      let x = lng;
      if (prev !== null) {
        while (x - prev > 180) x -= 360;
        while (x - prev < -180) x += 360;
      }
      prev = x;
      out.push([x, lat]);
    }
    return { mode: leg.mode, coordinates: out };
  });
}

/**
 * The tightest longitude window containing every point, as unrolled values.
 *
 * For a loose CLOUD of points — a plotted shortlist, a set of ports with no
 * route between them — there is no chain to walk, so instead: sort the wrapped
 * longitudes, find the widest empty gap between neighbours on the circle, and
 * cut there. The complement of the largest gap is by definition the smallest
 * arc that contains everything.
 *
 * This is what stops a Fiji + Tokyo + Honolulu shortlist from being framed as
 * "the whole planet" because one is at +178 and another at -157.
 */
export function framePoints(points: readonly Pt[]): Pt[] {
  const pts: Pt[] = points
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [wrapLng(p[0]), p[1]] as Pt);
  if (pts.length < 2) return pts;

  const lngs = pts.map((p) => p[0]).sort((a, b) => a - b);
  let gapStart = lngs[lngs.length - 1];
  let widest = 360 + lngs[0] - lngs[lngs.length - 1]; // the wrap-around gap
  for (let i = 1; i < lngs.length; i++) {
    const gap = lngs[i] - lngs[i - 1];
    if (gap > widest) { widest = gap; gapStart = lngs[i - 1]; }
  }
  // Everything at or below the gap's near edge belongs to the far side of the
  // cut, so lift it a full turn — the window then runs continuously upward.
  return pts.map((p) => (p[0] <= gapStart ? ([p[0] + 360, p[1]] as Pt) : p));
}

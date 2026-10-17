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
  /**
   * Which itinerary hop this leg IS — 1 for the leg from stop 1 to stop 2, and
   * so on. Absent when nothing claimed it: a leg left over after the walk, or
   * any leg at all when there was no itinerary to walk (see chainGreedy).
   *
   * Drawing does not need it — a route is the same picture whichever leg is
   * which. Anything that has to TRAVEL the route does, because the two things
   * this file appends without ceremony are fatal to a camera: an orphan leg
   * that belongs to no hop, and a hop with no geometry at all. Concatenating
   * the legs and following the result flies the orphan as if it came next, and
   * cuts the missing hop as a straight line through whatever lies between —
   * which is how the route flight came to show a different journey from the one
   * drawn underneath it.
   */
  hop?: number;
  /**
   * [head, tail]: how many segments at each end of the leg are an approach over
   * LAND rather than water — a port whose nearest navigable water the sea
   * router could only reach across country (a river berth, an inland city, a
   * fjord narrower than its grid). Set at build time by build-sea-routes.mjs.
   *
   * Travelling the route uses the leg whole; drawing it does not. drawPieces
   * renders these segments as connectors so the bold line only claims water.
   * Head and tail follow the leg's orientation, so reversing a leg swaps them.
   */
  stub?: [number, number];
}

const flipStub = (s?: [number, number]): [number, number] | undefined => (s ? [s[1], s[0]] : undefined);

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

/**
 * How close EACH end of a leg must sit to its port for that leg to be the hop.
 *
 * Per-endpoint, not a sum of the two. That distinction is load-bearing: under a
 * summed score one perfect end masks a sloppy other end, and a hop between a
 * port and ITSELF — two nights in Capri — scores 0 on one side and so happily
 * claims the Sorrento→Capri leg, drawing it twice. Capped per endpoint, a leg
 * has to genuinely reach both ports, and a same-port hop matches nothing at all
 * (the build emits no zero-length legs), which is the correct answer without
 * needing a same-port special case anywhere.
 *
 * Legs are generated FROM the port coordinates, so a true match is near-exact
 * and this only has to cover the file's 3dp rounding. Keeping it tight is what
 * makes a missing leg read as missing rather than as licence to grab whichever
 * unrelated leg happens to be nearest.
 */
const HOP_MATCH = 0.01;

/**
 * Order and orient legs so the route runs in itinerary order, then unroll it
 * into a single frame.
 *
 * ── Why this walks the itinerary rather than the geometry ──────────────────
 *
 * This used to chain greedily: start at the first stop, repeatedly take the
 * nearest unused leg-end, and use the itinerary only to pick the very first
 * leg. That reads the day-by-day out of the geometry, and it cannot do so
 * reliably, because the two questions it has to answer with a distance
 * threshold are in direct conflict:
 *
 *   - "is this leg-end AT the departure port?" wants a LOOSE threshold, to
 *     absorb the difference between a port's listed coordinate and where the
 *     leg actually starts;
 *   - "is this the next distinct port, or the same one again?" wants a TIGHT
 *     one, because consecutive ports can be 5km apart.
 *
 * At the old threshold (~111km) an eight-day Riviera cruise lost both: every
 * port from Monte-Carlo to Toulon counted as "the same place", so the chain
 * started on day 3, ran to the end, and drew days 1-2 afterwards and backwards
 * — 46 of 362 yacht itineraries did not begin on day 1. Tightening it fixed
 * those but broke the genuinely close pairs instead. There is no value that
 * satisfies both.
 *
 * So: don't infer the order. The itinerary already IS the order. Walk it hop by
 * hop and, for each pair of consecutive ports, claim the leg whose two ends are
 * those two ports — oriented so it runs the way the ship sails. Day-by-day
 * order stops being something the geometry has to imply and becomes structural.
 *
 * `stops` is the itinerary in order. Without it (a bare cloud of legs, no
 * itinerary) there is nothing to walk, and the old greedy chain still runs.
 */
export function frameRoute(legs: readonly FrameLeg[], stops?: readonly Pt[]): FrameLeg[] {
  const pool: FrameLeg[] = [];
  for (const leg of legs) {
    if (!leg?.coordinates || leg.coordinates.length < 2) continue;
    pool.push({
      mode: leg.mode,
      coordinates: leg.coordinates.map((c) => [wrapLng(c[0]), c[1]] as Pt),
      stub: leg.stub,
    });
  }
  if (pool.length === 0) return [];

  const itinerary: Pt[] = (stops ?? []).map((s) => [wrapLng(s[0]), s[1]] as Pt);
  // A route with an itinerary behind it gets walked; anything else falls back.
  // So does an itinerary whose coordinates match no leg at all — better a
  // geometrically continuous route in an uncertain order than every leg piled
  // into the leftovers in source order.
  const walked = itinerary.length >= 2 ? chainByItinerary(pool, itinerary) : null;
  const ordered = walked && walked.placed > 0 ? walked.legs : chainGreedy(pool);

  return unrollChain(ordered);
}

/**
 * Claim one leg per itinerary hop, in order, oriented the way the ship sails.
 *
 * Returns how many legs the walk actually placed, so the caller can tell a
 * successful walk from one that matched nothing.
 */
function chainByItinerary(pool: FrameLeg[], stops: Pt[]): { legs: FrameLeg[]; placed: number } {
  const used = new Array<boolean>(pool.length).fill(false);
  const ordered: FrameLeg[] = [];
  let placed = 0;

  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1];
    const to = stops[i];

    /*
     * Note there is no "are these the same port?" test here, deliberately.
     *
     * Two nights in one port needs no special case: the build skips
     * zero-length legs, so nothing spans a port to itself and the search below
     * simply finds nothing. Adding a distance guard on top would be the very
     * mistake this rewrite removed — and it bites immediately, because some
     * itineraries name one place twice. Westmann Islands and Heimaey are the
     * same Icelandic harbour 1.1km apart under two spellings, as are East
     * Greenland and Tasiilaq at 2km; the geometry carries a real (if tiny) leg
     * between each pair. A same-port guard loose enough to fold those together
     * orphaned that leg, which then got appended after the finished route and
     * drew as a stray jump at the end of an otherwise clean world cruise.
     *
     * Letting the geometry answer the question keeps them in sequence.
     */

    // Prefer an unclaimed leg. Falling back to a claimed one covers the
    // out-and-back case: the shipped geometry deduplicates legs, so a voyage
    // that sails A→B→A has ONE stored leg for two crossings and genuinely
    // should draw it twice.
    const pick = bestLegFor(pool, used, from, to, true) ?? bestLegFor(pool, used, from, to, false);
    if (!pick) continue; // no geometry for this hop — leave the gap honest

    used[pick.i] = true;
    placed++;
    const c = pool[pick.i].coordinates;
    ordered.push({
      mode: pool[pick.i].mode,
      coordinates: pick.reversed ? [...c].reverse() : c,
      // The hop this leg was claimed FOR, so a consumer that has to travel the
      // route can tell a claimed leg from the leftovers appended below.
      hop: i,
      stub: pick.reversed ? flipStub(pool[pick.i].stub) : pool[pick.i].stub,
    });
  }

  // A leg no hop claimed still has to be drawn — append it rather than
  // silently dropping geometry.
  for (let i = 0; i < pool.length; i++) if (!used[i]) ordered.push(pool[i]);
  return { legs: ordered, placed };
}

/**
 * The leg that best spans `from` → `to`, and which way round it runs.
 *
 * `unclaimedOnly` restricts the search to legs no hop has taken yet.
 */
function bestLegFor(
  pool: FrameLeg[],
  used: boolean[],
  from: Pt,
  to: Pt,
  unclaimedOnly: boolean,
): { i: number; reversed: boolean } | null {
  let best: { i: number; reversed: boolean } | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < pool.length; i++) {
    if (unclaimedOnly && used[i]) continue;
    const c = pool[i].coordinates;
    const head = c[0];
    const tail = c[c.length - 1];
    // The WORSE of the two ends, so both have to reach — see HOP_MATCH.
    const forward = Math.max(near(head, from), near(tail, to));
    const reverse = Math.max(near(tail, from), near(head, to));
    const score = Math.min(forward, reverse);
    if (score < bestScore) { bestScore = score; best = { i, reversed: reverse < forward }; }
  }
  return bestScore <= HOP_MATCH ? best : null;
}

/**
 * The original nearest-endpoint chain, for routes with no itinerary to walk.
 *
 * Order and orientation here are whatever the geometry implies, which is the
 * best available answer when nothing states the intended sequence.
 */
function chainGreedy(pool: FrameLeg[]): FrameLeg[] {
  const used = new Array<boolean>(pool.length).fill(false);
  const ordered: FrameLeg[] = [];
  let cursor: Pt | null = null;

  for (let placed = 0; placed < pool.length; placed++) {
    let pick = -1;
    let pickReversed = false;
    let best = Infinity;
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      const c = pool[i].coordinates;
      if (cursor === null) { pick = i; pickReversed = false; break; }
      const head = near(c[0], cursor);
      const tail = near(c[c.length - 1], cursor);
      const d = Math.min(head, tail);
      if (d < best) { best = d; pick = i; pickReversed = tail < head; }
    }
    if (pick < 0) break;
    used[pick] = true;
    const coords = pickReversed
      ? [...pool[pick].coordinates].reverse()
      : pool[pick].coordinates;
    ordered.push({
      mode: pool[pick].mode,
      coordinates: coords,
      stub: pickReversed ? flipStub(pool[pick].stub) : pool[pick].stub,
    });
    cursor = coords[coords.length - 1];
  }
  for (let i = 0; i < pool.length; i++) if (!used[i]) ordered.push(pool[i]);
  return ordered;
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
    return { mode: leg.mode, coordinates: out, hop: leg.hop, stub: leg.stub };
  });
}

/**
 * Cut an unrolled line at every ±180° crossing, wrapping each piece into
 * [-180, 180].
 *
 * ── Why the DRAWING cannot use the unrolled frame ─────────────────────────
 *
 * unrollChain keeps a route continuous, which is what the camera needs — and a
 * world cruise that sails west from Miami all the way round to Southampton
 * comes out of it running from -80 to -370. Mapbox draws a GeoJSON line past
 * ±180 by wrapping it into a neighbouring world copy, and that holds for a
 * single turn. Past one turn it does not: the stretch beyond -360 (the whole
 * of Europe on that voyage) came back as straight lines from one edge of the
 * world to the other, at the latitude of each port — the "routes drawn across
 * Asia and Canada" bands on the World Cruises atlas.
 *
 * RFC 7946 is explicit that a line crossing the antimeridian should be split,
 * and split geometry is the one form every Mapbox projection and code path
 * renders the same way. So the source gets pieces in [-180, 180], cut exactly
 * at the meridian with the crossing latitude interpolated; the camera keeps the
 * continuous frame (lastFocusLegs), because a bounding box needs one frame.
 * Mercator's world copies make the cut invisible; the globe never had a seam.
 */
export function splitAntimeridian(coords: readonly (readonly [number, number])[]): Pt[][] {
  const copyOf = (lng: number) => Math.floor((lng + 180) / 360);
  const pieces: Pt[][] = [];
  let cur: Pt[] = [];
  let prev: readonly [number, number] | null = null;
  for (const p of coords) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const k = copyOf(p[0]);
    if (prev) {
      let kPrev = copyOf(prev[0]);
      while (kPrev !== k) {
        const dir = k > kPrev ? 1 : -1;
        // The meridian between this copy and the next, in the unrolled frame.
        const edge = dir > 0 ? kPrev * 360 + 180 : kPrev * 360 - 180;
        const f = (edge - prev[0]) / (p[0] - prev[0]);
        const lat = prev[1] + (p[1] - prev[1]) * f;
        cur.push([edge - kPrev * 360, lat]);
        pieces.push(cur);
        kPrev += dir;
        cur = [[edge - kPrev * 360, lat]];
      }
    }
    cur.push([p[0] - k * 360, p[1]]);
    prev = p;
  }
  pieces.push(cur);
  return pieces.filter((pc) => pc.length >= 2);
}

/**
 * What to draw for a framed route: its legs cut into map-safe pieces.
 *
 * Two cuts, both about drawing only. A leg's land approaches (`stub`) become
 * connector pieces, and every piece is split at the antimeridian. The result is
 * for a GeoJSON source and nothing else — anything that measures or travels the
 * route keeps reading the framed legs.
 */
export function drawPieces(legs: readonly FrameLeg[]): { mode: string; coordinates: Pt[] }[] {
  const out: { mode: string; coordinates: Pt[] }[] = [];
  for (const leg of legs) {
    const c = leg.coordinates;
    if (!c || c.length < 2) continue;
    const last = c.length - 1;
    const headEnd = Math.min(Math.max(0, leg.stub?.[0] ?? 0), last);
    const tailStart = Math.max(headEnd, last - Math.max(0, leg.stub?.[1] ?? 0));
    const parts: { mode: string; coordinates: Pt[] }[] = [];
    if (headEnd > 0) parts.push({ mode: "conn", coordinates: c.slice(0, headEnd + 1) });
    if (tailStart > headEnd) parts.push({ mode: leg.mode, coordinates: c.slice(headEnd, tailStart + 1) });
    if (tailStart < last) parts.push({ mode: "conn", coordinates: c.slice(tailStart) });
    for (const part of parts) {
      for (const piece of splitAntimeridian(part.coordinates)) out.push({ mode: part.mode, coordinates: piece });
    }
  }
  return out;
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

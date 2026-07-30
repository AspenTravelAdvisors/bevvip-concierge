/**
 * Route geometry for a set of Guide results — the home globe's "trace what was
 * just plotted" lookup.
 *
 * This lives here rather than inside AtlasShell for one reason: it is the part
 * that can fail SILENTLY. If a collection's result ids stop matching the keys in
 * its geometry index, pins still plot, the map still moves, nothing throws — the
 * routes simply never appear, and the only way to notice is to look. Extracted,
 * it can be asserted offline by scripts/verify-plot-routes.mjs against every
 * real offering in every collection.
 *
 * Geometry sources are D1's precomputed files, fetched per collection only when
 * a result of that type appears and cached thereafter.
 */

import { loadSeaRoutes } from "./sea-geometry";
import { loadRailGeometry, tripTrackLegs } from "./rail-geometry";

/** Collections with precomputed sea geometry. */
export const SEA_COLLECTIONS = new Set(["cruise", "yacht", "worldcruise"]);

/** Every collection this module can draw a route for. */
export const ROUTED_COLLECTIONS = new Set([...SEA_COLLECTIONS, "train"]);

export interface PlotLeg {
  mode: string;
  coordinates: [number, number][];
}

/**
 * The id forms to try, in order.
 *
 * Guide results may carry either the raw source id or the atlas's prefixed
 * alias (`yc_`, `wc_`, `cr_`, `rj_`, `jt_`, `h_`). The geometry indexes are keyed
 * on the RAW id — collection pages do `seaRoutes.get(o.id)` — so a prefixed id
 * must be unwrapped before lookup. Getting this wrong costs nothing visible
 * except the absence of every route.
 */
export function idCandidates(id: string): string[] {
  const m = /^(yc|wc|cr|rj|jt|h)_(.+)$/.exec(id);
  return m ? [id, m[2]] : [id];
}

/** Resolve one offering's legs from an already-loaded sea index. */
export function seaLegsFor(
  index: Map<string, { mode: string; coordinates: [number, number][] }[]>,
  id: string,
): PlotLeg[] | null {
  for (const cand of idCandidates(id)) {
    const legs = index.get(cand);
    if (legs?.length) return legs;
  }
  return null;
}

/** Resolve one offering's legs from already-loaded rail geometry. */
export function railLegsFor(
  geo: Parameters<typeof tripTrackLegs>[1],
  id: string,
): PlotLeg[] | null {
  for (const cand of idCandidates(id)) {
    const legs = tripTrackLegs(cand, geo);
    if (legs?.length) {
      // Rail legs carry `points` (branded LngLat) rather than `coordinates`,
      // and keep their own mode so the globe draws track symbology rather than
      // a plain line.
      return legs.map((l) => ({
        mode: l.mode,
        coordinates: l.points.map((pt) => [pt[0], pt[1]] as [number, number]),
      }));
    }
  }
  return null;
}

/**
 * Every drawable leg for a batch of results, grouped by collection.
 *
 * Jet is absent by design: it ships no precomputed geometry (its routes are
 * arced from stops a Guide result does not carry), so it stays pins-only rather
 * than being given an invented line.
 */
export async function legsForResults(
  byCollection: Map<string, string[]>,
): Promise<PlotLeg[]> {
  const out: PlotLeg[] = [];
  for (const [collection, ids] of byCollection) {
    if (!ROUTED_COLLECTIONS.has(collection)) continue;
    try {
      if (collection === "train") {
        const geo = await loadRailGeometry();
        for (const id of ids) {
          const legs = railLegsFor(geo, id);
          if (legs) out.push(...legs);
        }
      } else {
        const index = await loadSeaRoutes(collection);
        for (const id of ids) {
          const legs = seaLegsFor(index, id);
          if (legs) out.push(...legs);
        }
      }
    } catch {
      /* geometry is an enhancement — the pins are already plotted */
    }
  }
  return out;
}

/**
 * Precomputed sea route geometry — `public/maps/shared/sea-routes-<type>.json`.
 *
 * Built in Deliverable 1 by `scripts/build-sea-routes.mjs`: land-avoiding A*
 * over the 765 KB land mask, run once at build time so the browser gets
 * geometry instead of the mask and an A* implementation. See STATE.md D1.
 *
 * The file is a FeatureCollection of deduplicated legs — 45,011 raw legs across
 * the three sea collections collapse to 8,025 unique ones, because dozens of
 * voyages share the same Miami → George Town run. Each leg carries the
 * `tripIds` that use it, so a trip's route is "every leg tagged with my id".
 * Legs render as separate LineStrings, so their order does not matter.
 */

export interface SeaRouteLeg {
  mode: string;
  coordinates: [number, number][];
}

interface RawSeaRoutes {
  features?: {
    geometry?: { coordinates?: [number, number][] };
    properties?: { mode?: string; crossesLand?: boolean; tripIds?: (string | number)[] };
  }[];
}

const cache = new Map<string, Map<string, SeaRouteLeg[]>>();
const inflight = new Map<string, Promise<Map<string, SeaRouteLeg[]>>>();

/**
 * Load one collection's precomputed routes and index them by trip id.
 *
 * Returns an empty index rather than throwing: a collection without geometry
 * should still browse, falling back to straight legs between ports.
 */
export function loadSeaRoutes(collection: string): Promise<Map<string, SeaRouteLeg[]>> {
  const hit = cache.get(collection);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(collection);
  if (pending) return pending;

  const p = fetch(`/maps/shared/sea-routes-${collection}.json`, { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: RawSeaRoutes | null) => {
      const index = new Map<string, SeaRouteLeg[]>();
      for (const f of j?.features || []) {
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;
        // Sea legs are the voyage itself, so they draw as the collection's
        // primary line rather than the faint ferry-hop connector.
        const leg: SeaRouteLeg = { mode: "primary", coordinates: coords };
        for (const id of f.properties?.tripIds || []) {
          const key = String(id);
          const list = index.get(key);
          if (list) list.push(leg);
          else index.set(key, [leg]);
        }
      }
      cache.set(collection, index);
      return index;
    })
    .catch(() => new Map<string, SeaRouteLeg[]>());

  inflight.set(collection, p);
  return p;
}

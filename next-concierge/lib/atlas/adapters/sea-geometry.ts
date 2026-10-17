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
 * Order and orientation are restored per trip by lib/atlas/route-frame.ts.
 *
 * Not every leg is a voyage. The build tags the ones that are not, and they
 * are drawn as connectors (faint dashes) instead of the collection's line:
 *
 *   mode "transfer"  a hop no ship could sail as routed — a charter flight or
 *                    coach between two calls, or a strait the land mask cannot
 *                    see through. Shipped as a plain great circle.
 *   crossesLand      the router had no water route and drew over land anyway
 *                    (river cruises, excursions inland).
 *   stub             only the approach segments at either end cross land.
 */

export interface SeaRouteLeg {
  mode: string;
  coordinates: [number, number][];
  /** [head, tail] land-approach segment counts — see FrameLeg.stub. */
  stub?: [number, number];
}

interface RawSeaRoutes {
  features?: {
    geometry?: { coordinates?: [number, number][] };
    properties?: { mode?: string; crossesLand?: boolean; stub?: [number, number]; tripIds?: (string | number)[] };
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

  /*
   * `no-cache`, NOT `force-cache` — the rule the hotel feed already follows.
   *
   * force-cache serves whatever the browser has, however old, and never
   * revalidates. That was survivable while this file only changed on a human
   * deploy and nobody was looking at the shape of the lines. It stopped being
   * survivable the moment the land mask was rebuilt: the routes are correct on
   * the server and a returning visitor keeps being shown the ones that sail
   * over Brac, with no way to ask for the new ones short of clearing their
   * site data. AtlasShell already fetches this exact URL with `no-cache`, so
   * the two callers were disagreeing about the same file.
   *
   * Revalidation costs a conditional request; the server answers 304 when
   * nothing moved.
   */
  const p = fetch(`/maps/shared/sea-routes-${collection}.json`, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: RawSeaRoutes | null) => {
      const index = new Map<string, SeaRouteLeg[]>();
      for (const f of j?.features || []) {
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;
        // Sea legs are the voyage itself, so they draw as the collection's
        // primary line rather than the faint ferry-hop connector — unless the
        // build says this one is not a voyage (see the header).
        const props = f.properties;
        const sailed = props?.mode !== "transfer" && !props?.crossesLand;
        const leg: SeaRouteLeg = { mode: sailed ? "primary" : "conn", coordinates: coords };
        if (sailed && Array.isArray(props?.stub)) leg.stub = [Number(props.stub[0]) || 0, Number(props.stub[1]) || 0];
        for (const id of props?.tripIds || []) {
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

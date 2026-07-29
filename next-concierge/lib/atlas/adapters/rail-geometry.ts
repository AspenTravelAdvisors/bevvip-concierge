/**
 * Real rail track geometry — public/maps/train/data/rail-routes.json.
 *
 * Trains follow tracks. They do not fly great-circle arcs between stations, and
 * a rail atlas that draws them as arcs is drawing a lie: the Glasgow → Fort
 * William leg is a specific 88-point curve up the West Highland Line, not a
 * bezier over Loch Lomond.
 *
 * The file is a shared leg pool so trips that share track share bytes:
 *
 *   legs  { "lat,lng|lat,lng": { m: "rail"|"road"|"arc", p: [[lat,lng], …] } }
 *   trips { tripId: [{ k: legKey, rev: 0|1 }, …] }
 *
 * `rev` reverses a leg the trip travels the other way — which is why the pool
 * can be keyed on an unordered station pair. 269 legs, 23,541 points, 134 of
 * the 135 trips covered.
 *
 * `m` matters for drawing: "rail" earns the track symbology, while "road" and
 * "arc" are ferry / transfer / short-hop connectors the original renders as an
 * honest dashed line rather than pretending they are track.
 */

import { fromLatLngPair, isFinitePair, type LngLat } from "@/lib/atlas/geo";

export type LegMode = "rail" | "road" | "arc";

export interface RouteLeg {
  mode: LegMode;
  points: LngLat[];
}

interface RawRailGeo {
  legs?: Record<string, { m?: string; p?: [number, number][] }>;
  trips?: Record<string, { k: string; rev?: 0 | 1 | boolean }[]>;
}

let cache: RawRailGeo | null = null;
let inflight: Promise<RawRailGeo | null> | null = null;

/** Fetch once per session; the file is ~455 KB and CDN-cached. */
export function loadRailGeometry(): Promise<RawRailGeo | null> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/maps/train/data/rail-routes.json", { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: RawRailGeo | null) => { cache = j; return j; })
    .catch(() => null);
  return inflight;
}

/**
 * Track geometry for one trip, in [lng, lat], or null when the trip has none.
 * Callers fall back to drawing straight legs between stops.
 */
export function tripTrackLegs(tripId: string, geo: RawRailGeo | null): RouteLeg[] | null {
  const refs = geo?.trips?.[tripId];
  if (!refs || !geo?.legs) return null;
  const out: RouteLeg[] = [];
  for (const ref of refs) {
    const leg = geo.legs[ref.k];
    if (!leg?.p?.length) continue;
    const pts = ref.rev ? [...leg.p].reverse() : leg.p;
    const points = pts.filter(isFinitePair).map(fromLatLngPair);
    if (points.length < 2) continue;
    const mode: LegMode = leg.m === "rail" ? "rail" : leg.m === "road" ? "road" : "arc";
    out.push({ mode, points });
  }
  return out.length ? out : null;
}

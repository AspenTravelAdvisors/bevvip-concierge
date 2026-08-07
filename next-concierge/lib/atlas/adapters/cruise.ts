/**
 * Expedition Cruises — the outlier, and the last of the five.
 *
 * Everything about this collection is its own case, which is why it is ported
 * last and why it does not reuse voyage.ts:
 *
 *   source      COLUMNAR. public/maps/cruise/sailings.json is
 *               `{schema: [...names], rows: [[...values]]}` — 3,542 rows
 *               expanded through the schema index — plus atlas-meta.json for
 *               OPERATORS/REGIONS and data/itinerary-routes.json for geometry.
 *   brand       there is none. It filters on `operator`, and its Share button
 *               emits `operator=` where its siblings emit `brand=`.
 *   region      a SCALAR display name ("Hawaii & Tahiti"), not a key array —
 *               and it is REWRITTEN, because the feed's region column is a
 *               marketing bucket rather than a place. region-overrides.json
 *               (scripts/build-cruise-regions.mjs) carries every sailing's
 *               region, read off its own geocoded ports; the title rules in
 *               correctedRegionName() remain as the fallback for a feed row the
 *               overlay has not seen. Filtering on the raw column value puts
 *               Chilean fjords under Norway.
 *   past cutoff `s.start >= today` on an ISO string, so a dateless sailing is
 *               dropped (see requiresStartDate) rather than kept.
 *   stops       ONLY geocoded ports count. 712 of 3,542 sailings have a route
 *               whose ports are all un-geocoded, giving them an empty port set
 *               — the port filter genuinely cannot match them. yacht behaves
 *               the opposite way, counting every named call.
 *   haystack    [name, operator, ship, region] only. No ports, no brand.
 *
 * Coordinate with WORKORDER-expedition-ship-data.md, which is changing the ship
 * filter for this collection.
 */

import { fromLatLngPair, isFinitePair } from "@/lib/atlas/geo";
import { norm } from "./search";
import { endFrom } from "@/lib/atlas/dates";
import type { AtlasFilterDescriptor, AtlasOffering, AtlasStop } from "./types";

export const CRUISE_DESCRIPTOR: AtlasFilterDescriptor = {
  collection: "cruise",
  stopParam: "port",
  stopRoleParam: "portrole",
  // The only voyage vocabulary that also accepts "any".
  roles: "voyageAny",
  brandField: "operator",
  brandParam: "operator",
  supportsRegionExclusion: false,
  supportsVesselFilter: true,
  idPrefix: "cr_",
  requiresStartDate: true, // `null >= today` is false — dateless rows drop out
};

export interface RawCruiseSailings {
  schema?: string[];
  urlBase?: string;
  productBase?: string;
  rows?: unknown[][];
}
export interface RawCruiseMeta {
  OPERATORS?: Record<string, unknown>;
  REGIONS?: Record<string, { name?: string; coord?: [number, number] }>;
}
export interface RawCruiseRoutes {
  routes?: Record<string, { d?: number; s?: number; p?: [string, number | null, number | null][] }[]>;
}
/** region-overrides.json — every sailing's region, grouped by region name. */
export interface RawCruiseRegionOverrides {
  byRegion?: Record<string, string[]>;
}

/**
 * Region rewrite from the sailing NAME, for sailings the overlay has not seen
 * (a feed row added since the last `build-cruise-regions` run). The overlay
 * covers these same cases and more, from the itinerary's geocoded ports; this
 * is the floor, not the mechanism. Dropping it silently moves Alaska, Baja,
 * Seychelles, Caribbean, Patagonia and Northwest Passage sailings into whatever
 * the feed happened to say.
 */
export function correctedRegionName(region: string, name: string): string {
  const t = norm(name);
  // Antarctica boards in Patagonia, so it is settled before anything southern.
  if (/antarctic|south georgia/.test(t)) return "Antarctica";
  if (t.includes("northwest passage")) return "Northwest Passage";
  if (t.includes("alaska")) return "Alaska & Yukon";
  if (t.includes("baja") || t.includes("sea of cortez")) return "Baja California";
  if (t.includes("seychelles")) return "Africa & Indian Ocean";
  if (/chilean fjord|patagonia|torres del paine|strait of magellan/.test(t)) return "Patagonia & Chilean Fjords";
  if (/iceland|greenland|svalbard|spitsbergen/.test(t) && !t.includes("norway") && !t.includes("norwegian")) return "Arctic";
  if (t.includes("caribbean")) return "Caribbean & Bermuda";
  return region;
}

export function adaptCruise(
  sailings: RawCruiseSailings,
  _meta: RawCruiseMeta,
  routes: RawCruiseRoutes,
  regionOverrides?: RawCruiseRegionOverrides,
): AtlasOffering[] {
  const schema = sailings.schema || [];
  const idx: Record<string, number> = {};
  schema.forEach((n, i) => { idx[n] = i; });
  const ROUTES = routes.routes || {};
  // Grouped by region on the wire, inverted here into id → region.
  const REGION_BY_ID: Record<string, string> = {};
  for (const [region, ids] of Object.entries(regionOverrides?.byRegion || {})) {
    for (const id of ids) REGION_BY_ID[id] = region;
  }
  const urlBase = sailings.urlBase || "";
  const out: AtlasOffering[] = [];

  for (const row of sailings.rows || []) {
    const get = (n: string) => (idx[n] == null ? undefined : row[idx[n]]);
    const id = get("id");
    if (id == null) continue;
    const sid = String(id);
    const name = String(get("name") ?? "");
    const operator = (get("operator") as string) || null;
    const ship = (get("ship") as string) || null;
    const start = (get("start") as string) || null;
    const nights = get("nights");
    const region = REGION_BY_ID[sid] || correctedRegionName(String(get("region") ?? ""), name);
    const slug = get("slug") as string | undefined;

    // Only geocoded ports participate — sailingStops() drops p[1]/p[2] nulls,
    // and sea days carry no name at all.
    const days = ROUTES[sid] || [];
    const stops: AtlasStop[] = [];
    for (const day of days) {
      for (const p of day.p || []) {
        const [pname, lat, lng] = p;
        if (lat == null || lng == null || !isFinitePair([lat, lng])) continue;
        stops.push({ name: pname, region: null, at: fromLatLngPair([lat, lng]), day: day.d ?? null });
      }
    }

    const monthKey = start ? `${start.slice(0, 4)}-${start.slice(5, 7)}` : null;

    out.push({
      id: sid,
      idAliases: [sid, `${CRUISE_DESCRIPTOR.idPrefix}${sid}`],
      collection: "cruise",
      title: name,
      brand: null, // cruise has no brand concept
      brandLabel: operator,
      operator,
      // Scalar region normalized to a 1-element array so one predicate serves
      // every collection.
      regions: region ? [region] : [],
      months: monthKey ? [monthKey] : [],
      onDemand: false,
      window: null,
      startDate: start,
      // Expedition sailings store no end date, only `nights` — so derive it,
      // counting in NIGHTS not days: a 7-night sailing boarding the 1st
      // disembarks on the 8th, not the 7th. `days` below is the same number
      // under the collection's existing (looser) label; only the arithmetic
      // here depends on the distinction.
      endDate: endFrom(start, { nights: typeof nights === "number" ? nights : null }),
      days: typeof nights === "number" ? nights : null,
      departures: null,
      country: null,
      vessel: ship,
      stops,
      path: stops.map((s) => s.at!).filter(Boolean),
      itinerary: (() => {
        const rows: AtlasOffering["itinerary"] = [];
        for (const day of days) {
          for (const p of day.p || []) {
            const n = String(p[0] || "").trim();
            if (!n) continue;
            const last = rows[rows.length - 1];
            if (last && last.name === n) last.endDay = day.d ?? last.endDay;
            else rows.push({ name: n, startDay: day.d ?? null, endDay: day.d ?? null });
          }
        }
        return rows;
      })(),
      url: slug ? `${urlBase}${sid}/${slug}` : null,
      world: false,
      searchText: norm([name, operator, ship, region].filter(Boolean).join(" ")),
    });
  }

  return out;
}

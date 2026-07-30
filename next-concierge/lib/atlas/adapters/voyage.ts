/**
 * Shared adapter for the voyages family — hotel yachts, world cruises, and
 * (with more config) expedition cruises.
 *
 * Sibling of journey.ts. The two families look alike and are not:
 *
 *   stop names   journeys collapse CONSECUTIVE duplicates (a trip that sits
 *                three nights in Edinburgh lists it three times); voyages do
 *                NOT — they trim and keep every entry. A voyage calling at
 *                Nassau twice legitimately has two entries.
 *   fallback     voyages fall back to [from, to] when the itinerary carries no
 *                named calls; journeys have no such fallback.
 *   haystack     voyages index title, brand, SHIP, route, from, to and region
 *                names — and NOT the port names. Journeys do index their stop
 *                names. Searching a port therefore finds nothing in the yacht
 *                atlas today; that is existing behaviour, faithfully kept.
 *   past cutoff  voyages carry startY/startM/startD; journeys parse a
 *                US-format string.
 *
 * Coordinates come from a shared PORTS map rather than a per-trip route.
 */

import { fromLatLngPair, isFinitePair, type LngLat } from "@/lib/atlas/geo";
import { norm } from "./search";
import type { AtlasFilterDescriptor, AtlasOffering, AtlasStop } from "./types";

export interface RawVoyageBrand { short?: string; domain?: string; color?: string }
export interface RawVoyageRegion { name?: string; ab?: string; coord?: [number, number] }
export interface RawVoyageTrip {
  id?: string | number;
  title?: string;
  ship?: string;
  brand?: string;
  operator?: string;
  dates?: string;
  startY?: number;
  startM?: number;
  startD?: number;
  monthKey?: string;
  days?: number;
  from?: string;
  to?: string;
  route?: string;
  g?: string[];
  u?: string;
  /** Port calls; `{s:1}` marks a sea day and carries no name. */
  itin?: { n?: string; d?: number; s?: number }[];
}
export interface RawVoyageAtlas {
  BRANDS?: Record<string, RawVoyageBrand>;
  REGIONS?: Record<string, RawVoyageRegion>;
  PORTS?: Record<string, [number, number]>;
  TRIPS?: RawVoyageTrip[];
}

/** `{startY, startM, startD}` → ISO. Voyages store the parts, not a string. */
function toIso(t: RawVoyageTrip): string | null {
  if (!t.startY || !t.startM || !t.startD) return null;
  return `${t.startY}-${String(t.startM).padStart(2, "0")}-${String(t.startD).padStart(2, "0")}`;
}

/**
 * Port names in itinerary order, verbatim from `tripPortRoles()`: trimmed,
 * empties dropped, NO consecutive de-duplication, falling back to [from, to]
 * when the itinerary names nothing.
 */
export function voyageStopNames(t: RawVoyageTrip): string[] {
  let names: string[] = [];
  if (t.itin && t.itin.length) {
    names = t.itin.filter((e) => e?.n).map((e) => String(e.n || "").trim()).filter(Boolean);
  }
  if (!names.length) {
    names = [t.from, t.to].map((n) => String(n || "").trim()).filter(Boolean);
  }
  return names;
}

export function adaptVoyage(
  raw: RawVoyageAtlas,
  d: AtlasFilterDescriptor,
): AtlasOffering[] {
  const BRANDS = raw.BRANDS || {};
  const REGIONS = raw.REGIONS || {};
  const PORTS = raw.PORTS || {};
  const out: AtlasOffering[] = [];

  for (const trip of raw.TRIPS || []) {
    if (!trip || trip.id == null) continue;
    const id = String(trip.id);
    const brandKey = trip.brand || null;
    const brandLabel = (brandKey && BRANDS[brandKey]?.short) || null;
    const regions = Array.isArray(trip.g) ? trip.g.filter(Boolean) : [];

    // Every named call is kept, coordinates or not — the port filter matches on
    // names and PORTS does not cover every call. See AtlasStop.at.
    const names = voyageStopNames(trip);
    const dayOf = new Map<string, number>();
    for (const e of trip.itin || []) {
      const n = String(e?.n || "").trim();
      if (n && typeof e.d === "number" && !dayOf.has(n)) dayOf.set(n, e.d);
    }
    const stops: AtlasStop[] = names.map((name) => {
      const ll = PORTS[name];
      return {
        name,
        region: null, // voyages don't tag calls with a region
        at: isFinitePair(ll) ? fromLatLngPair(ll) : null,
        day: dayOf.get(name) ?? null,
      };
    });
    const path = stops
      .filter((s): s is AtlasStop & { at: LngLat } => s.at !== null)
      .map((s) => s.at);

    // Haystack, matching textMatches() exactly. Note the ABSENCE of port names:
    // the yacht/worldcruise atlases do not index their calls, so searching
    // "Santorini" finds nothing. Faithful to the original.
    const regionNames = regions.map((k) => REGIONS[k]?.name).filter(Boolean) as string[];
    const searchText = norm(
      [trip.title, brandLabel, trip.ship, trip.route, trip.from, trip.to, ...regionNames]
        .filter(Boolean)
        .join(" "),
    );

    out.push({
      id,
      idAliases: [id, `${d.idPrefix}${id}`],
      collection: d.collection,
      title: trip.title || "Voyage",
      brand: brandKey,
      brandLabel,
      operator: trip.operator || brandLabel,
      regions,
      // Voyages carry a single month key; normalized to an array so one
      // predicate serves both families.
      months: trip.monthKey ? [trip.monthKey] : [],
      onDemand: false, // no voyage has an on-demand escape from the month filter
      window: null,
      startDate: toIso(trip),
      endDate: null,
      days: typeof trip.days === "number" ? trip.days : null,
      departures: null,
      country: null,
      vessel: trip.ship || null,
      stops,
      path,
      itinerary: (() => {
        const rows: AtlasOffering["itinerary"] = [];
        for (const e of trip.itin || []) {
          const n = String(e?.n || "").trim();
          if (!n) continue;
          const last = rows[rows.length - 1];
          if (last && last.name === n) last.endDay = e.d ?? last.endDay;
          else rows.push({ name: n, startDay: e.d ?? null, endDay: e.d ?? null });
        }
        return rows;
      })(),
      url: trip.u || null,
      world: false,
      searchText,
    });
  }

  return out;
}

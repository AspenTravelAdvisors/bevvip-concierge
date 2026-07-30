/**
 * Shared adapter for the journeys family — rail and private jet.
 *
 * Both Leaflet atlases run a normalisation pass over TRIPS at load
 * (`TRIPS.forEach((t,i) => …)`) before any filtering happens. Everything that
 * pass does has to happen here too, or the ported filter is reading fields the
 * original never filtered on:
 *
 *   guideId   assigned, and for jet it is the ONLY working id alias
 *   cities    pulled from ROUTES and fed into the search haystack
 *   g         back-filled from the route's region keys
 *   mk / mks  month keys COMPUTED from the US-format departure date
 *
 * The two atlases differ on two of those rules, which live in the descriptor
 * (`regionDerivation`, `idStrategy`) rather than in branches here.
 */

import { fromLatLngPair, isFinitePair, type LngLat } from "@/lib/atlas/geo";
import { norm } from "./search";
import type { AtlasFilterDescriptor, AtlasOffering, AtlasStop } from "./types";

export interface RawJourneyBrand { short?: string; domain?: string; color?: string }
export interface RawJourneyRegion { name?: string; ab?: string; coord?: [number, number] }
export interface RawJourneyStop { n?: string; r?: string; ll?: [number, number] }
export interface RawJourneyTrip {
  id?: string | number;
  n?: string;
  b?: string;
  g?: string[];
  u?: string;
  days?: number;
  from?: string;
  to?: string;
  country?: string;
  train?: string;
  world?: boolean;
  onDemand?: boolean;
  win?: string;
  itin?: { d?: number; n?: string; date?: string }[];
  route?: string;
  d?: string;
  r?: string;
  mks?: string[];
  depCount?: number;
  guideId?: string;
}
export interface RawJourneyAtlas {
  BRANDS?: Record<string, RawJourneyBrand>;
  REGIONS?: Record<string, RawJourneyRegion>;
  ROUTES?: Record<string, RawJourneyStop[]>;
  TRIPS?: RawJourneyTrip[];
}

/** Verbatim from the atlases' `tripSlug()`. Used to find a route by title. */
export function tripSlug(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dedupeOrder<T>(list: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of list) if (v != null && !seen.has(v)) { seen.add(v); out.push(v); }
  return out;
}

/** "7/20/2026" → "2026-07-20". The source stores US format throughout. */
function toIso(us: string | undefined): string | null {
  if (!us) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(us.trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** "7/20/2026" → "2026-07". Mirrors the atlases' inline `t.mk` computation. */
function monthKey(us: string | undefined): string | null {
  if (!us) return null;
  const p = us.split("/");
  if (p.length !== 3) return null;
  return `${p[2]}-${String(Number(p[0])).padStart(2, "0")}`;
}

/**
 * Ordered stop names with CONSECUTIVE duplicates collapsed. A trip that sits
 * three nights in Edinburgh lists it three times; the original dedupes only
 * neighbours, so a trip returning to its origin keeps both visits — which is
 * what makes `start` and `end` distinguishable.
 */
function orderedStopNames(trip: RawJourneyTrip): string[] {
  const names: string[] = [];
  for (const e of trip.itin || []) {
    if (e?.n && names[names.length - 1] !== e.n) names.push(e.n);
  }
  return names;
}

/**
 * Consecutive same-name itinerary entries collapsed into day ranges — verbatim
 * from `itineraryRanges()`. Note it merges only NEIGHBOURS, so a trip returning
 * to a city later in the trip gets two rows, correctly.
 */
function itineraryRanges(trip: RawJourneyTrip) {
  const rows: {
    name: string; startDay: number | null; endDay: number | null;
    startDate?: string | null; endDate?: string | null;
  }[] = [];
  for (const e of trip.itin || []) {
    if (!e?.n) continue;
    const last = rows[rows.length - 1];
    if (last && last.name === e.n) {
      last.endDay = e.d ?? last.endDay;
      last.endDate = e.date || last.endDate;
    } else {
      rows.push({
        name: e.n, startDay: e.d ?? null, endDay: e.d ?? null,
        startDate: e.date || null, endDate: e.date || null,
      });
    }
  }
  return rows;
}

/** First itinerary day each stop appears on, for the traced-route labels. */
function firstDayByStop(trip: RawJourneyTrip): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of trip.itin || []) {
    if (e?.n && typeof e.d === "number" && !m.has(e.n)) m.set(e.n, e.d);
  }
  return m;
}

export function adaptJourney(
  raw: RawJourneyAtlas,
  d: AtlasFilterDescriptor,
): AtlasOffering[] {
  const BRANDS = raw.BRANDS || {};
  const REGIONS = raw.REGIONS || {};
  const ROUTES = raw.ROUTES || {};
  const TRIPS = raw.TRIPS || [];
  const out: AtlasOffering[] = [];

  TRIPS.forEach((trip, i) => {
    if (!trip) return;

    // ── the atlases' load-time normalisation, reproduced ──────────────────
    // Route lookup: explicit key first, then the slugged title. 65 of jet's
    // 141 trips resolve only via the slug, and 33 have no route at all.
    const routeKey =
      trip.route && ROUTES[trip.route] ? trip.route
      : ROUTES[tripSlug(trip.n)] ? tripSlug(trip.n)
      : null;
    const cities: RawJourneyStop[] = routeKey ? ROUTES[routeKey] || [] : [];

    const curated = Array.isArray(trip.g) ? trip.g.filter(Boolean) : [];
    let regions = curated;
    if (cities.length) {
      const fromRoute = dedupeOrder(cities.map((c) => c.r).filter(Boolean) as string[]);
      if (d.regionDerivation === "whenRouted") {
        // jet: an explicit route overrides the curated list entirely.
        if (trip.route || !curated.length) regions = fromRoute;
      } else {
        // train: only back-fill when there is nothing curated.
        if (!curated.length) regions = fromRoute;
      }
    }

    const mk = monthKey(trip.d);
    const months = trip.mks && trip.mks.length
      ? trip.mks.filter(Boolean)
      : mk ? [mk] : [];

    // ── identity ─────────────────────────────────────────────────────────
    // jet has no id field; its atlas assigns guideId = 'jt_' + arrayIndex, and
    // that is the only alias an ids= link can match, because String(undefined)
    // and 'jt_undefined' match nothing. See AtlasFilterDescriptor.idStrategy.
    const useIndex = d.idStrategy === "index";
    const id = useIndex ? String(i) : String(trip.id ?? i);
    const guideId = trip.guideId ?? `${d.idPrefix}${useIndex ? i : trip.id}`;
    const aliases = useIndex
      ? [guideId]
      : dedupeOrder([id, `${d.idPrefix}${id}`, guideId]);

    // ── projection ───────────────────────────────────────────────────────
    const brandKey = trip.b || null;
    const brandLabel = (brandKey && BRANDS[brandKey]?.short) || null;
    const names = orderedStopNames(trip);

    const byName = new Map<string, RawJourneyStop>();
    for (const c of cities) if (c?.n && !byName.has(c.n)) byName.set(c.n, c);

    // EVERY named stop is kept, coordinates or not. The stop filter matches on
    // names and the originals read t.itin directly, so discarding a stop for
    // want of geometry would break `location=` for the 33 jet trips that name
    // their stops but ship no route. Those trips are all past-dated today,
    // which is exactly why this went unnoticed until the harness pinned an
    // early date — a feed refresh would have surfaced it as missing results.
    const dayOf = firstDayByStop(trip);
    const stops: AtlasStop[] = names.map((name) => {
      const hit = byName.get(name);
      return {
        name,
        region: hit?.r ?? null,
        at: hit && isFinitePair(hit.ll) ? fromLatLngPair(hit.ll) : null,
        day: dayOf.get(name) ?? null,
      };
    });

    // Drawable geometry: the located stops in itinerary order, or the route's
    // own order when the itinerary names don't line up with it.
    const located = stops.filter((s): s is AtlasStop & { at: LngLat } => s.at !== null);
    const path: LngLat[] = located.length
      ? located.map((s) => s.at)
      : cities.filter((c) => isFinitePair(c.ll)).map((c) => fromLatLngPair(c.ll!));

    // Haystack, matching textMatches() exactly: title, brand short name, the
    // RAW date string, region display names, city names from the route, and
    // every itinerary stop name.
    const regionNames = regions.map((k) => REGIONS[k]?.name).filter(Boolean) as string[];
    const cityNames = cities.map((c) => c.n).filter(Boolean) as string[];
    const searchText = norm(
      [trip.n, brandLabel, trip.d, ...regionNames, ...cityNames, ...names]
        .filter(Boolean)
        .join(" "),
    );

    out.push({
      id,
      idAliases: aliases,
      collection: d.collection,
      title: trip.n || "Journey",
      brand: brandKey,
      brandLabel,
      operator: brandLabel,
      regions,
      months,
      onDemand: !!trip.onDemand,
      window: trip.win || null,
      startDate: toIso(trip.d),
      endDate: toIso(trip.r),
      days: typeof trip.days === "number" ? trip.days : null,
      departures: typeof trip.depCount === "number" ? trip.depCount : null,
      country: trip.country || null,
      vessel: trip.train || null, // rail names its train; jet has no aircraft field
      stops,
      path,
      itinerary: itineraryRanges(trip),
      url: trip.u || null,
      world: !!trip.world,
      searchText,
    });
  });

  return out;
}

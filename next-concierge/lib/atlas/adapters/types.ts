/**
 * The common shape every retired Leaflet atlas normalizes into.
 *
 * The work order sketches `{ id, title, brand, operator, region, month,
 * startDate, ports, url }`. That is not enough: D3-FILTER-INVENTORY.md shows the
 * five atlases filter on things that sketch omits — region *exclusion*, an
 * `onDemand` free pass on the month filter, ship/train names, prefixed id
 * aliases, and a search tokeniser that folds `country` into `q`. A shape that
 * can't express those would force per-collection special cases right back into
 * the UI, which is the thing D3 exists to remove.
 *
 * So: singular fields become plural where any atlas needs plural, and the
 * per-collection differences live in AtlasFilterDescriptor rather than in code.
 */

import type { LngLat } from "@/lib/atlas/geo";

/**
 * One call/stop on an itinerary, in map order.
 *
 * `at` is NULLABLE on purpose. The stop filter (`location=` / `port=`) matches
 * on NAMES, and the originals read the raw itinerary — 33 of jet's 141 trips
 * name their stops but have no route geometry at all. Dropping those stops for
 * want of a coordinate would silently break the stop filter for them, so every
 * named stop is kept and only the drawable ones contribute to `path`.
 */
export interface AtlasStop {
  name: string;
  /** Region key this stop belongs to, when the source supplies one. */
  region?: string | null;
  /** null when the source names the stop but gives no coordinates. */
  at: LngLat | null;
  /**
   * Itinerary day number, where the source gives one. The Leaflet atlases
   * label a traced route's stops "3. Day 4 · Inverness", so the day is part of
   * the stop, not decoration.
   */
  day?: number | null;
}

export interface AtlasOffering {
  /** Raw source id. */
  id: string;
  /**
   * Every string an `ids=` deep link may legitimately use for this offering —
   * the raw id plus the atlas's prefixed form (`rj_`, `jt_`, `yc_`, `wc_`,
   * `cr_`) and any guideId. Match against this, never against `id` alone, or
   * every shared link and every Guide deep link breaks.
   */
  idAliases: string[];
  /** Collection this belongs to: train | jet | yacht | worldcruise | cruise. */
  collection: string;
  title: string;

  /**
   * Brand key. train/jet store it in `t.b`, yacht/worldcruise in `t.brand`.
   * cruise has no brand at all and filters on `operator` instead — see the
   * descriptor's `brandField`.
   */
  brand: string | null;
  brandLabel: string | null;
  operator: string | null;

  /**
   * Region keys. train/jet/yacht/worldcruise carry an array (`t.g`); cruise
   * carries a single scalar (`s.region`), which normalizes to a 1-element
   * array so one predicate serves all five.
   */
  regions: string[];

  /**
   * Month keys (`YYYY-MM`). train has an array (`t.mks`), jet has a scalar
   * (`t.mk`), the voyages have a scalar (`t.monthKey`). All normalize to an
   * array.
   */
  months: string[];
  /**
   * On-demand offerings have no fixed departure and pass the month filter
   * unconditionally, sorting to the bottom of every selected month. Journeys
   * only — the voyages have no equivalent.
   */
  onDemand: boolean;
  /** Human window for on-demand trips, e.g. "Jan 2026 – Dec 2027". */
  window: string | null;

  /** ISO `YYYY-MM-DD` where the source gives a real departure, else null. */
  startDate: string | null;
  endDate: string | null;
  days: number | null;
  /** Number of departures behind a single listed trip, where the source has it. */
  departures: number | null;

  country: string | null;
  /** Ship, named train, or aircraft programme — whatever the collection's vessel is. */
  vessel: string | null;

  /** Ordered itinerary stops. Empty when the source has no route for this trip. */
  stops: AtlasStop[];
  /** Route geometry for drawing. Sea collections get this precomputed. */
  path: LngLat[];

  /**
   * Consecutive itinerary days collapsed into ranges, for the day-by-day block
   * on a card: [{name, startDay, endDay, startDate, endDate}]. A trip that sits
   * three nights in Edinburgh becomes one "Days 6-8 · Edinburgh" row, which is
   * what `itineraryRanges()` produced in the originals.
   */
  itinerary: {
    name: string;
    startDay: number | null;
    endDay: number | null;
    startDate?: string | null;
    endDate?: string | null;
  }[];

  /** Detail/booking URL on the supplier, when present. */
  url: string | null;
  /** Marketing flag: journeys tag round-the-world itineraries (`world=1`). */
  world: boolean;

  /**
   * Pre-normalized search haystack. The Leaflet atlases build search terms from
   * `q` AND `country` through a `words()` tokeniser that strips a domain
   * stop-list ("cruise", "yacht", "voyage", "ship", "luxury", …). Reproduce that
   * tokeniser exactly or results drift silently.
   */
  searchText: string;
}

/** Which `*role` vocabulary a collection's stop filter accepts. */
export type RoleVocabulary = "journey" | "voyage" | "voyageAny";

/**
 * Per-collection filter configuration. This is what lets one filter component
 * serve five collections without five bespoke rails.
 */
export interface AtlasFilterDescriptor {
  collection: string;
  /** Query param that carries the stop filter: `location` or `port`. */
  stopParam: "location" | "port";
  /** Param carrying the stop role: `locationrole` or `portrole`. */
  stopRoleParam: "locationrole" | "portrole";
  /**
   * Accepted role strings. These differ per family and MUST be passed through
   * verbatim — see D3-FILTER-INVENTORY.md:
   *   journey    any | start | end | stop | visit
   *   voyage     call | disembark | embark
   *   voyageAny  any | call | disembark | embark   (cruise only)
   */
  roles: RoleVocabulary;
  /** Whether this collection filters on brand or operator. */
  brandField: "brand" | "operator";
  /** Param name the Share button emits for that field. */
  brandParam: "brand" | "operator";
  /** train/jet support excluding regions via `exRegions=`; voyages do not. */
  supportsRegionExclusion: boolean;
  /** Voyages expose a ship filter (`ships=`); journeys do not. */
  supportsVesselFilter: boolean;
  /** Prefix accepted in `ids=` alongside the raw id. */
  idPrefix: string;

  /**
   * How the atlas's load-time pass derives region keys from the route.
   *
   *   "whenEmpty"  train — only back-fill `g` when the curated list is empty
   *   "whenRouted" jet   — any trip with an explicit `route` takes its regions
   *                        FROM the route, overriding the curated `g`
   *
   * Not cosmetic: 39 of jet's 141 trips depend on it, and applying train's rule
   * to jet would leave them in the wrong regions.
   */
  regionDerivation?: "whenEmpty" | "whenRouted";

  /**
   * Where the id comes from.
   *
   *   "field"  train — the source's own product id
   *   "index"  jet   — the jet feed has NO id field; the atlas assigns
   *                    `guideId = 'jt_' + arrayIndex`. That makes jet's `ids=`
   *                    deep links positionally unstable: reorder or insert a
   *                    trip and every previously shared `jt_N` link resolves to
   *                    a different journey. Preserved here because changing it
   *                    would break every link already in the wild — but it is a
   *                    data problem worth fixing at the source.
   */
  idStrategy?: "field" | "index";

  /**
   * Whether an offering with no start date is excluded.
   *
   * The journeys and yacht/worldcruise atlases guard with `isPastTrip()`, which
   * treats a missing date as "not past" and keeps the trip. cruise instead
   * tests `s.start >= today`, and `null >= "2026-07-29"` is false in JS — so a
   * dateless sailing is silently dropped. No current cruise row is dateless, so
   * this changes nothing today; it is here so a feed that ships one behaves the
   * way the original did rather than the way the majority rule does.
   */
  requiresStartDate?: boolean;
}

export const ROLE_VALUES: Record<RoleVocabulary, readonly string[]> = {
  journey: ["any", "start", "end", "stop", "visit"],
  voyage: ["call", "disembark", "embark"],
  voyageAny: ["any", "call", "disembark", "embark"],
};

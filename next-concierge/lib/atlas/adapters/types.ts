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

  /**
   * Collection-specific filter axes, keyed by descriptor facet key.
   *
   * The five retired atlases share one grammar (brand / region / month / ship /
   * port). Hotels do not: they filter on category, program and country, and
   * have no month or route at all. Rather than branch the shared rail, a
   * collection declares its extra axes in `AtlasFilterDescriptor.facets` and
   * puts the values here.
   */
  attributes?: Record<string, string | string[] | null>;

  /**
   * The card's photograph, where the collection has one.
   *
   * A first-class field rather than an attribute because it is part of the
   * shared card's contract, not a filter axis: hotels and villas are both
   * places to stay and are browsed by photograph, and the card's media slot
   * reads this. Null is the normal case for a collection that has no images —
   * every hotel today, and a route atlas forever.
   */
  thumb?: string | null;
  /** A live supplier offer is attached to this record. */
  hasPromotion?: boolean;

  /**
   * Which key to look up in `brandMarks` for this offering's logo, when it is
   * not `brand`. Hotels display their PROGRAM's mark — that is what the
   * original card showed, and what a traveller recognises.
   */
  logoKey?: string | null;

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
  /**
   * What this collection's `world=1` view is CALLED in the region control.
   *
   * The flag is shared and the meaning is not. On the jet atlas it marks a
   * journey that circles the planet, and the Leaflet original's globe button
   * said "Around the World". On rail it marks a journey aboard a named train —
   * the Orient-Express, Rovos Rail, the Rocky Mountaineer — and that button
   * said "Legendary Trains". Same param, same filter, two different questions,
   * so the wording travels with the collection rather than being hardcoded into
   * a control both of them render. Defaults to "Around the World".
   */
  worldLabel?: string;
  /** Voyages expose a ship filter (`ships=`); journeys do not. */
  supportsVesselFilter: boolean;
  /**
   * Whether the rail offers a brand control. Hotels set this false: their
   * `brand=` is a deep-link-only axis (declared as a hidden facet), and a
   * visible control writing the same param would fight it.
   */
  supportsBrandFilter?: boolean;
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

  /**
   * Extra filter axes beyond the shared grammar, in rail order.
   *
   * Hotels use this for category / program / country. `param` is the query
   * string name, which must match what the original atlas accepted — note the
   * hotel atlas's UI axis labelled "Brand / Program" is the `program` param,
   * while `brand` is a separate deep-link-only axis.
   */
  facets?: {
    key: string;
    param: string;
    label: string;
    allLabel: string;
    /**
     * Deep-link-only axis with no control in the rail. The hotel atlas has two:
     * `brand=` (the actual hotel brand, distinct from the visible `program`
     * axis) and `region=` (marquee key). They filter, but nothing in the UI
     * offers them — they arrive from Guide links and marketing landers.
     */
    hidden?: boolean;
    /** Case-insensitive comparison. The deep-link axes lowercase both sides. */
    ci?: boolean;
    /**
     * The most options this axis is willing to be a menu for.
     *
     * Above it — and with nothing picked on the axis yet — the rail offers no
     * control at all. A <select> is a menu, and a menu of 1,044 cities is a
     * scrollbar with a hint of type-ahead: the traveller cannot see what is in
     * it and cannot tell which entries have anything behind them. The axis is
     * not useless there, it is just not answerable at that altitude — one
     * country narrows hotels' 1,044 cities to at most 189.
     *
     * Facet options are already counted against every OTHER filter (see
     * `facetOptions` in AtlasFilterRail), so the list — and this test with it —
     * shrinks as region, country or search narrow the field, and the control
     * appears beside whichever one narrowed it. Omit for an axis whose full
     * list is always a reasonable menu.
     *
     * It gates the CONTROL, never the filter: `?city=` filters whether or not
     * a menu would have been offered, and a picked value always keeps its
     * control on the rail so it can be cleared.
     */
    menuLimit?: number;
  }[];

  /**
   * How `q` is matched.
   *
   *   "tokens"     the five retired atlases — a `words()` tokeniser with a
   *                domain stop-list, folding `country` in as a search term.
   *   "substring"  hotels — a raw lowercase `indexOf` over
   *                `name + city + region + country`, and `country` is a FACET,
   *                not a search term.
   *
   * These are not interchangeable: tokenising the hotel search would make
   * "san" stop matching "San Sebastián", and folding country into terms would
   * fight the country checkbox axis.
   */
  searchMode?: "tokens" | "substring";

  /**
   * `ids=` highlights rather than filters.
   *
   * Every other atlas narrows to the shortlist. The hotel atlas deliberately
   * does not — its own comment: ids and hotel "are highlight-only — they
   * enlarge and frame their pins but never hide the rest of the field, so a
   * shared hotel is always seen in context." A shared property should be seen
   * among its neighbours, which is most of the argument for sending it.
   */
  idsHighlightOnly?: boolean;

  /**
   * Additional params that contribute ids. The hotel atlas accepts `hotel=` for
   * "a shared selected hotel: opens its detail panel and starts the orbit on
   * load" — a single-property link, distinct from an `ids=` shortlist but
   * resolving to the same thing here.
   */
  extraIdParams?: string[];

  /** Collections without departures (hotels) hide the month control. */
  supportsMonthFilter?: boolean;

  /** Collections without itineraries (hotels) hide the stop/role controls. */
  supportsStopFilter?: boolean;

  /**
   * Whether the rail offers the trip-length (min/max days) filter.
   *
   * Defaults to on, because every journey and voyage has a length and "how
   * long am I away for" is the axis a traveller brings to the page before
   * they know where they want to go. Hotels turn it off: a stay's length is
   * the traveller's choice, not a property of the offering, so a control for
   * it there would filter on a number the feed does not have.
   */
  supportsDurationFilter?: boolean;
  /**
   * Offer a "Special offers" toggle in the rail.
   *
   * Requires the collection's offerings to carry `hasPromotion`, which the
   * Virtuoso promotions feed supplies (scripts/sync-virtuoso-promotions.mjs).
   */
  supportsPromotionFilter?: boolean;
}

export const ROLE_VALUES: Record<RoleVocabulary, readonly string[]> = {
  journey: ["any", "start", "end", "stop", "visit"],
  voyage: ["call", "disembark", "embark"],
  voyageAny: ["any", "call", "disembark", "embark"],
};

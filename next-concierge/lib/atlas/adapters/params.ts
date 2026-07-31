/**
 * Deep-link parsing — every param the five Leaflet atlases understood.
 *
 * "Every param the Leaflet app understood must keep working" is the hard
 * requirement in the work order, because the atlases' own Share buttons emit
 * these and travellers have them bookmarked and in email. The parsing is
 * fussier than it looks, and none of the following is inferred — it is read out
 * of each `applyDeepLink()`:
 *
 *   brand      falls back to `operator` (`sp.get('brand')||sp.get('operator')`)
 *              and is matched FUZZILY: exact on key or short name, then
 *              substring in either direction.
 *   region     matched through a per-collection ALIAS TABLE first
 *              ("scotland" → BRITAIN), then exact on key/name/abbreviation,
 *              then substring either way. The tables are all different and
 *              cruise has none.
 *   regions    comma-separated, and each key is only accepted if it is a real
 *              mappable region — unknown keys are dropped, not passed through.
 *   exRegions  same, and additionally skipped if already in `regions`.
 *   location   journeys only, matched by norm() against known stop names.
 *   port       voyages only, matched EXACTLY against the PORTS map. No
 *              normalisation — `port=nice, france` does not resolve.
 *   role       journeys map `stop` → `visit` and accept only start/end/visit;
 *              voyages accept whatever string arrives.
 *   q, country tokenised together into search terms (country is not a filter).
 *   world      /^(1|true|yes|y)$/i
 *
 * The asymmetry between fuzzy `location` and exact `port` is real, existing
 * behaviour. It is preserved rather than "fixed" so shared links resolve to
 * exactly what they resolve to today.
 */

import type { AtlasFilterDescriptor } from "./types";
import { norm, searchTerms } from "./search";
import type { AtlasFilterState } from "./filter";

/**
 * Region aliases, transcribed per atlas. Keys are already norm()-ed; the
 * worldcruise table contains multi-word keys ("panama canal") which norm()
 * reduces to single-spaced lowercase, so they still match.
 */
export const REGION_ALIASES: Record<string, Record<string, string>> = {
  train: { scotland: "BRITAIN", britain: "BRITAIN", uk: "BRITAIN", unitedkingdom: "BRITAIN", england: "BRITAIN", wales: "BRITAIN", ireland: "BRITAIN", europe: "EUROPE", alps: "EUROPE", switzerland: "EUROPE", italy: "EUROPE", norway: "NORDICS", scandinavia: "NORDICS", nordics: "NORDICS", japan: "EASTASIA", korea: "EASTASIA", asia: "EASTASIA", seasia: "SEASIA", malaysia: "SEASIA", singapore: "SEASIA", indonesia: "SEASIA", india: "INDIA", africa: "AFRICA", southafrica: "AFRICA", peru: "SAM", andes: "SAM", southamerica: "SAM", canada: "CANADA", rockies: "CANADA", canadianrockies: "CANADA", us: "AMERICAS", usa: "AMERICAS", unitedstates: "AMERICAS", america: "AMERICAS", alaska: "AMERICAS", americanwest: "AMERICAS", australia: "ANZ", newzealand: "ANZ" },
  jet: { asia: "EASTASIA", japan: "EASTASIA", polynesia: "POLY", tahiti: "POLY", antarctica: "ANTARCTICA", arctic: "AURORA", northernlights: "AURORA", northernlight: "AURORA", africa: "AFRICA", namibia: "AFRICA", europe: "EUROPE", mediterranean: "EUROPE", amazon: "SAM", patagonia: "SAM", southamerica: "SAM" },
  yacht: { mediterranean: "MED", adriatic: "ADRIATIC", aegean: "AEGEAN", italy: "CENTRALMED", japan: "EASTASIA", asia: "EASTASIA", caribbean: "CARIB", polynesia: "POLY", tahiti: "POLY", norway: "NEUROPE", arctic: "NEUROPE" },
  worldcruise: { mediterranean: "MED", med: "MED", adriatic: "MED", aegean: "MED", italy: "MED", greece: "MED", japan: "EASTASIA", asia: "SEASIA", caribbean: "CARIB", bermuda: "CARIB", polynesia: "PACIFIC", tahiti: "PACIFIC", fiji: "PACIFIC", norway: "NEUROPE", baltic: "NEUROPE", arctic: "NATL", iceland: "NATL", greenland: "NATL", antarctica: "ANTARCTIC", australia: "AUNZ", newzealand: "AUNZ", "new zealand": "AUNZ", hawaii: "HAWAII", alaska: "NAMWEST", panama: "CAMER", "panama canal": "CAMER", india: "INDIA", africa: "SAFRICA", arabia: "MIDEAST", "middle east": "MIDEAST", "south america": "SAMER", "south pacific": "PACIFIC" },
  // cruise has no alias table — it matches against its mappable region names only.
  cruise: {},
};

const splitList = (v: string | null | undefined): string[] =>
  String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Region metadata the resolvers need, supplied by the caller. */
/**
 * The basemaps a Share link may name, and THE canonical list of them.
 *
 * It lives here rather than in AtlasShell because this module is the boundary
 * where a URL becomes state: a key the parser rejects can never reach the map,
 * so a new basemap that is added to the style menu and not to this array is
 * simply un-shareable — silently, and only for the person you sent the link to.
 * AtlasShell derives its StyleKey from this.
 */
export const SHARE_STYLES = ["dark", "satellite", "daylight", "dusk", "city"] as const;
export type ShareStyle = (typeof SHARE_STYLES)[number];

export interface RegionInfo { key: string; name?: string | null; ab?: string | null }
export interface BrandInfo { key: string; short?: string | null }

/** Fuzzy brand resolution, verbatim from `findBrand()`. */
export function findBrand(raw: unknown, brands: readonly BrandInfo[]): string | null {
  const v = norm(raw);
  if (!v) return null;
  const exact = brands.find((b) => norm(b.key) === v || norm(b.short) === v);
  if (exact) return exact.key;
  const loose = brands.find(
    (b) => norm(b.key).includes(v) || norm(b.short).includes(v) || (norm(b.short) && v.includes(norm(b.short))),
  );
  return loose ? loose.key : null;
}

/** Fuzzy region resolution, verbatim from `findRegionKey()` including aliases. */
export function findRegionKey(
  raw: unknown,
  regions: readonly RegionInfo[],
  collection: string,
): string | null {
  const v = norm(raw);
  if (!v) return null;
  const aliases = REGION_ALIASES[collection] || {};
  const aliased = aliases[v];
  if (aliased && regions.some((r) => r.key === aliased)) return aliased;
  const exact = regions.find((r) => norm(r.key) === v || norm(r.name) === v || norm(r.ab) === v);
  if (exact) return exact.key;
  const loose = regions.find(
    (r) => norm(r.key).includes(v) || norm(r.name).includes(v) || (norm(r.name) && v.includes(norm(r.name))),
  );
  return loose ? loose.key : null;
}

/**
 * Non-filter params that drive the view rather than the result set.
 *
 * These matter as much as the filters for an advisor sharing a link with a
 * client: the point of the share is "look at THIS, like THIS", so the basemap,
 * the projection, the camera and the pinned journey all travel with it.
 */
export interface AtlasViewIntent {
  /** `trip=` — the pinned journey whose route is traced. */
  trip: string | null;
  /** `region=` (singular) — focus this region. */
  focusRegion: string | null;
  /** `world=1` — journeys' round-the-world view. */
  world: boolean;
  /** `hero=1` — ambient embed for the marketing landers. */
  hero: boolean;
  /** `style=` — one of {@link SHARE_STYLES}. */
  style: string | null;
  /** `flat=1` — mercator instead of globe. */
  flat: boolean;
  /** `@=lng,lat,zoom` — exact camera. */
  camera: { lng: number; lat: number; zoom: number } | null;
}

export interface ParsedDeepLink {
  state: AtlasFilterState;
  view: AtlasViewIntent;
}

export interface ParseContext {
  brands: readonly BrandInfo[];
  regions: readonly RegionInfo[];
  /** Valid stop names. Journeys match these by norm(); voyages exactly. */
  stopNames: readonly string[];
}

export function parseDeepLink(
  params: URLSearchParams,
  d: AtlasFilterDescriptor,
  ctx: ParseContext,
): ParsedDeepLink {
  const regionKeys = new Set(ctx.regions.map((r) => r.key));

  const ids = new Set(splitList(params.get("ids")));
  // Collections may accept a second single-item param (hotels: `hotel=`).
  for (const extra of d.extraIdParams || []) {
    for (const v of splitList(params.get(extra))) ids.add(v);
  }
  const months = new Set(splitList(params.get("month")));
  const vessels = new Set(d.supportsVesselFilter ? splitList(params.get("ships")) : []);

  // brand falls back to operator (and vice versa for cruise, whose Share button
  // emits operator=). Each entry is resolved fuzzily and unknown values drop.
  const brandRaw = params.get(d.brandParam) ?? params.get("brand") ?? params.get("operator");
  const brands = new Set<string>();
  for (const token of splitList(brandRaw)) {
    const hit = d.brandField === "operator"
      // cruise filters on the operator's display name, so accept it verbatim
      // when it names a real operator, else fall back to fuzzy matching.
      ? (ctx.brands.find((b) => b.key === token)?.key ?? findBrand(token, ctx.brands))
      : findBrand(token, ctx.brands);
    if (hit) brands.add(hit);
  }

  // Unknown region keys are DROPPED, not passed through — an unrecognised key
  // would otherwise filter everything out.
  const regions = new Set<string>();
  for (const k of splitList(params.get("regions"))) if (regionKeys.has(k)) regions.add(k);

  const excludedRegions = new Set<string>();
  if (d.supportsRegionExclusion) {
    for (const k of splitList(params.get("exRegions"))) {
      if (regionKeys.has(k) && !regions.has(k)) excludedRegions.add(k);
    }
  }

  // Stop resolution differs by family — fuzzy for journeys, exact for voyages.
  const stopRaw = params.get(d.stopParam);
  let stop: string | null = null;
  if (stopRaw) {
    if (d.stopParam === "location") {
      stop = ctx.stopNames.find((n) => norm(n) === norm(stopRaw)) ?? null;
    } else {
      stop = ctx.stopNames.includes(stopRaw) ? stopRaw : null;
    }
  }

  // Role: journeys fold `stop` into `visit` and accept nothing else; voyages
  // take the string as given (unrecognised values fall through to "any" in the
  // predicate, which is what the originals do).
  const roleRaw = params.get(d.stopRoleParam);
  let stopRole = "any";
  if (roleRaw) {
    if (d.roles === "journey") {
      const mapped = roleRaw === "stop" ? "visit" : roleRaw;
      if (["start", "end", "visit"].includes(mapped)) stopRole = mapped;
    } else {
      stopRole = roleRaw;
    }
  }

  // Collection-specific axes (hotels: category / program / country). Values are
  // comma-separated, matching the originals' `tick()` which splits on commas.
  const facets: Record<string, ReadonlySet<string>> = {};
  for (const f of d.facets || []) {
    const picked = new Set(splitList(params.get(f.param)));
    if (picked.size) facets[f.key] = picked;
  }

  return {
    state: {
      brands,
      vessels,
      months,
      ids,
      regions,
      excludedRegions,
      stop,
      stopRole,
      // `country` folds into the search terms for the five journeys/voyages —
      // but where a collection declares a `country` FACET (hotels), the param
      // is that facet's value and must not also become a search term.
      terms: searchTerms(
        params.get("q"),
        d.facets?.some((f) => f.param === "country") ? null : params.get("country"),
        d.collection,
      ),
      rawQuery: params.get("q") || undefined,
      // world is both a filter and a view intent: it narrows the results AND
      // is what the old worldBtn toggled.
      world: /^(1|true|yes|y)$/i.test(String(params.get("world") ?? "").trim()) || undefined,
      facets: Object.keys(facets).length ? facets : undefined,
    },
    view: {
      trip: params.get("trip") || null,
      focusRegion: findRegionKey(params.get("region"), ctx.regions, d.collection),
      world: /^(1|true|yes|y)$/i.test(String(params.get("world") ?? "").trim()),
      hero: params.get("hero") === "1",
      style: (SHARE_STYLES as readonly string[]).includes(String(params.get("style")))
        ? params.get("style")
        : null,
      flat: params.get("flat") === "1",
      camera: (() => {
        const raw = params.get("@");
        if (!raw) return null;
        const [lng, lat, zoom] = raw.split(",").map(Number);
        return [lng, lat, zoom].every(Number.isFinite) ? { lng, lat, zoom } : null;
      })(),
    },
  };
}

/**
 * Rebuild a shareable query string. Emits the same param names each atlas's
 * Share button did, so links produced by the new UI are interchangeable with
 * links already in circulation.
 */
export function toSearchParams(
  state: AtlasFilterState,
  view: Partial<AtlasViewIntent>,
  d: AtlasFilterDescriptor,
  rawQuery?: { q?: string | null; country?: string | null },
): URLSearchParams {
  const p = new URLSearchParams();
  const set = (k: string, v: Iterable<string>) => {
    const list = [...v];
    if (list.length) p.set(k, list.join(","));
  };
  set("ids", state.ids);
  set("month", state.months);
  set(d.brandParam, state.brands);
  if (d.supportsVesselFilter) set("ships", state.vessels);
  set("regions", state.regions);
  for (const f of d.facets || []) {
    const picked = state.facets?.[f.key];
    if (picked?.size) p.set(f.param, [...picked].join(","));
  }
  if (d.supportsRegionExclusion) set("exRegions", state.excludedRegions);
  if (state.stop) {
    p.set(d.stopParam, state.stop);
    if (state.stopRole && state.stopRole !== "any") p.set(d.stopRoleParam, state.stopRole);
  }
  if (rawQuery?.q) p.set("q", rawQuery.q);
  // Same asymmetry on the way out: a country facet already wrote this key.
  if (rawQuery?.country && !d.facets?.some((f) => f.param === "country")) {
    p.set("country", rawQuery.country);
  }
  if (view.trip) p.set("trip", view.trip);
  if (view.focusRegion) p.set("region", view.focusRegion);
  if (view.world || state.world) p.set("world", "1");
  if (view.hero) p.set("hero", "1");
  if (view.style) p.set("style", view.style);
  if (view.flat) p.set("flat", "1");
  if (view.camera) {
    const c = view.camera;
    p.set("@", `${c.lng.toFixed(4)},${c.lat.toFixed(4)},${c.zoom.toFixed(2)}`);
  }
  return p;
}

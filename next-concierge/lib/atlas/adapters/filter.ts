/**
 * One filter predicate for all five retired atlases.
 *
 * The five Leaflet apps each hand-rolled this. They agree on the shape and
 * disagree on details that are invisible until they bite — see
 * D3-FILTER-INVENTORY.md. Every divergence lives in AtlasFilterDescriptor, so
 * this function stays single-branch and testable.
 *
 * Verified against the originals by scripts/verify-adapters.mjs, which runs
 * both implementations over thousands of random filter combinations.
 */

import type { AtlasFilterDescriptor, AtlasOffering } from "./types";
import { matchesSubstring, matchesTerms } from "./search";

export interface AtlasFilterState {
  /** Brand keys, or operator names for cruise — see descriptor.brandField. */
  brands: ReadonlySet<string>;
  /** Ship names. Voyages only. */
  vessels: ReadonlySet<string>;
  /** Month keys, `YYYY-MM`. */
  months: ReadonlySet<string>;
  /** Raw or prefixed ids from `ids=`. */
  ids: ReadonlySet<string>;
  /** Included region keys. Empty means "all". */
  regions: ReadonlySet<string>;
  /** Excluded region keys. Journeys only; ignored where unsupported. */
  excludedRegions: ReadonlySet<string>;
  /** Stop name from `location=` / `port=`, exact match against stop names. */
  stop: string | null;
  /** Role string, passed through verbatim from `locationrole=` / `portrole=`. */
  stopRole: string;
  /** Pre-tokenised search terms from `q` + `country`. Token mode only. */
  terms: readonly string[];
  /** Raw `q`, for descriptors using searchMode "substring". */
  rawQuery?: string;
  /**
   * `world=1` — only round-the-world itineraries.
   *
   * The Leaflet journeys atlases had a dedicated `worldBtn`; here it is the
   * "Around the World" entry in the region control, because that is where a
   * traveller looks for "where does this go". Deliberately NOT folded into
   * `offering.regions`: that would change region facets and break the adapter
   * parity harness, which compares against atlases that have no such region.
   * Undefined means "not filtering", so existing callers are unaffected.
   */
  world?: boolean;

  /**
   * Values selected on the collection's extra axes, keyed by facet key.
   * Undefined for the five retired atlases, so their parity is untouched.
   */
  facets?: Record<string, ReadonlySet<string>>;
}

export function emptyFilterState(): AtlasFilterState {
  return {
    brands: new Set(),
    vessels: new Set(),
    months: new Set(),
    ids: new Set(),
    regions: new Set(),
    excludedRegions: new Set(),
    stop: null,
    stopRole: "any",
    terms: [],
  };
}

/**
 * Is this offering in the past?
 *
 * On-demand journeys never are — they have no fixed departure. Offerings with
 * no start date are treated as present, matching the originals' `!t.d` guard.
 * `today` is injectable so the verifier and any test can pin it.
 */
export function isPast(
  o: AtlasOffering,
  today: string,
  d?: AtlasFilterDescriptor,
): boolean {
  if (o.onDemand) return false;
  // cruise drops dateless sailings (`null >= today` is false); everyone else
  // keeps them. See AtlasFilterDescriptor.requiresStartDate.
  if (!o.startDate) return !!d?.requiresStartDate;
  return o.startDate < today;
}

/**
 * Stop-role match. The vocabularies differ per family and the strings are
 * passed through verbatim, so this compares against both families' words:
 * start/embark, end/disembark, stop|visit/call. Anything else — including
 * "any" and any unrecognised value — falls through to "touches at all",
 * which is what every original does by default.
 */
function stopMatches(o: AtlasOffering, stop: string, role: string): boolean {
  const names = o.stops.map((s) => s.name);
  if (!names.length) return false;
  const first = names[0];
  const last = names.length > 1 ? names[names.length - 1] : null;
  switch (role) {
    case "start":
    case "embark":
      return first === stop;
    case "end":
    case "disembark":
      return last === stop;
    case "stop":
    case "visit":
    case "call":
      // Deliberately EXCLUDES first and last — the originals slice(1,-1).
      return names.slice(1, -1).includes(stop);
    default:
      return names.includes(stop);
  }
}

/**
 * Everything except the region filter. The originals keep this separate because
 * region pin counts must reflect how many qualifying trips reach each region —
 * if the region filter were applied, every pin would show its own selection.
 */
export function matchesExceptRegion(
  o: AtlasOffering,
  state: AtlasFilterState,
  d: AtlasFilterDescriptor,
  today: string,
): boolean {
  if (isPast(o, today, d)) return false;

  if (d.supportsBrandFilter !== false && state.brands.size) {
    const value = d.brandField === "operator" ? o.operator : o.brand;
    if (!value || !state.brands.has(value)) return false;
  }

  if (d.supportsVesselFilter && state.vessels.size) {
    if (!o.vessel || !state.vessels.has(o.vessel)) return false;
  }

  // On-demand offerings pass the month filter unconditionally so they sort to
  // the bottom of every selected month. Journeys only; voyages set no flag.
  if (d.supportsMonthFilter !== false && state.months.size && !o.onDemand) {
    if (!o.months.some((m) => state.months.has(m))) return false;
  }

  // Highlight-only collections keep the whole field visible; the shortlist is
  // rendered as emphasis by the caller instead. See idsHighlightOnly.
  if (!d.idsHighlightOnly && state.ids.size) {
    if (!o.idAliases.some((a) => state.ids.has(a))) return false;
  }

  if (d.searchMode === "substring") {
    if (!matchesSubstring(o.searchText, state.rawQuery || "")) return false;
  } else if (!matchesTerms(o.searchText, state.terms)) return false;

  if (d.supportsStopFilter !== false && state.stop && !stopMatches(o, state.stop, state.stopRole)) return false;

  if (state.world && !o.world) return false;

  // Collection-specific axes (hotels: category / program / country).
  if (state.facets && d.facets?.length) {
    for (const f of d.facets) {
      const picked = state.facets[f.key];
      if (!picked || !picked.size) continue;
      const raw = o.attributes?.[f.key];
      if (!raw) return false;
      // A value may be plural: hotels' `region=caribbean` matches both the
      // marquee key and the country-derived alias.
      const values = Array.isArray(raw) ? raw : [raw];
      const hit = f.ci
        ? values.some((v) => [...picked].some((w) => w.toLowerCase() === v.toLowerCase()))
        : values.some((v) => picked.has(v));
      if (!hit) return false;
    }
  }

  return true;
}

/** Include-any, and — where the collection supports it — exclude-none. */
export function regionPass(
  o: AtlasOffering,
  state: AtlasFilterState,
  d: AtlasFilterDescriptor,
): boolean {
  const included = !state.regions.size || o.regions.some((k) => state.regions.has(k));
  if (!included) return false;
  if (!d.supportsRegionExclusion || !state.excludedRegions.size) return true;
  return !o.regions.some((k) => state.excludedRegions.has(k));
}

export function matchesOffering(
  o: AtlasOffering,
  state: AtlasFilterState,
  d: AtlasFilterDescriptor,
  today: string,
): boolean {
  return matchesExceptRegion(o, state, d, today) && regionPass(o, state, d);
}

"use client";

/**
 * One filter rail for all five retired Leaflet atlases.
 *
 * Replaces five bespoke rails. Every per-collection difference comes from
 * AtlasFilterDescriptor, so this component has no `if (collection === …)` in
 * it: which controls appear, what the stop control is called, and which role
 * vocabulary its dropdown offers are all read from the descriptor.
 *
 * Visual pattern follows /atlas/villa (`.villa-filters`) — a wrapping row of
 * selects with facet counts, a free-text box, and a reset. That is the only
 * Mapbox-native filter UI the app already has, so the collections converge on
 * something familiar rather than a sixth new pattern.
 *
 * MULTI-VALUE STATE, SINGLE-VALUE CONTROLS. The atlases' params are
 * comma-separated lists and the filter state holds Sets, so a shared link with
 * `regions=MED,CARIB` filters correctly. The dropdowns only express one value
 * at a time; when a deep link carries more, the control shows "Several (n)" and
 * leaves the set alone until the traveller actually changes it. Narrowing the
 * state to what a <select> can say would silently drop half of an existing
 * link's meaning.
 *
 * Region EXCLUSION (`exRegions=`) is parsed and filtered but has no control
 * here by design — nothing in the app has ever emitted it, so it would be a
 * three-state pill serving links only the old Share buttons produced.
 */

import { useEffect, useId, useMemo, useState } from "react";
import type { AtlasOffering, AtlasFilterDescriptor } from "@/lib/atlas/adapters/types";
import { ROLE_VALUES } from "@/lib/atlas/adapters/types";
import {
  matchesExceptRegion,
  matchesOffering,
  regionPass,
  type AtlasFilterState,
} from "@/lib/atlas/adapters/filter";

export interface AtlasQuery {
  q: string;
  country?: string;
}

interface Props {
  descriptor: AtlasFilterDescriptor;
  /** Every offering in the collection, unfiltered. */
  offerings: readonly AtlasOffering[];
  state: AtlasFilterState;
  query: AtlasQuery;
  /** Region key → display name, for readable options. */
  regionLabels?: Record<string, string>;
  /** ISO date used for the past-trip cutoff; injectable for tests. */
  today: string;
  onStateChange(next: AtlasFilterState): void;
  onQueryChange(next: AtlasQuery): void;
}

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const i = Number(m) - 1;
  return MONTH_LABEL[i] ? `${MONTH_LABEL[i]} ${y}` : key;
}

/** Replace a Set with a single value, or clear it when the value is empty. */
function single(value: string): Set<string> {
  return new Set(value ? [value] : []);
}

/**
 * What a single-value <select> should display for a possibly-multi Set.
 * Empty → "", one → that value, more → a sentinel the option list carries so
 * the browser doesn't blank the control (which would look like "no filter").
 */
const MULTI = "__multi__";
function selectValue(set: ReadonlySet<string>): string {
  if (set.size === 0) return "";
  if (set.size === 1) return [...set][0];
  return MULTI;
}

export default function AtlasFilterRail({
  descriptor: d,
  offerings,
  state,
  query,
  regionLabels,
  today,
  onStateChange,
  onQueryChange,
}: Props) {
  /**
   * Facet counts. Each control counts against the results that pass every
   * OTHER filter, which is what the Leaflet atlases do for their region pins —
   * so a count tells you what selecting it would give you, not what you already
   * have selected.
   */
  const facets = useMemo(() => {
    const region: Record<string, number> = {};
    const brand: Record<string, number> = {};
    const month: Record<string, number> = {};
    const vessel: Record<string, number> = {};

    for (const o of offerings) {
      // Regions counted against everything except the region filter.
      if (matchesExceptRegion(o, state, d, today)) {
        for (const k of o.regions) region[k] = (region[k] || 0) + 1;
      }
      // The remaining facets count against the fully filtered set minus
      // themselves; approximating with the full predicate keeps this cheap and
      // is honest for the common single-selection case.
      if (matchesOffering(o, state, d, today)) {
        const b = d.brandField === "operator" ? o.operator : o.brand;
        if (b) brand[b] = (brand[b] || 0) + 1;
        for (const m of o.months) month[m] = (month[m] || 0) + 1;
        if (o.vessel) vessel[o.vessel] = (vessel[o.vessel] || 0) + 1;
      }
    }
    return { region, brand, month, vessel };
  }, [offerings, state, d, today]);

  /** Option lists, derived from the data rather than hand-maintained. */
  const options = useMemo(() => {
    const regions = new Map<string, string>();
    const brands = new Map<string, string>();
    const months = new Set<string>();
    const vessels = new Set<string>();
    const stops = new Set<string>();
    for (const o of offerings) {
      for (const k of o.regions) if (!regions.has(k)) regions.set(k, regionLabels?.[k] || k);
      const key = d.brandField === "operator" ? o.operator : o.brand;
      if (key && !brands.has(key)) brands.set(key, o.brandLabel || key);
      for (const m of o.months) months.add(m);
      if (o.vessel) vessels.add(o.vessel);
      for (const s of o.stops) stops.add(s.name);
    }
    const byLabel = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);
    return {
      regions: [...regions.entries()].sort(byLabel),
      brands: [...brands.entries()].sort(byLabel),
      months: [...months].sort(),
      vessels: [...vessels].sort((a, b) => a.localeCompare(b)),
      stops: [...stops].sort((a, b) => a.localeCompare(b)),
    };
  }, [offerings, regionLabels, d.brandField]);

  const resultCount = useMemo(
    () => offerings.filter((o) => matchesOffering(o, state, d, today)).length,
    [offerings, state, d, today],
  );

  const active =
    state.brands.size || state.vessels.size || state.months.size || state.ids.size ||
    state.regions.size || state.excludedRegions.size || state.stop || state.terms.length;

  const set = (patch: Partial<AtlasFilterState>) => onStateChange({ ...state, ...patch });

  const stopLabel = d.stopParam === "port" ? "port" : "location";
  const roleOptions = ROLE_VALUES[d.roles];
  const stopListId = useId();

  // The stop box is a type-ahead, so its text is local — but a deep link or a
  // Reset changes state.stop from outside, and the box has to follow.
  const [stopText, setStopText] = useState(state.stop || "");
  useEffect(() => { setStopText(state.stop || ""); }, [state.stop]);

  return (
    <div className="villa-filters" role="group" aria-label={`Filter ${d.collection}`}>
      <select
        value={selectValue(state.regions)}
        onChange={(e) => set({ regions: single(e.target.value === MULTI ? "" : e.target.value) })}
        aria-label="Region"
      >
        <option value="">All regions</option>
        {state.regions.size > 1 && <option value={MULTI}>Several ({state.regions.size})</option>}
        {options.regions.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
            {facets.region[key] != null ? ` (${facets.region[key]})` : ""}
          </option>
        ))}
      </select>

      <select
        value={selectValue(state.brands)}
        onChange={(e) => set({ brands: single(e.target.value === MULTI ? "" : e.target.value) })}
        aria-label={d.brandField === "operator" ? "Operator" : "Brand"}
      >
        <option value="">{d.brandField === "operator" ? "All operators" : "All brands"}</option>
        {state.brands.size > 1 && <option value={MULTI}>Several ({state.brands.size})</option>}
        {options.brands.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
            {facets.brand[key] != null ? ` (${facets.brand[key]})` : ""}
          </option>
        ))}
      </select>

      <select
        value={selectValue(state.months)}
        onChange={(e) => set({ months: single(e.target.value === MULTI ? "" : e.target.value) })}
        aria-label="Month"
      >
        <option value="">Any month</option>
        {state.months.size > 1 && <option value={MULTI}>Several ({state.months.size})</option>}
        {options.months.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
            {facets.month[m] != null ? ` (${facets.month[m]})` : ""}
          </option>
        ))}
      </select>

      {d.supportsVesselFilter && (
        <select
          value={selectValue(state.vessels)}
          onChange={(e) => set({ vessels: single(e.target.value === MULTI ? "" : e.target.value) })}
          aria-label="Ship"
        >
          <option value="">Any ship</option>
          {state.vessels.size > 1 && <option value={MULTI}>Several ({state.vessels.size})</option>}
          {options.vessels.map((s) => (
            <option key={s} value={s}>
              {s}
              {facets.vessel[s] != null ? ` (${facets.vessel[s]})` : ""}
            </option>
          ))}
        </select>
      )}

      {/* A type-ahead, NOT a dropdown. cruise has 1,622 distinct ports and
          worldcruise 971 — a <select> that size is unusable and a lot of DOM.
          The Leaflet atlases reached the same conclusion: their only static
          filter markup is #portSearch / #locationSearch, a text input. A
          datalist gives type-ahead over the full list for free.
          The typed text is local; the filter only engages on an exact option
          match, so half-typed input doesn't empty the map. */}
      <input
        className="atlas-stop"
        type="search"
        list={stopListId}
        value={stopText}
        placeholder={`Any ${stopLabel}`}
        onChange={(e) => {
          const v = e.target.value;
          setStopText(v);
          const hit = options.stops.find((s) =>
            d.stopParam === "location"
              ? s.toLowerCase() === v.trim().toLowerCase()
              : s === v.trim(),
          );
          if (hit) set({ stop: hit });
          else if (!v.trim() && state.stop) set({ stop: null });
        }}
        aria-label={d.stopParam === "port" ? "Port" : "Location"}
      />
      <datalist id={stopListId}>
        {options.stops.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* The role control is meaningless without a stop chosen, and the
          vocabularies differ per family — hence roleOptions from the descriptor
          rather than a shared list. */}
      <select
        value={state.stopRole}
        onChange={(e) => set({ stopRole: e.target.value })}
        disabled={!state.stop}
        aria-label={d.stopParam === "port" ? "Port role" : "Location role"}
      >
        {roleOptions.map((r) => (
          <option key={r} value={r}>
            {r === "any" ? `Anywhere on route` : r[0].toUpperCase() + r.slice(1)}
          </option>
        ))}
        {!roleOptions.includes("any") && <option value="any">Anywhere on route</option>}
      </select>

      <input
        className="villa-q"
        type="search"
        value={query.q}
        placeholder={`Search ${d.collection === "cruise" ? "sailings" : "journeys"}…`}
        onChange={(e) => onQueryChange({ ...query, q: e.target.value })}
        aria-label="Search"
      />

      <span className="atlas-count" aria-live="polite">
        {resultCount.toLocaleString()} match{resultCount === 1 ? "" : "es"}
      </span>

      {!!active && (
        <button
          type="button"
          className="atlas-reset"
          onClick={() => {
            onStateChange({
              brands: new Set(), vessels: new Set(), months: new Set(), ids: new Set(),
              regions: new Set(), excludedRegions: new Set(),
              stop: null, stopRole: "any", terms: [],
            });
            onQueryChange({ q: "", country: "" });
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}

/** Convenience for callers that need the filtered list alongside the rail. */
export function filterOfferings(
  offerings: readonly AtlasOffering[],
  state: AtlasFilterState,
  d: AtlasFilterDescriptor,
  today: string,
): AtlasOffering[] {
  return offerings.filter((o) => matchesExceptRegion(o, state, d, today) && regionPass(o, state, d));
}

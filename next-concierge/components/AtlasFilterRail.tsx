"use client";

/**
 * One filter rail for all five retired Leaflet atlases — desktop row on wide
 * screens, drawer + Apply on phones.
 *
 * Every per-collection difference comes from AtlasFilterDescriptor, so there is
 * no `if (collection === …)` here: which controls appear, what the stop control
 * is called, and which role vocabulary it offers are all read from it.
 *
 * DESKTOP is the /atlas/villa pattern (`.villa-filters`) — a wrapping row of
 * selects with facet counts. Every change applies immediately.
 *
 * MOBILE is the pattern the Leaflet atlases used, and it is not a smaller
 * version of the desktop one. There the filters live in a drawer behind a pill,
 * edits are DRAFT, and an "Apply (N)" button commits them. That difference is
 * not decoration: on a phone the map is the whole screen, so applying a filter
 * per keystroke means the map redraws under your thumb while you are still
 * deciding, and the count you are aiming for keeps moving. Draft-then-commit
 * lets you set three filters and see the result once.
 *
 * MULTI-VALUE STATE, SINGLE-VALUE CONTROLS. The atlases' params are
 * comma-separated and the state holds Sets, so `regions=MED,CARIB` filters on
 * both. The dropdowns express one value; when a link carries more, the control
 * shows "Several (n)" and leaves the set alone until the traveller changes it.
 *
 * Region EXCLUSION (`exRegions=`) is parsed and filtered but has no control, by
 * decision — nothing in the app has ever emitted it.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { AtlasOffering, AtlasFilterDescriptor } from "@/lib/atlas/adapters/types";
import { ROLE_VALUES } from "@/lib/atlas/adapters/types";
import { matchesExceptRegion, matchesOffering, regionPass, type AtlasFilterState } from "@/lib/atlas/adapters/filter";

export interface AtlasQuery {
  q: string;
  country?: string;
}

interface Props {
  descriptor: AtlasFilterDescriptor;
  offerings: readonly AtlasOffering[];
  state: AtlasFilterState;
  query: AtlasQuery;
  regionLabels?: Record<string, string>;
  today: string;
  onStateChange(next: AtlasFilterState): void;
  onQueryChange(next: AtlasQuery): void;
  /**
   * Commit BOTH at once. Calling onStateChange then onQueryChange loses the
   * state: each writes the whole query string from its own argument plus the
   * currently-committed other half, so the second call overwrites the first
   * with the pre-Apply state. That is why "Apply didn't change the cards".
   */
  onCommit?(next: AtlasFilterState, nextQuery: AtlasQuery): void;
  /** Copy a link reproducing filters + pinned journey + basemap + camera. */
  onShare?: () => void;
  shareLabel?: string;
  /**
   * Controls that belong with the rail but are owned by the list — Sort, and
   * the "showing the first N" note. They used to sit in their own bar directly
   * underneath, which cost a third stacked row saying things about the same
   * result set the rail was already describing. On desktop they join this row;
   * on mobile the rail is a pill, so the caller keeps its own bar.
   */
  trailing?: ReactNode;
}

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const i = Number(m) - 1;
  return MONTH_LABEL[i] ? `${MONTH_LABEL[i]} ${y}` : key;
}

const single = (value: string): Set<string> => new Set(value ? [value] : []);

const MULTI = "__multi__";
function selectValue(set: ReadonlySet<string>): string {
  if (set.size === 0) return "";
  if (set.size === 1) return [...set][0];
  return MULTI;
}

const EMPTY_STATE = (): AtlasFilterState => ({
  brands: new Set(), vessels: new Set(), months: new Set(), ids: new Set(),
  regions: new Set(), excludedRegions: new Set(), stop: null, stopRole: "any", terms: [],
  world: undefined, facets: undefined,
});

/**
 * How long typing has to stop before the free-text search runs. Long enough
 * that a normal typing rhythm never triggers it mid-word, short enough that it
 * still feels like the results are following you.
 */
const Q_DEBOUNCE_MS = 420;

/** Sentinel for the "Around the World" entry in the region control. */
const WORLD = "__world__";

/** Matches the CSS breakpoint the rest of the atlas chrome uses. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 680px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}

export default function AtlasFilterRail({
  descriptor: d, offerings, state, query, regionLabels, today,
  onStateChange, onQueryChange, onCommit, onShare, shareLabel = "Share", trailing,
}: Props) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  /**
   * On mobile the sheet edits a DRAFT; desktop edits live state. Keeping both
   * behind one variable means the controls below are written once.
   */
  const [draft, setDraft] = useState<AtlasFilterState>(state);
  const [draftQuery, setDraftQuery] = useState<AtlasQuery>(query);
  const editing = isMobile && sheetOpen;
  const shown = editing ? draft : state;
  const shownQuery = editing ? draftQuery : query;

  // Re-seed the draft whenever the sheet opens, or committed state moves under
  // it (a region pin tapped on the map, say).
  useEffect(() => {
    if (!editing) { setDraft(state); setDraftQuery(query); }
  }, [editing, state, query]);

  const setState = useCallback((next: AtlasFilterState) => {
    if (editing) setDraft(next);
    else onStateChange(next);
  }, [editing, onStateChange]);

  const setQuery = useCallback((next: AtlasQuery) => {
    if (editing) setDraftQuery(next);
    else onQueryChange(next);
  }, [editing, onQueryChange]);

  /**
   * Facet counts, against the results that pass every OTHER filter — the same
   * rule the Leaflet atlases use for region pin counts, so a count tells you
   * what selecting it would give you.
   */
  const facets = useMemo(() => {
    const region: Record<string, number> = {};
    const brand: Record<string, number> = {};
    const month: Record<string, number> = {};
    const vessel: Record<string, number> = {};
    for (const o of offerings) {
      if (matchesExceptRegion(o, shown, d, today)) {
        for (const k of o.regions) region[k] = (region[k] || 0) + 1;
      }
      if (matchesOffering(o, shown, d, today)) {
        const b = d.brandField === "operator" ? o.operator : o.brand;
        if (b) brand[b] = (brand[b] || 0) + 1;
        for (const m of o.months) month[m] = (month[m] || 0) + 1;
        if (o.vessel) vessel[o.vessel] = (vessel[o.vessel] || 0) + 1;
      }
    }
    return { region, brand, month, vessel };
  }, [offerings, shown, d, today]);

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

  /**
   * Options + counts for the collection's extra axes. Counted against every
   * OTHER filter, same rule as the shared facets.
   */
  const facetOptions = useMemo(() => {
    const out: Record<string, [string, number | null][]> = {};
    for (const f of (d.facets || []).filter((x) => !x.hidden)) {
      const counts = new Map<string, number>();
      for (const o of offerings) {
        const raw = o.attributes?.[f.key];
        const v = Array.isArray(raw) ? raw[0] : raw;
        if (!v) continue;
        const others: AtlasFilterState = {
          ...shown,
          facets: { ...(shown.facets || {}), [f.key]: new Set<string>() },
        };
        if (!matchesOffering(o, others, d, today)) continue;
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      out[f.key] = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }
    return out;
  }, [offerings, shown, d, today]);

  /** What Apply will give you — computed on the DRAFT, so the button is honest. */
  const draftCount = useMemo(
    () => offerings.filter((o) => matchesOffering(o, shown, d, today)).length,
    [offerings, shown, d, today],
  );
  const liveCount = useMemo(
    () => offerings.filter((o) => matchesOffering(o, state, d, today)).length,
    [offerings, state, d, today],
  );

  // How many round-the-world itineraries survive the other filters.
  const worldCount = useMemo(
    () => offerings.filter((o) => o.world && matchesExceptRegion(o, { ...shown, world: undefined }, d, today)).length,
    [offerings, shown, d, today],
  );

  const anyActive = (s: AtlasFilterState) =>
    s.brands.size || s.vessels.size || s.months.size || s.ids.size ||
    s.regions.size || s.excludedRegions.size || s.stop || s.terms.length || s.world ||
    Object.values(s.facets || {}).some((v) => v.size);

  const set = (patch: Partial<AtlasFilterState>) => setState({ ...shown, ...patch });

  const stopLabel = d.stopParam === "port" ? "port" : "location";
  const roleOptions = ROLE_VALUES[d.roles];
  const stopListId = useId();
  const searchNoun =
    d.collection === "cruise" ? "sailings" :
    d.collection === "hotel" ? "hotels" :
    "journeys";

  const [stopText, setStopText] = useState(shown.stop || "");
  useEffect(() => { setStopText(shown.stop || ""); }, [shown.stop]);

  /**
   * Memoised, and not for tidiness: cruise has 1,622 ports and worldcruise 971,
   * so rebuilding this list meant React diffing ~1,600 <option> nodes on every
   * keystroke in the port box. It only ever changes when the offerings do.
   */
  const stopList = useMemo(
    () => (
      <datalist id={stopListId}>
        {options.stops.map((s) => <option key={s} value={s} />)}
      </datalist>
    ),
    [options.stops, stopListId],
  );

  /**
   * The free-text search is DEBOUNCED, not per-keystroke.
   *
   * Committing on every keystroke wrote the URL, which re-parsed the deep link,
   * re-filtered a few thousand offerings, re-plotted the globe — and then fed
   * the input its value back from the URL. Typing was a race against that work:
   * characters landed late, out of order, or were swallowed when a re-render
   * arrived mid-word. The text lives here now and a commit happens once you
   * pause, so the search still runs itself without being typed at.
   */
  const [qText, setQText] = useState(shownQuery.q);
  const qTimer = useRef<number | null>(null);
  // What we last handed upward. External changes (Reset, a deep link, the
  // mobile draft re-seeding) differ from it and re-seed the box; our own commit
  // echoing back through `query` does not, so it can't interrupt typing.
  const committedQ = useRef(shownQuery.q);
  const queryRef = useRef(shownQuery);
  queryRef.current = shownQuery;

  useEffect(() => {
    if (shownQuery.q === committedQ.current) return;
    committedQ.current = shownQuery.q;
    setQText(shownQuery.q);
  }, [shownQuery.q]);

  useEffect(() => () => { if (qTimer.current) window.clearTimeout(qTimer.current); }, []);

  const commitQ = useCallback((v: string) => {
    if (qTimer.current) window.clearTimeout(qTimer.current);
    qTimer.current = null;
    if (v === committedQ.current) return;
    committedQ.current = v;
    setQuery({ ...queryRef.current, q: v });
  }, [setQuery]);

  const typeQ = useCallback((v: string) => {
    setQText(v);
    if (qTimer.current) window.clearTimeout(qTimer.current);
    // Clearing the box is not a search-in-progress — put the full list back at
    // once rather than making someone wait out the pause for it.
    if (!v) { commitQ(""); return; }
    qTimer.current = window.setTimeout(() => commitQ(v), Q_DEBOUNCE_MS);
  }, [commitQ]);

  const reset = () => {
    if (qTimer.current) window.clearTimeout(qTimer.current);
    qTimer.current = null;
    committedQ.current = "";
    setQText("");
    setStopText("");
    if (editing) { setDraft(EMPTY_STATE()); setDraftQuery({ q: "", country: "" }); return; }
    // Desktop: one commit, same reason as Apply.
    if (onCommit) onCommit(EMPTY_STATE(), { q: "", country: "" });
    else { onStateChange(EMPTY_STATE()); onQueryChange({ q: "", country: "" }); }
  };

  const controls = (
    <>
      <select
        value={shown.world ? WORLD : selectValue(shown.regions)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === WORLD) { set({ world: true, regions: new Set() }); return; }
          set({ world: undefined, regions: single(v === MULTI ? "" : v) });
        }}
        aria-label="Region"
      >
        <option value="">All regions</option>
        {shown.regions.size > 1 && <option value={MULTI}>Several ({shown.regions.size})</option>}
        {/* Round-the-world itineraries cross every region, so they belong at
            the top of the region control rather than in the alphabet. This is
            the old worldBtn, put where people look for "where does it go". */}
        {worldCount > 0 && <option value={WORLD}>Around the World ({worldCount})</option>}
        {options.regions.map(([key, label]) => (
          <option key={key} value={key}>
            {label}{facets.region[key] != null ? ` (${facets.region[key]})` : ""}
          </option>
        ))}
      </select>

      {d.supportsBrandFilter !== false && (
      <select
        value={selectValue(shown.brands)}
        onChange={(e) => set({ brands: single(e.target.value === MULTI ? "" : e.target.value) })}
        aria-label={d.brandField === "operator" ? "Operator" : "Brand"}
      >
        <option value="">{d.brandField === "operator" ? "All operators" : "All brands"}</option>
        {shown.brands.size > 1 && <option value={MULTI}>Several ({shown.brands.size})</option>}
        {options.brands.map(([key, label]) => (
          <option key={key} value={key}>
            {label}{facets.brand[key] != null ? ` (${facets.brand[key]})` : ""}
          </option>
        ))}
      </select>
      )}

      {(d.facets || []).filter((f) => !f.hidden).map((f) => {
        const picked = shown.facets?.[f.key] ?? new Set<string>();
        const opts = facetOptions[f.key] || [];
        return (
          <select
            key={f.key}
            value={selectValue(picked)}
            onChange={(e) => {
              const v = e.target.value === MULTI ? "" : e.target.value;
              set({ facets: { ...(shown.facets || {}), [f.key]: single(v) } });
            }}
            aria-label={f.label}
          >
            <option value="">{f.allLabel}</option>
            {picked.size > 1 && <option value={MULTI}>Several ({picked.size})</option>}
            {opts.map(([value, count]) => (
              <option key={value} value={value}>
                {value}{count != null ? ` (${count})` : ""}
              </option>
            ))}
          </select>
        );
      })}

      {d.supportsMonthFilter !== false && (
      <select
        value={selectValue(shown.months)}
        onChange={(e) => set({ months: single(e.target.value === MULTI ? "" : e.target.value) })}
        aria-label="Month"
      >
        <option value="">Any month</option>
        {shown.months.size > 1 && <option value={MULTI}>Several ({shown.months.size})</option>}
        {options.months.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}{facets.month[m] != null ? ` (${facets.month[m]})` : ""}
          </option>
        ))}
      </select>
      )}

      {d.supportsVesselFilter && (
        <select
          value={selectValue(shown.vessels)}
          onChange={(e) => set({ vessels: single(e.target.value === MULTI ? "" : e.target.value) })}
          aria-label="Ship"
        >
          <option value="">Any ship</option>
          {shown.vessels.size > 1 && <option value={MULTI}>Several ({shown.vessels.size})</option>}
          {options.vessels.map((s) => (
            <option key={s} value={s}>
              {s}{facets.vessel[s] != null ? ` (${facets.vessel[s]})` : ""}
            </option>
          ))}
        </select>
      )}

      {d.supportsStopFilter !== false && (
      <>
      {/* Type-ahead, not a dropdown: cruise has 1,622 ports and worldcruise 971.
          The Leaflet atlases reached the same conclusion — their only static
          filter markup is #portSearch / #locationSearch. */}
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
            d.stopParam === "location" ? s.toLowerCase() === v.trim().toLowerCase() : s === v.trim(),
          );
          if (hit) set({ stop: hit });
          else if (!v.trim() && shown.stop) set({ stop: null });
        }}
        aria-label={d.stopParam === "port" ? "Port" : "Location"}
      />
      {stopList}

      <select
        value={shown.stopRole}
        onChange={(e) => set({ stopRole: e.target.value })}
        disabled={!shown.stop}
        aria-label={d.stopParam === "port" ? "Port role" : "Location role"}
      >
        {roleOptions.map((r) => (
          <option key={r} value={r}>
            {r === "any" ? "Anywhere on route" : r[0].toUpperCase() + r.slice(1)}
          </option>
        ))}
        {!roleOptions.includes("any") && <option value="any">Anywhere on route</option>}
      </select>
      </>
      )}

      <input
        className="villa-q"
        type="search"
        value={qText}
        placeholder={`Search ${searchNoun}…`}
        onChange={(e) => typeQ(e.target.value)}
        // Enter and leaving the field are both "I'm done" — search now instead
        // of sitting out the rest of the pause.
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitQ(qText); } }}
        onBlur={() => commitQ(qText)}
        aria-label="Search"
      />
    </>
  );

  // ── Desktop ───────────────────────────────────────────────────────────────
  if (!isMobile) {
    return (
      <div className="villa-filters" role="group" aria-label={`Filter ${d.collection}`}>
        {controls}
        {/* Everything from here right is ABOUT the results rather than a filter
            on them, so it sits in one group pushed to the far end instead of
            each item claiming its own auto-margin (which is what forced the
            count and Share onto a line of their own). */}
        <div className="atlas-railend">
          <span className="atlas-count" aria-live="polite">
            {liveCount.toLocaleString()} match{liveCount === 1 ? "" : "es"}
          </span>
          {trailing}
          {onShare && (
            <button type="button" className="atlas-share" onClick={onShare}>{shareLabel}</button>
          )}
          {!!anyActive(state) && (
            <button type="button" className="atlas-reset" onClick={reset}>Reset</button>
          )}
        </div>
      </div>
    );
  }

  // ── Mobile: pill → drawer → Apply ────────────────────────────────────────
  return (
    <>
      <div className="atlas-mobilebar">
        <button type="button" className="atlas-pill" onClick={() => setSheetOpen(true)}>
          Filters{anyActive(state) ? " ·" : ""}{" "}
          <span className="atlas-pillcount">{liveCount.toLocaleString()}</span>
        </button>
        {onShare && (
          <button type="button" className="atlas-share" onClick={onShare}>{shareLabel}</button>
        )}
      </div>

      {sheetOpen && (
        <>
          <div className="atlas-scrim" onClick={() => setSheetOpen(false)} aria-hidden />
          <div className="atlas-sheet" role="dialog" aria-modal="true" aria-label={`Filter ${d.collection}`}>
            <div className="atlas-sheethandle" />
            <div className="atlas-sheetbody">{controls}</div>
            <div className="atlas-sheetfoot">
              <button type="button" className="atlas-reset" onClick={reset}>Reset</button>
              {/* The count is the DRAFT's, so the button says what you will get
                  rather than what you already have. */}
              <button
                type="button"
                className="atlas-apply"
                onClick={() => {
                  // The search box debounces, so the last word typed may still
                  // be waiting out its pause. Apply means "use what I typed",
                  // not "use what happened to land" — take the box's text
                  // directly rather than relying on blur firing before this.
                  const q = { ...draftQuery, q: qText };
                  if (qTimer.current) window.clearTimeout(qTimer.current);
                  qTimer.current = null;
                  committedQ.current = qText;
                  if (onCommit) onCommit(draft, q);
                  else { onStateChange(draft); onQueryChange(q); }
                  setSheetOpen(false);
                }}
              >
                Apply · {draftCount.toLocaleString()}
              </button>
            </div>
          </div>
        </>
      )}
    </>
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

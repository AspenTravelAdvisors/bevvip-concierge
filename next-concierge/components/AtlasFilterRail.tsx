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
import { durationDays } from "@/lib/atlas/dates";
import { useIsMobile } from "@/lib/use-is-mobile";

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
  minDays: null, maxDays: null, world: undefined, facets: undefined,
});

/**
 * The trip-length wheels.
 *
 * Row height must match `--wheel-row` in globals.css: the picked value comes
 * from `scrollTop / ROW`, so a stylesheet that disagreed with this number
 * would quietly select the row above or below the one under the band.
 */
const WHEEL_ROW = 34;

/** One row on a wheel. `value: null` is the "Any" row that opens that end. */
interface DayRow { value: number | null; label: string; count: number | null }

/**
 * An iOS-style picker wheel over one end of the trip-length range.
 *
 * Scroll-snap does the physics — momentum, the snap itself, touch and
 * trackpad — so there is no drag maths here and it behaves natively on a
 * phone. This only translates between a scroll position and a value:
 *
 *   scrolling      the centred row lights up live, and the pick commits once
 *                  the wheel SETTLES. Committing per scroll event would write
 *                  the URL a dozen times on one flick.
 *   clicking a row scrolls it under the band and commits.
 *   arrow keys     the same, a row at a time. The container is the listbox and
 *                  carries the focus, so a 90-row wheel is one tab stop rather
 *                  than ninety.
 */
function DayWheel({ id, label, rows, value, onPick }: {
  id: string;
  label: string;
  rows: readonly DayRow[];
  value: number | null;
  onPick(next: number | null): void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const settle = useRef<number | null>(null);
  const index = Math.max(0, rows.findIndex((r) => r.value === value));
  const [centre, setCentre] = useState(index);

  // Centre the pick when the wheel appears, and when the value moves under it
  // (Reset, a deep link, the other wheel carrying this one). The half-row
  // threshold keeps this from fighting a snap still settling — after a scroll
  // the wheel is already where it belongs, give or take a pixel.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const target = index * WHEEL_ROW;
    if (Math.abs(el.scrollTop - target) > WHEEL_ROW / 2) el.scrollTop = target;
    setCentre(index);
    // rows.length as well as index: the other wheel narrowing this one's
    // options moves the selected row without changing what is selected.
  }, [index, rows.length]);

  useEffect(() => () => { if (settle.current) window.clearTimeout(settle.current); }, []);

  const rowAt = (i: number) => Math.min(rows.length - 1, Math.max(0, i));

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const i = rowAt(Math.round(el.scrollTop / WHEEL_ROW));
    setCentre(i);
    if (settle.current) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      settle.current = null;
      onPick(rows[i]?.value ?? null);
    }, 140);
  };

  const move = (to: number) => {
    const i = rowAt(to);
    listRef.current?.scrollTo({ top: i * WHEEL_ROW, behavior: "smooth" });
    setCentre(i);
    onPick(rows[i].value);
  };

  return (
    <div className="atlas-wheel">
      <span className="atlas-wheelhead">{label}</span>
      <div className="atlas-wheelbox">
        <div className="atlas-wheelband" aria-hidden />
        <div
          ref={listRef}
          className="atlas-wheellist"
          role="listbox"
          aria-label={label}
          tabIndex={0}
          aria-activedescendant={`${id}-${centre}`}
          onScroll={onScroll}
          onKeyDown={(e) => {
            const jump =
              e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 :
              e.key === "PageDown" ? 5 : e.key === "PageUp" ? -5 : 0;
            if (jump) { e.preventDefault(); move(centre + jump); return; }
            if (e.key === "Home") { e.preventDefault(); move(0); }
            if (e.key === "End") { e.preventDefault(); move(rows.length - 1); }
          }}
        >
          {rows.map((r, i) => (
            <div
              key={r.value ?? "any"}
              id={`${id}-${i}`}
              className="atlas-wheelrow"
              role="option"
              aria-selected={i === centre}
              onClick={() => move(i)}
            >
              <span className="atlas-wheelnum">{r.label}</span>
              {r.count != null && <span className="atlas-wheelcount">{r.count.toLocaleString()}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * How long typing has to stop before the free-text search runs. Long enough
 * that a normal typing rhythm never triggers it mid-word, short enough that it
 * still feels like the results are following you.
 */
const Q_DEBOUNCE_MS = 420;

/** Sentinel for the "Around the World" entry in the region control. */
const WORLD = "__world__";

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
    s.minDays != null || s.maxDays != null ||
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
   * The lengths this collection actually offers, each with how many trips are
   * that long once every OTHER filter is applied — the counting rule the
   * region and brand menus already use, so a row says what picking it would
   * give you. The trip-length bounds themselves are excluded from that count,
   * or picking 10 days would leave the wheel offering nothing but 10.
   *
   * Only lengths that EXIST get a row. Running 3…96 by integer would put 40
   * dead rows in the cruise wheel, and spinning past a number no sailing is
   * long enough to have is the wheel lying about the collection.
   */
  const dayRows = useMemo<DayRow[]>(() => {
    if (d.supportsDurationFilter === false) return [];
    const counts = new Map<number, number>();
    const open: AtlasFilterState = { ...shown, minDays: null, maxDays: null };
    let total = 0;
    for (const o of offerings) {
      const n = durationDays(o);
      if (n == null) continue;
      if (!matchesOffering(o, open, d, today)) continue;
      total++;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    return [
      { value: null, label: "Any", count: total || null },
      ...[...counts.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => ({
        value: n, label: String(n), count: c,
      })),
    ];
  }, [offerings, shown, d, today]);

  /**
   * On desktop the wheels live in a popover under the control; in the phone
   * drawer they are inline and always open. A popover inside a scrolling sheet
   * is a clipping problem with no good answer, and the drawer is where a wheel
   * is the natural control anyway — there is room for it there.
   */
  const [daysOpen, setDaysOpen] = useState(false);
  /**
   * Which way the popover opens, decided when it opens.
   *
   * The rail is sticky, so where it sits on screen depends on how far the page
   * has been scrolled: at the top of a collection page it is below the map and
   * near the bottom of the viewport, and a wheel that dropped downward from
   * there would open off-screen. Measured rather than assumed, and only on
   * open — a popover that re-flipped while being scrolled past would be worse
   * than one that opens in the wrong direction.
   */
  const [daysUp, setDaysUp] = useState(false);
  const daysRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!daysOpen) return;
    const box = daysRef.current?.getBoundingClientRect();
    // The popover's own height, near enough: five rows, heads, and the footer.
    if (box) setDaysUp(box.bottom + 270 > window.innerHeight && box.top > 270);
    const away = (e: MouseEvent) => {
      if (daysRef.current && !daysRef.current.contains(e.target as Node)) setDaysOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setDaysOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [daysOpen]);

  /**
   * Each wheel offers only what the other end allows: Max starts at the chosen
   * Min, Min stops at the chosen Max. An impossible window is therefore not
   * something the control can express.
   *
   * The alternative — offer everything and drag the other end along when they
   * cross — was tried and is worse. Spinning Max down from Any passes THROUGH
   * the short lengths on its way, so each row it crosses pulls Min down with
   * it: three presses of Down on the Max wheel silently rewrote a 7-day Min to
   * 3. A wheel that cannot reach an invalid value never has to correct one.
   */
  const minRows = useMemo(
    () => dayRows.filter((r) => r.value == null || shown.maxDays == null || r.value <= shown.maxDays),
    [dayRows, shown.maxDays],
  );
  const maxRows = useMemo(
    () => dayRows.filter((r) => r.value == null || shown.minDays == null || r.value >= shown.minDays),
    [dayRows, shown.minDays],
  );

  const pickMin = (v: number | null) => {
    if (v !== (shown.minDays ?? null)) set({ minDays: v });
  };
  const pickMax = (v: number | null) => {
    if (v !== (shown.maxDays ?? null)) set({ maxDays: v });
  };

  /** What the closed control says. The unit is spelled out; the numbers aren't. */
  const lengthLabel =
    shown.minDays == null && shown.maxDays == null ? "Any length"
    : shown.maxDays == null ? `${shown.minDays}+ days`
    : shown.minDays == null ? `Up to ${shown.maxDays} days`
    : shown.minDays === shown.maxDays ? `${shown.minDays} days`
    : `${shown.minDays}–${shown.maxDays} days`;

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
        /*
         * An axis too wide to be a menu yet.
         *
         * City is the case this exists for: 1,044 of them across the hotel
         * atlas, at most 189 once a country is chosen. A thousand-row dropdown
         * is not a filter anyone can read, so the control waits — and because
         * facet options are counted against every other filter, what it waits
         * for is any narrowing at all: a country, a region small enough, a
         * search. It then appears next to the control that revealed it, which
         * is where "…and now which city?" is actually asked.
         *
         * Waiting rather than sitting there disabled is a decision about the
         * rail, not about the axis: an inert control still costs a slot, and
         * the hotel rail at 1280px is already full — a permanent "pick a
         * country first" would wrap the count, Share and Sort onto a second row
         * for every visitor, including the ones who never filter by city.
         *
         * Anything already picked on the axis keeps the control open, so a
         * `?city=` deep link is never left with no way to clear itself.
         */
        if (f.menuLimit != null && opts.length > f.menuLimit && !picked.size) return null;
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

      {/* Trip length — two wheels over a min and a max.
          A pair of wheels rather than one menu of buckets: the collections
          disagree too much for one set of buckets to serve them (rail runs 2
          to 19 days, world cruises 50 to 245), and "15+ days" is the wrong
          tool for someone with exactly nine free days. Two ends say the same
          thing at every scale, and either may stay open. */}
      {d.supportsDurationFilter !== false && dayRows.length > 1 && (
        <div className={`atlas-days${daysOpen ? " open" : ""}`} ref={daysRef}>
          {/* In the drawer the wheels are the control; on desktop this button
              is, and the wheels drop out of it. */}
          {!editing && (
            <button
              type="button"
              className="atlas-daysbtn"
              aria-haspopup="dialog"
              aria-expanded={daysOpen}
              onClick={() => setDaysOpen((o) => !o)}
            >
              <span className="atlas-dayslabel">Length</span>
              <span className="atlas-daysvalue">{lengthLabel}</span>
            </button>
          )}
          {(editing || daysOpen) && (
            <div
              className={`atlas-dayspop${editing ? " inline" : daysUp ? " up" : ""}`}
              role={editing ? undefined : "dialog"}
              aria-label="Trip length in days"
            >
              {/* The drawer has no trigger button to name the control, so the
                  wheels carry their own caption there. */}
              {editing && <span className="atlas-dayscaption">Trip length</span>}
              <div className="atlas-wheels">
                <DayWheel id="atlas-minday" label="Min" rows={minRows} value={shown.minDays ?? null} onPick={pickMin} />
                <span className="atlas-wheelsdash" aria-hidden>–</span>
                <DayWheel id="atlas-maxday" label="Max" rows={maxRows} value={shown.maxDays ?? null} onPick={pickMax} />
                <span className="atlas-wheelsunit" aria-hidden>days</span>
              </div>
              {/* Says what the two wheels currently add up to, so the reading
                  of the range is never left to the person doing the spinning. */}
              <div className="atlas-daysfoot">
                <span className="atlas-daysread">{lengthLabel}</span>
                {(shown.minDays != null || shown.maxDays != null) && (
                  <button
                    type="button"
                    className="atlas-daysany"
                    onClick={() => set({ minDays: null, maxDays: null })}
                  >
                    Any length
                  </button>
                )}
                {!editing && (
                  <button type="button" className="atlas-daysdone" onClick={() => setDaysOpen(false)}>
                    Done
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
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

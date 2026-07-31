"use client";

/**
 * A collection browsed on the globe — the replacement for one iframed Leaflet
 * atlas.
 *
 * Composes pieces that already exist and are already verified rather than
 * introducing a fourth map product:
 *
 *   AtlasShell        the Mapbox globe, scoped to this collection's layer
 *   adapters/*        itinerary.json → AtlasOffering[] (parity-tested)
 *   params.ts         deep links in, Share links out (parity-tested)
 *   AtlasFilterRail   one rail, driven by the descriptor
 *
 * The globe shows ambient region pins plus ONE traced route — the interaction
 * the Leaflet atlases had. It deliberately does not reuse The Guide's
 * `bevvip:atlas-plot` path; see the note above the trace helpers for why.
 *
 * The URL is the source of truth for filter state. Every change rewrites the
 * query string, so the browser's Share/copy-URL gives a link identical in shape
 * to the ones the old Share buttons produced — and every link those buttons
 * ever produced still parses (see D3-FILTER-INVENTORY.md).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { OfferingType } from "@/lib/types";
import type { AtlasFilterDescriptor, AtlasOffering } from "@/lib/atlas/adapters/types";
import { matchesOffering, type AtlasFilterState } from "@/lib/atlas/adapters/filter";
import { parseDeepLink, toSearchParams, type ParseContext } from "@/lib/atlas/adapters/params";
import { whenLabelFor, sortOfferings, SORT_MODES, type SortMode } from "@/lib/atlas/dates";
import AtlasFilterRail, { type AtlasQuery } from "./AtlasFilterRail";
import AtlasShell, { type StyleKey } from "./AtlasShell";
import BrandLogo, { type BrandMark } from "./BrandLogo";
import { internalAtlasLink } from "@/lib/atlas-config";

/** One drawable leg of a traced route, already in [lng, lat]. */
export interface RouteLegOut {
  mode: string;
  coordinates: [number, number][];
}

interface Props {
  type: OfferingType;
  descriptor: AtlasFilterDescriptor;
  /** Collection accent for routes and stop dots — the atlas's own --accent. */
  accent?: string;
  /** Basemap this collection opens on. */
  initialStyle?: StyleKey;
  /** false → open flat. Long-haul arcs read better in 2D. */
  initialGlobe?: boolean;
  /**
   * A secondary action on every card. Hotels use it for "See it in 3D", which
   * hands off to the Google Photorealistic view — the one thing Mapbox has no
   * answer to, and the reason that engine survives.
   *
   * It used to be the loudest thing on the card (filled gold). It now sits at
   * the same weight as "Ask The Guide": inspecting a building is a lovely
   * detour, but it is not the action a traveller came to take.
   */
  cardAction?: { label: string; onSelect: (o: AtlasOffering) => void };
  /**
   * The card's PRIMARY action, rendered first and given the filled treatment.
   *
   * Hotels use it for the VIP rate search. The collection owns the rendering
   * (it may need to resolve a link asynchronously) and this component only
   * decides where it sits in the hierarchy — which is the whole point: exactly
   * one filled button per card, and it is the one that starts a booking.
   */
  cardPrimary?: (o: AtlasOffering) => React.ReactNode;
  /**
   * The ids currently on screen, whenever that set changes.
   *
   * Lets a collection resolve `cardPrimary` links for the visible cards in one
   * batch instead of per card — 120 cards, one request.
   */
  onVisibleIds?: (ids: string[]) => void;
  /** Loads and adapts this collection's raw feed. Collection-specific. */
  load: () => Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
    /**
     * Real route geometry for one offering, when the collection has it.
     * Rail ships actual track polylines; without this a traced route falls back
     * to straight legs between stops, which is honest but much less useful.
     */
    routeFor?: (o: AtlasOffering) => RouteLegOut[] | null;
    /** Brand marks for logos — key, display name, domain, brand colour. */
    brandMarks?: Record<string, BrandMark>;
    /** Where bundled logo assets live, e.g. "/maps/train/logos". */
    logoBase?: string;
  }>;
}

const dayRange = (a: number | null, b: number | null) =>
  a == null ? "" : a === b ? `Day ${a}` : `Days ${a}-${b}`;

/**
 * Sort options, in menu order. `departure` is the default and deliberately
 * first: the list is capped at 120 cards, so whatever leads the order is the
 * only part of a 3,239-sailing collection most people ever see.
 */
const SORT_LABELS: Record<SortMode, string> = {
  "departure": "Next departure",
  "duration-desc": "Longest first",
  "duration-asc": "Shortest first",
  "name": "Name (A–Z)",
};

/**
 * How many cards the list renders. Named rather than inlined because the sort
 * order and this cap are one decision: the cap is only defensible if the cards
 * it keeps are the ones worth keeping.
 */
const CARD_LIMIT = 120;

/** Only ever trust a `sort=` the menu can actually render. */
const readSort = (raw: string | null): SortMode =>
  (SORT_MODES as readonly string[]).includes(raw || "") ? (raw as SortMode) : "departure";

/**
 * A single day inside an expanded itinerary — "25 Oct", no year.
 *
 * The year is deliberately absent HERE and only here. These rows sit under a
 * card header that now prints the full range with years, so repeating 2026 on
 * every one of a 245-day world cruise's day lines adds noise without adding
 * information. Card-level dates go through formatRange, which always carries
 * the year; see lib/atlas/dates.js.
 *
 * Parsed as UTC and formatted as UTC. The old implementation appended
 * "T00:00:00" (local) and let toLocaleDateString use the local zone — west of
 * UTC that renders midnight as the PREVIOUS day, so a traveler in Los Angeles
 * saw every itinerary date shifted one day early.
 */
const fmtDay = (iso?: string | null) =>
  iso
    ? new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
        day: "numeric", month: "short", timeZone: "UTC",
      })
    : "";

export default function AtlasCollection({
  type, descriptor, load, accent, initialStyle, initialGlobe, cardAction,
  cardPrimary, onVisibleIds,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [offerings, setOfferings] = useState<AtlasOffering[] | null>(null);
  const [ctx, setCtx] = useState<ParseContext | null>(null);
  const [regionLabels, setRegionLabels] = useState<Record<string, string>>({});
  const [routeFor, setRouteFor] = useState<{ fn?: (o: AtlasOffering) => RouteLegOut[] | null }>({});
  const [brandMarks, setBrandMarks] = useState<Record<string, BrandMark>>({});
  const [logoBase, setLogoBase] = useState("");
  const [failed, setFailed] = useState(false);
  /**
   * The pinned trip, mirroring the Leaflet atlas's `routeLocked` + `pinnedTrip`.
   * Hover is a PREVIEW; a click pins. While something is pinned, hovering other
   * cards does not steal the map, and leaving a card restores the pinned route
   * rather than clearing it — which is why "the route vanishes when I click" was
   * the right complaint about a hover-only trace.
   */
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const hoverTimer = useRef<number | null>(null);
  // Live map view, so Share can capture basemap + projection + camera.
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<{ style: string; globe: boolean; center: { lng: number; lat: number }; zoom: number } | null>(null);
  const [shared, setShared] = useState(false);

  // Today, pinned once per mount so the past-trip cutoff can't shift mid-session.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((r) => {
        if (cancelled) return;
        setOfferings(r.offerings);
        setCtx(r.ctx);
        setRegionLabels(r.regionLabels);
        setRouteFor({ fn: r.routeFor });
        setBrandMarks(r.brandMarks || {});
        setLogoBase(r.logoBase || "");
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [load]);

  // Filter state derives from the URL, so back/forward and shared links all
  // behave without a second source of truth.
  const parsed = useMemo(() => {
    if (!ctx) return null;
    return parseDeepLink(new URLSearchParams(searchParams.toString()), descriptor, ctx);
  }, [searchParams, descriptor, ctx]);

  const state: AtlasFilterState | null = parsed?.state ?? null;
  const query: AtlasQuery = useMemo(
    () => ({ q: searchParams.get("q") || "", country: searchParams.get("country") || "" }),
    [searchParams],
  );

  // Sort lives in the URL alongside the filters, so a shared link reproduces
  // the list someone was actually looking at rather than just its contents.
  const sort = useMemo(() => readSort(searchParams.get("sort")), [searchParams]);

  const filtered = useMemo(() => {
    if (!offerings || !state) return [];
    const matched = offerings.filter((o) => matchesOffering(o, state, descriptor, today));
    // Ordering, not just filtering. Before this the list was rendered in feed
    // order and then truncated to 120 — so an expedition-cruise browser saw
    // 120 arbitrary sailings out of 3,239 rather than the next 120 to sail.
    return sortOfferings(matched, sort);
  }, [offerings, state, descriptor, today, sort]);

  // The cards actually rendered. Named once so the list and the batch that
  // resolves their primary CTAs can never disagree about which those are.
  const visible = useMemo(() => filtered.slice(0, CARD_LIMIT), [filtered]);
  const visibleKey = useMemo(() => visible.map((o) => o.id).join(","), [visible]);
  useEffect(() => {
    if (!onVisibleIds) return;
    onVisibleIds(visibleKey ? visibleKey.split(",") : []);
    // visibleKey, not `visible`: a new array with the same ids must not refetch.
  }, [visibleKey, onVisibleIds]);

  /** Push a new filter state into the URL; the memo above picks it back up. */
  const writeUrl = useCallback(
    (next: AtlasFilterState, nextQuery: AtlasQuery) => {
      const qs = toSearchParams(next, parsed?.view ?? {}, descriptor, {
        q: nextQuery.q,
        country: nextQuery.country,
      });
      // Re-attached rather than threaded through toSearchParams: that function
      // is the deep-link contract the Leaflet atlases established and
      // verify-deeplinks round-trips 291 assertions against it. Sort is a view
      // preference, not a filter, and adding a param there would change a
      // shared surface to carry something no atlas ever emitted. Omitted at the
      // default so ordinary links stay clean.
      if (sort !== "departure") qs.set("sort", sort);
      const s = qs.toString();
      router.replace(s ? `/atlas/${type}?${s}` : `/atlas/${type}`, { scroll: false });
    },
    [router, type, descriptor, parsed?.view, sort],
  );

  /** Change the ordering, preserving every filter currently in the URL. */
  const setSort = useCallback(
    (next: SortMode) => {
      const qs = new URLSearchParams(searchParams.toString());
      if (next === "departure") qs.delete("sort");
      else qs.set("sort", next);
      const s = qs.toString();
      router.replace(s ? `/atlas/${type}?${s}` : `/atlas/${type}`, { scroll: false });
    },
    [router, type, searchParams],
  );

  /**
   * Trace one trip's route on the globe — hover previews, click pins. This is
   * the interaction the Leaflet atlases had, and drawing a whole collection's
   * routes at once is not a substitute for it.
   *
   * Note what is deliberately absent: these pages do NOT dispatch
   * `bevvip:atlas-plot`. Reusing The Guide's plot path looked economical and
   * was wrong three ways — it drops a "N plotted / Reset" badge belonging to
   * the chat, it frames the camera on a generic pin rather than the journey,
   * and `plotResults` writes sessionStorage under `bevvip:atlas:last-plot`,
   * which the HOME globe replays on boot. Browsing a collection would have
   * poisoned the home page with that collection's trips.
   */
  const emitRoute = useCallback(
    (o: AtlasOffering | null, fit = false) => {
      if (!o) {
        window.dispatchEvent(new CustomEvent("bevvip:atlas-route", { detail: { legs: [] } }));
        return;
      }
      const real = routeFor.fn?.(o) ?? null;
      const legs: RouteLegOut[] = real ?? (() => {
        // No shipped geometry: draw straight legs between located stops rather
        // than inventing a curve the vehicle does not travel.
        const pts = o.stops.filter((s) => s.at).map((s) => [s.at![0], s.at![1]] as [number, number]);
        return pts.length >= 2 ? [{ mode: "arc", coordinates: pts }] : [];
      })();
      // A click always moves the camera. When a trip has no drawable geometry
      // at all, fall back to framing its located stops so clicking a card is
      // never a no-op.
      const fallback = legs.length
        ? []
        : o.stops.filter((s) => s.at).map((s) => [s.at![0], s.at![1]] as [number, number]);
      // Stops travel with the route: the globe draws them as numbered dots with
      // hover labels, as the Leaflet atlas did.
      const stops = o.stops
        .filter((s) => s.at)
        .map((s) => ({ name: s.name, at: [s.at![0], s.at![1]] as [number, number], day: s.day ?? null }));
      window.dispatchEvent(
        new CustomEvent("bevvip:atlas-route", {
          detail: { legs, stops, fit, fitPoints: fallback.length ? fallback : undefined },
        }),
      );
    },
    [routeFor],
  );

  /**
   * Frame a SET of offerings without tracing any one of them.
   *
   * Uses real route geometry where the collection ships it, falling back to
   * located stops — so a shortlist of yacht sailings frames the water they
   * actually cover, not the bounding box of their embarkation ports.
   */
  const fitOfferings = useCallback(
    (list: AtlasOffering[]) => {
      const pts: [number, number][] = [];
      for (const o of list) {
        const real = routeFor.fn?.(o);
        if (real?.length) {
          for (const leg of real) for (const c of leg.coordinates) pts.push(c);
        } else if (o.path.length) {
          for (const c of o.path) pts.push([c[0], c[1]]);
        } else {
          for (const s of o.stops) if (s.at) pts.push([s.at[0], s.at[1]]);
        }
      }
      if (!pts.length) return;
      window.dispatchEvent(
        new CustomEvent("bevvip:atlas-route", {
          detail: { legs: [], fit: true, fitPoints: pts },
        }),
      );
    },
    [routeFor],
  );

  const byId = useMemo(() => new Map(filtered.map((o) => [o.id, o])), [filtered]);

  /** Hover previews a route — but never over a pinned one. 170ms debounce
   *  matches the original, so dragging the pointer across the grid doesn't
   *  thrash the map. */
  const previewRoute = useCallback(
    (o: AtlasOffering) => {
      if (pinnedId) return;
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => emitRoute(o), 170);
    },
    [pinnedId, emitRoute],
  );

  /** Leaving a card restores the pinned route, or clears when nothing is pinned. */
  const endPreview = useCallback(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (pinnedId) {
      const pinned = byId.get(pinnedId);
      if (pinned) emitRoute(pinned);
      return;
    }
    emitRoute(null);
  }, [pinnedId, byId, emitRoute]);

  /** Click pins; clicking the pinned card again releases it. */
  const togglePin = useCallback(
    (o: AtlasOffering) => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      if (pinnedId === o.id) {
        setPinnedId(null);
        emitRoute(null);
        return;
      }
      setPinnedId(o.id);
      emitRoute(o, true);
      // On a phone the map is above the fold and the cards are below it, so
      // tapping a card traces a route you cannot see — it reads as nothing
      // happening. Bring the map back into view. Desktop shows both at once
      // and must not jump.
      if (window.matchMedia("(max-width: 680px)").matches) {
        mapWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [pinnedId, emitRoute],
  );

  /**
   * A deep link that resolves to exactly one trip opens it — pinned, traced and
   * framed. The Leaflet atlas did this in highlightDeepLinkIds():
   * `if (state.ids.size === 1 && hit.length === 1) openDetail(hit[0])`.
   * Without it, /atlas/train?ids=15694760 shows the whole globe and leaves the
   * traveller to find their own journey in the grid.
   */
  const autoPinned = useRef(false);
  useEffect(() => {
    if (autoPinned.current || !state) return;
    if (!state.ids.size || filtered.length !== 1) return;
    autoPinned.current = true;
    setPinnedId(filtered[0].id);
    emitRoute(filtered[0], true);
  }, [state, filtered, emitRoute]);

  /**
   * A region pin filters to that region. Toggling: clicking the pin of the
   * region you are already in clears it, so the map is a filter control rather
   * than a one-way trip. Writes through the URL like every other filter, so the
   * rail's Region select follows and the link stays shareable.
   */
  const selectRegion = useCallback(
    (regionKey: string) => {
      if (!state) return;
      const already = state.regions.size === 1 && state.regions.has(regionKey);
      writeUrl({ ...state, regions: new Set(already ? [] : [regionKey]) }, query);
    },
    [state, query, writeUrl],
  );

  /**
   * Build a link that reproduces exactly what is on screen and copy it.
   *
   * This is an advisor tool: the share has to carry the filters (regions,
   * supplier, ships, month, port/location + role, free text), the pinned
   * journey, AND the view — basemap, 2D/3D, and the exact camera. A link that
   * only carries filters drops the client into a different-looking map.
   */
  const share = useCallback(async () => {
    if (!state) return;
    const v = viewRef.current;
    const qs = toSearchParams(
      state,
      {
        ...(parsed?.view ?? {}),
        trip: pinnedId,
        style: v?.style ?? initialStyle ?? null,
        flat: v ? !v.globe : initialGlobe === false,
        camera: v ? { lng: v.center.lng, lat: v.center.lat, zoom: v.zoom } : null,
      },
      descriptor,
      { q: query.q, country: query.country },
    );
    const url = `${window.location.origin}/atlas/${type}${qs.toString() ? `?${qs}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 1600);
    } catch {
      // Clipboard can be blocked; put it in the URL bar so it is still copyable.
      router.replace(url.replace(window.location.origin, ""), { scroll: false });
    }
  }, [state, parsed?.view, pinnedId, descriptor, query, type, router, initialStyle, initialGlobe]);

  // `trip=` pins a journey, the same param the Leaflet Share button emitted.
  const autoTripped = useRef(false);
  /**
   * Arriving from the Guide's "Open in the Atlas": frame what was sent.
   *
   * This used to key off `trip=` alone, which only the atlas's own Share button
   * emits. The Guide sends `ids=` — so every chat handoff except a single
   * hotel landed on an unmoved map with no route traced: the shortlist was
   * correctly filtered in the card list and completely invisible on the globe.
   * (Hotels appeared to work only because they had a bespoke `ids` fallback.)
   *
   * Three cases, because framing a set is not the same gesture as tracing one:
   *   trip=            the atlas's own link — pin and trace it
   *   one result       the same thing: pin, trace, fly
   *   several results  fit ALL of them. Tracing one of five would be an
   *                    arbitrary choice presented as an answer.
   */
  useEffect(() => {
    if (autoTripped.current || !filtered.length || !state) return;
    const explicit = parsed?.view.trip;
    if (!explicit && !state.ids.size) return;

    // For collections where `ids` filters, `filtered` IS the shortlist; for
    // highlight-only ones (hotels) it is the whole field, so match explicitly.
    const shortlist = state.ids.size
      ? filtered.filter((o) => o.idAliases.some((a) => state.ids.has(a)))
      : [];

    const wanted = explicit || (shortlist.length === 1 ? shortlist[0].id : null);
    if (wanted) {
      const hit = filtered.find((o) => o.idAliases.includes(wanted) || o.id === wanted);
      if (hit) {
        autoTripped.current = true;
        setPinnedId(hit.id);
        emitRoute(hit, !parsed?.view.camera); // an explicit camera wins over fitting
        return;
      }
    }
    if (shortlist.length > 1) {
      autoTripped.current = true;
      if (!parsed?.view.camera) fitOfferings(shortlist);
    }
  }, [parsed?.view.trip, parsed?.view.camera, filtered, emitRoute, fitOfferings, state]);

  // A pinned trip that filtering removes from the list should release its pin.
  useEffect(() => {
    if (pinnedId && !byId.has(pinnedId)) {
      setPinnedId(null);
      emitRoute(null);
    }
  }, [pinnedId, byId, emitRoute]);

  if (failed) {
    return (
      <div className="atlas-collection">
        <p className="atlas-empty">
          This collection could not be loaded.{" "}
          <a href={`/maps/${type}/index.html`}>Open the standalone atlas →</a>
        </p>
      </div>
    );
  }

  return (
    <div className="atlas-collection">
      <div ref={mapWrapRef} className="atlas-mapwrap">
      {/* No routesAlways for rail: an ambient layer of every route at once is
          not what the Leaflet atlas did, and for trains it would have to be
          drawn from arcs, which is wrong. Routes trace one at a time from real
          geometry on card hover/click — see traceRoute. */}
      <AtlasShell
        type={type}
        region={null}
        externalLink={internalAtlasLink(type)}
        // No ambient web of every route. A collection page traces ONE route;
        // drawing all of them underneath buries it.
        ambientRoutes={false}
        onRegionSelect={selectRegion}
        accent={accent}
        // A shared link's basemap/projection/camera override the collection's
        // own defaults — the whole point of sharing a view.
        initialStyle={(parsed?.view.style as StyleKey | null) ?? initialStyle}
        initialGlobe={parsed?.view.flat ? false : initialGlobe}
        initialCamera={parsed?.view.camera ?? null}
        onViewChange={(v) => { viewRef.current = v; }}
      />
      </div>

      {state && offerings ? (
        <AtlasFilterRail
          descriptor={descriptor}
          offerings={offerings}
          state={state}
          query={query}
          regionLabels={regionLabels}
          today={today}
          onStateChange={(next) => writeUrl(next, query)}
          onQueryChange={(next) => state && writeUrl(state, next)}
          onCommit={(nextState, nextQuery) => writeUrl(nextState, nextQuery)}
          onShare={share}
          shareLabel={shared ? "Link copied" : "Share"}
          trailing={
            <>
              {filtered.length > CARD_LIMIT && (
                <span className="atlas-showing">first {CARD_LIMIT}</span>
              )}
              <label className="atlas-sort">
                <span>Sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(readSort(e.target.value))}
                  aria-label="Sort results"
                >
                  {SORT_MODES.map((m) => (
                    <option key={m} value={m}>{SORT_LABELS[m]}</option>
                  ))}
                </select>
              </label>
            </>
          }
        />
      ) : (
        <div className="villa-filters" aria-busy="true">
          <span className="atlas-count">Loading…</span>
        </div>
      )}

      {/* Guaranteed scroll target between the map and the cards. Mapbox eats
          vertical drags, so without this the only grabbable area on a phone is
          whatever gap is left over — which was a few pixels. */}
      <div className="atlas-scrollcue">
        {/*
          An explicit way out of a traced route.
          Releasing a pin was only possible by finding the same card again and
          clicking it a second time — an undo whose control is wherever you
          happened to leave the list, and invisible if you scrolled or filtered
          since. Naming what is traced also answers "which one is this?" without
          hunting for the highlighted card.
        */}
        {pinnedId && byId.get(pinnedId) ? (
          <>
            <span className="atlas-tracing">
              Tracing <strong>{byId.get(pinnedId)!.title}</strong>
            </span>
            <button
              type="button"
              className="atlas-untrace"
              onClick={() => { setPinnedId(null); emitRoute(null); }}
            >
              Clear route
            </button>
          </>
        ) : (
          <>{filtered.length.toLocaleString()} {filtered.length === 1 ? "result" : "results"}</>
        )}
      </div>

      {/*
        MOBILE ONLY (CSS hides it above 680px).
        On desktop the same two things now ride in the filter rail via its
        `trailing` slot — one row instead of a rail, a count line and a sort
        line all describing the same result set. On phones the rail collapses to
        a Filters pill with no room for them, so they keep this bar.
      */}
      <div className="atlas-sortbar">
        {/* Say so when the list is truncated. 120 of 3,239 was silent before,
            which made "where did the sailing I just saw go?" unanswerable. */}
        <span className="atlas-showing">
          {filtered.length > CARD_LIMIT
            ? `Showing the first ${CARD_LIMIT} of ${filtered.length.toLocaleString()}`
            : ""}
        </span>
        <label className="atlas-sort">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(readSort(e.target.value))}
            aria-label="Sort results"
          >
            {SORT_MODES.map((m) => (
              <option key={m} value={m}>{SORT_LABELS[m]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="atlas-results">
        {visible.map((o) => (
          <article
            key={o.id}
            className={`atlas-card${o.world ? " world" : ""}`}
            data-pinned={pinnedId === o.id ? "" : undefined}
            onMouseEnter={() => previewRoute(o)}
            onMouseLeave={endPreview}
            onFocus={() => previewRoute(o)}
            onBlur={endPreview}
            onClick={() => togglePin(o)}
          >
            <div className="ac-head">
              {/* Look the mark up by whichever field this collection filters
                  on. cruise has NO brand — its marks are keyed by operator
                  name — so a `o.brand`-only lookup silently dropped every
                  cruise logo. */}
              {(() => {
                const markKey = o.logoKey ?? (descriptor.brandField === "operator" ? o.operator : o.brand);
                if (!markKey && !o.operator) return null;
                return (
                  <BrandLogo
                    brand={
                      brandMarks[markKey || ""] || {
                        key: markKey || o.operator || "",
                        short: o.brandLabel || o.operator,
                      }
                    }
                    assetBase={logoBase}
                  />
                );
              })()}
              <div className="ac-headtext">
                <h3>{o.title}</h3>
                {/* Date line, mirroring the original's three cases: a real range
                    (plus a departures count when the product runs many dates),
                    an on-demand window, or nothing scheduled at all. */}
                <p className="ac-when">
                  {[
                    // Start, end and year for anything dated; the booking
                    // window for on-demand journeys; "On demand" for the rest.
                    // All three cases now live in whenLabelFor so the globe and
                    // the Guide's result cards cannot drift apart — they used
                    // to, and the globe was the one printing no year.
                    whenLabelFor(o),
                    o.departures && o.departures > 1 ? `${o.departures} departures` : null,
                  ].filter(Boolean).join("  ·  ")}
                </p>
              </div>
            </div>

            <p className="ac-meta">
              {[
                o.vessel || o.brandLabel || o.operator,
                o.days ? `${o.days} days` : null,
                o.stops.length ? `${o.stops.length} stops` : null,
              ].filter(Boolean).join("  ·  ")}
            </p>

            {/* The route as text, so a card is readable without the map. */}
            {o.stops.length > 1 && (
              <p className="ac-path">{o.stops.map((st) => st.name).join(" → ")}</p>
            )}

            {o.itinerary.length > 0 && (
              <details className="ac-itin" onClick={(e) => e.stopPropagation()}>
                <summary>Day-by-day itinerary</summary>
                {o.itinerary.map((r, i) => (
                  <div className="ac-dayline" key={`${r.name}-${i}`}>
                    <b>{dayRange(r.startDay, r.endDay)}</b>
                    {r.startDate ? ` · ${fmtDay(r.startDate)}` : ""} · {r.name}
                  </div>
                ))}
              </details>
            )}

            <div className="ac-actions">
              {/* The two boxed actions sit together, then the plain links.
                  Splitting them with "View details" made a matched pair read as
                  two unrelated controls. */}
              {cardPrimary?.(o)}
              {cardAction && (
                <button
                  type="button"
                  className="ac-3d"
                  onClick={(e) => { e.stopPropagation(); cardAction.onSelect(o); }}
                >
                  {cardAction.label}
                </button>
              )}
              {o.url && (
                <a
                  className="ac-link"
                  href={o.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  View details ↗
                </a>
              )}
              {/* Same escape hatch the Leaflet cards had: ask instead of filter. */}
              <button
                type="button"
                className="ac-ask"
                onClick={(e) => {
                  e.stopPropagation();
                  const ctx = `${o.title}${o.url ? ` (listing: ${o.url})` : ""}`;
                  router.push(`/?ask=${encodeURIComponent(ctx)}&src=${type}`);
                }}
              >
                ✦ Ask The Guide
              </button>
            </div>
          </article>
        ))}
        {!!filtered.length && filtered.length > 120 && (
          <p className="atlas-more">
            Showing 120 of {filtered.length.toLocaleString()} — narrow the filters to see the rest.
          </p>
        )}
        {state && offerings && !filtered.length && (
          <p className="atlas-empty">Nothing matches those filters.</p>
        )}
      </div>
    </div>
  );
}

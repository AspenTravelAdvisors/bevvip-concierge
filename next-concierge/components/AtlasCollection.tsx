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
import AtlasFilterRail, { type AtlasQuery } from "./AtlasFilterRail";
import AtlasShell from "./AtlasShell";
import { internalAtlasLink } from "@/lib/atlas-config";

/** One drawable leg of a traced route, already in [lng, lat]. */
export interface RouteLegOut {
  mode: string;
  coordinates: [number, number][];
}

interface Props {
  type: OfferingType;
  descriptor: AtlasFilterDescriptor;
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
  }>;
}

export default function AtlasCollection({ type, descriptor, load }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [offerings, setOfferings] = useState<AtlasOffering[] | null>(null);
  const [ctx, setCtx] = useState<ParseContext | null>(null);
  const [regionLabels, setRegionLabels] = useState<Record<string, string>>({});
  const [routeFor, setRouteFor] = useState<{ fn?: (o: AtlasOffering) => RouteLegOut[] | null }>({});
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

  const filtered = useMemo(() => {
    if (!offerings || !state) return [];
    return offerings.filter((o) => matchesOffering(o, state, descriptor, today));
  }, [offerings, state, descriptor, today]);

  /** Push a new filter state into the URL; the memo above picks it back up. */
  const writeUrl = useCallback(
    (next: AtlasFilterState, nextQuery: AtlasQuery) => {
      const qs = toSearchParams(next, parsed?.view ?? {}, descriptor, {
        q: nextQuery.q,
        country: nextQuery.country,
      });
      const s = qs.toString();
      router.replace(s ? `/atlas/${type}?${s}` : `/atlas/${type}`, { scroll: false });
    },
    [router, type, descriptor, parsed?.view],
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
      window.dispatchEvent(
        new CustomEvent("bevvip:atlas-route", {
          detail: { legs, fit, fitPoints: fallback.length ? fallback : undefined },
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
      {/* No routesAlways for rail: an ambient layer of every route at once is
          not what the Leaflet atlas did, and for trains it would have to be
          drawn from arcs, which is wrong. Routes trace one at a time from real
          geometry on card hover/click — see traceRoute. */}
      <AtlasShell
        type={type}
        region={null}
        externalLink={internalAtlasLink(type)}
        onRegionSelect={selectRegion}
      />

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
        />
      ) : (
        <div className="villa-filters" aria-busy="true">
          <span className="atlas-count">Loading…</span>
        </div>
      )}

      <div className="atlas-results">
        {filtered.slice(0, 120).map((o) => (
          <article
            key={o.id}
            className="atlas-card"
            data-pinned={pinnedId === o.id ? "" : undefined}
            onMouseEnter={() => previewRoute(o)}
            onMouseLeave={endPreview}
            onFocus={() => previewRoute(o)}
            onBlur={endPreview}
            onClick={() => togglePin(o)}
          >
            <h3>{o.title}</h3>
            <p className="ac-meta">
              {[o.brandLabel || o.operator, o.vessel, o.regions.map((k) => regionLabels[k] || k).join(", ")]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="ac-when">
              {[
                o.startDate ? new Date(o.startDate + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : o.window,
                o.days ? `${o.days} days` : null,
                o.departures && o.departures > 1 ? `${o.departures} departures` : null,
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </p>
            {o.url && (
              <a className="ac-link" href={o.url} target="_blank" rel="noopener noreferrer">
                View details →
              </a>
            )}
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

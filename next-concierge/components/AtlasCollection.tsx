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
 * It plots through the existing `bevvip:atlas-plot` event, the same contract
 * The Guide uses, so no change to AtlasShell was needed to get results onto the
 * map.
 *
 * The URL is the source of truth for filter state. Every change rewrites the
 * query string, so the browser's Share/copy-URL gives a link identical in shape
 * to the ones the old Share buttons produced — and every link those buttons
 * ever produced still parses (see D3-FILTER-INVENTORY.md).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { OfferingType } from "@/lib/types";
import type { AtlasFilterDescriptor, AtlasOffering } from "@/lib/atlas/adapters/types";
import { matchesOffering, type AtlasFilterState } from "@/lib/atlas/adapters/filter";
import { parseDeepLink, toSearchParams, type ParseContext } from "@/lib/atlas/adapters/params";
import AtlasFilterRail, { type AtlasQuery } from "./AtlasFilterRail";
import AtlasShell from "./AtlasShell";
import { internalAtlasLink } from "@/lib/atlas-config";

/**
 * How many filtered offerings to pin at once.
 *
 * AtlasShell's plotResults already caps each tool's results at 60, so this
 * mirrors that rather than fighting it. Browsing 3,542 expedition sailings as
 * 3,542 simultaneous pins is not a readable map anyway — the count in the rail
 * tells the truth about how many matched, and narrowing the filters is the
 * intended way to see specific ones.
 */
const PLOT_CAP = 60;

interface Props {
  type: OfferingType;
  descriptor: AtlasFilterDescriptor;
  /** Loads and adapts this collection's raw feed. Collection-specific. */
  load: () => Promise<{ offerings: AtlasOffering[]; ctx: ParseContext; regionLabels: Record<string, string> }>;
}

export default function AtlasCollection({ type, descriptor, load }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [offerings, setOfferings] = useState<AtlasOffering[] | null>(null);
  const [ctx, setCtx] = useState<ParseContext | null>(null);
  const [regionLabels, setRegionLabels] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);

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

  // Plot the filtered subset onto the globe through the event The Guide uses.
  useEffect(() => {
    if (!filtered.length) return;
    const results = filtered.slice(0, PLOT_CAP).map((o) => {
      const first = o.stops.find((s) => s.at);
      return {
        id: o.id,
        name: o.title,
        brand: o.brandLabel ?? undefined,
        operator: o.operator ?? undefined,
        region: o.regions[0],
        dates: o.startDate ?? o.window ?? undefined,
        duration: o.days ? `${o.days} days` : undefined,
        deepLink: internalAtlasLink(type, `?ids=${encodeURIComponent(o.idAliases[0])}`),
        // AtlasShell reads named lng/lat off each result.
        lng: first?.at ? first.at[0] : undefined,
        lat: first?.at ? first.at[1] : undefined,
      };
    });
    window.dispatchEvent(
      new CustomEvent("bevvip:atlas-plot", {
        detail: { tools: [{ type, results, total: filtered.length, input: {} }] },
      }),
    );
  }, [filtered, type]);

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
      <AtlasShell type={type} region={null} externalLink={internalAtlasLink(type)} />

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
          <article key={o.id} className="atlas-card">
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

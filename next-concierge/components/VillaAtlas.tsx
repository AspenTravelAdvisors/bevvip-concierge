"use client";

// Villa Atlas client surface: a clustered Mapbox map plus a paginated card
// list, both fed exclusively by /api/villas/search. The full villa dataset
// never reaches the browser — the map layer uses the compact ?view=pins feed
// ([id, lat, lon, exact, featured] per villa) and the list fetches one page
// (24 records) at a time.
//
// Villas are advisor-arranged: every CTA routes to The Guide / the advisor,
// never a booking engine. Supplier pages are referenced only on the detail
// route, never as a card CTA.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MAPBOX_JS = "https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js";
const MAPBOX_CSS = "https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css";
// Same public, URL-restricted token the Living Atlas ships (see AtlasShell).
const FALLBACK_TOKEN =
  "pk.eyJ1IjoiYXNwZW50cmF2ZWwiLCJhIjoiY21xNDJwcHA2MHZxMDJycTI2bm9maXNmMyJ9.xFFm4X4mqbWQVxmBhaQhBA";

const BRASS = "#c9ad6a";
const BRASS_LIGHT = "#e3c98a";

interface Villa {
  id: number;
  name: string;
  slug: string;
  region: string;
  destination: string;
  destinationSlug: string;
  location: string;
  sleeps: number | null;
  bedrooms: number;
  bathrooms: number;
  nightlyFromUsd: number | null;
  priceDisplay: string;
  featured: boolean;
  hasSpecials: boolean;
  specialCategory: string | null;
  summary: string;
  imageUrl: string | null;
}

interface SearchPayload {
  total: number;
  page: number;
  perPage: number;
  results: Villa[];
  facets: {
    regions: Record<string, number>;
    sleeps: Record<string, number>;
    destinations?: Record<string, number>;
    callForPricing: number;
  };
}

interface TaxonomyRegion {
  name: string;
  destinations: { name: string; slug: string; locations: { name: string; slug: string }[] }[];
}

type Params = Record<string, string>;

interface Props {
  initial: SearchPayload;
  initialParams: Params;
  taxonomy: TaxonomyRegion[];
}

const SLEEPS_OPTIONS = [2, 4, 6, 8, 10, 12, 14, 16, 20];
const PRICE_OPTIONS = [500, 1000, 1500, 2000, 3000, 5000, 10000];

function queryString(params: Params, extra: Params = {}): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...extra })) {
    if (v != null && String(v).trim() !== "") usp.set(k, String(v));
  }
  return usp.toString();
}

function askGuideHref(v: Villa): string {
  const where = [v.location, v.destination].filter(Boolean).join(", ");
  return `/?ask=${encodeURIComponent(`Tell me about the villa ${v.name} in ${where}. Would it fit my trip?`)}`;
}

function requestAdvisorHref(v: Villa): string {
  const where = [v.location, v.destination].filter(Boolean).join(", ");
  return `/?ask=${encodeURIComponent(
    `I'd like to request the villa ${v.name} in ${where} through my advisor. Can you set that up?`,
  )}`;
}

export default function VillaAtlas({ initial, initialParams, taxonomy }: Props) {
  const [params, setParams] = useState<Params>(initialParams);
  const [data, setData] = useState<SearchPayload>(initial);
  const [loading, setLoading] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MBMap | null>(null);
  const mapReadyRef = useRef(false);
  const firstRender = useRef(true);

  // Filter params only (no page/sort): the map pins track these.
  const filterParams = useMemo(() => {
    const { page: _p, sort: _s, ...rest } = params;
    return rest;
  }, [params]);
  const filterQuery = useMemo(() => queryString(filterParams), [filterParams]);
  // Latest filter query, readable from the map's load handler (which outlives
  // any single render) so pins load whichever finishes first: map or state.
  const filterQueryRef = useRef(filterQuery);
  filterQueryRef.current = filterQuery;

  // Fetch the compact pin feed for the current filters into the map source,
  // fitting the view when the search is narrower than the whole collection.
  const refreshPins = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const q = filterQueryRef.current;
    fetch(`/api/villas/search?view=pins${q ? `&${q}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { total: number; pins: [number, number, number, number, number][] }) => {
        const m = mapRef.current;
        if (!m || q !== filterQueryRef.current) return; // stale response
        const features = j.pins
          .filter((p) => Number.isFinite(p[1]) && Number.isFinite(p[2]))
          .map(([id, lat, lon, exact, featured]) => ({
            type: "Feature" as const,
            properties: { id, exact, featured },
            geometry: { type: "Point" as const, coordinates: [lon, lat] },
          }));
        const src = m.getSource("villas") as MBGeoJSONSource | undefined;
        if (!src) return;
        src.setData({ type: "FeatureCollection", features });
        if (q && features.length > 0 && features.length < 3600) {
          let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
          for (const f of features) {
            const [lng, lat] = f.geometry.coordinates;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
          m.fitBounds(
            [[minLng, minLat], [maxLng, maxLat]],
            { padding: 60, maxZoom: 10, duration: 700 },
          );
        }
      })
      .catch(() => {});
  }, []);

  // ── list fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return; // the server already rendered the initial page
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/villas/search?${queryString(params)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: SearchPayload) => {
        if (!cancelled) setData(j);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Keep the URL shareable without triggering a navigation.
    const qs = queryString(params);
    window.history.replaceState(null, "", qs ? `/atlas/villa?${qs}` : "/atlas/villa");
    return () => {
      cancelled = true;
    };
  }, [params]);

  const setFilter = useCallback((patch: Params) => {
    setParams((prev) => {
      const next: Params = { ...prev, ...patch };
      delete next.page; // any filter change restarts at page 1
      // A region change invalidates a narrower destination pick.
      if ("region" in patch) delete next.destination;
      for (const k of Object.keys(next)) if (!next[k]) delete next[k];
      return next;
    });
  }, []);

  // ── map ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapEl.current) return;
    let cancelled = false;
    loadMapbox()
      .then((mapboxgl) => {
        if (cancelled || !mapEl.current || mapRef.current) return;
        mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || FALLBACK_TOKEN;
        const map = new mapboxgl.Map({
          container: mapEl.current,
          style: "mapbox://styles/mapbox/dark-v11",
          center: [-40, 25],
          zoom: 1.6,
          minZoom: 1,
          projection: "mercator",
        }) as MBMap;
        mapRef.current = map;
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
        const popup = new mapboxgl.Popup({ closeButton: true, offset: 10, maxWidth: "250px" });

        map.on("load", () => {
          map.addSource("villas", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
            cluster: true,
            clusterMaxZoom: 11,
            clusterRadius: 42,
          });
          map.addLayer({
            id: "villa-clusters",
            type: "circle",
            source: "villas",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "rgba(201,173,106,0.24)",
              "circle-stroke-color": BRASS,
              "circle-stroke-width": 1.2,
              "circle-radius": ["step", ["get", "point_count"], 13, 25, 17, 100, 22, 400, 28],
            },
          });
          map.addLayer({
            id: "villa-cluster-count",
            type: "symbol",
            source: "villas",
            filter: ["has", "point_count"],
            layout: {
              "text-field": ["get", "point_count_abbreviated"],
              "text-size": 11,
              "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
            },
            paint: { "text-color": BRASS_LIGHT },
          });
          // Exact villa points: solid brass. Featured burn a touch brighter.
          map.addLayer({
            id: "villa-points",
            type: "circle",
            source: "villas",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "exact"], 1]],
            paint: {
              "circle-color": ["case", ["==", ["get", "featured"], 1], BRASS_LIGHT, BRASS],
              "circle-radius": ["case", ["==", ["get", "featured"], 1], 5.5, 4.5],
              "circle-stroke-color": "#0b0d12",
              "circle-stroke-width": 1,
            },
          });
          // Approximate points (destination/location centroids): smaller and
          // hollow, so stacked centroids read as "around here", not an address.
          map.addLayer({
            id: "villa-points-approx",
            type: "circle",
            source: "villas",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "exact"], 0]],
            paint: {
              "circle-color": "rgba(0,0,0,0)",
              "circle-radius": 3.5,
              "circle-stroke-color": BRASS,
              "circle-stroke-width": 1.4,
              "circle-opacity": 0.001,
            },
          });

          map.on("click", "villa-clusters", (e: MBEvent) => {
            const f = map.queryRenderedFeatures(e.point, { layers: ["villa-clusters"] })[0];
            if (!f) return;
            const clusterId = f.properties.cluster_id;
            (map.getSource("villas") as MBClusterSource).getClusterExpansionZoom(
              clusterId,
              (err: unknown, zoom: number) => {
                if (err) return;
                map.easeTo({ center: (f.geometry as MBPoint).coordinates, zoom });
              },
            );
          });
          const pointClick = (e: MBEvent) => {
            const f = e.features && e.features[0];
            if (!f) return;
            const id = f.properties.id;
            const [lng, lat] = (f.geometry as MBPoint).coordinates;
            popup.setLngLat([lng, lat]).setHTML('<div class="villa-pop">Loading…</div>').addTo(map);
            fetch(`/api/villas/search?ids=${encodeURIComponent(id)}&perPage=1`)
              .then((r) => r.json())
              .then((j: SearchPayload) => {
                const v = j.results && j.results[0];
                if (!v) return;
                const esc = (s: string) =>
                  String(s).replace(/[&<>"']/g, (c) =>
                    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
                  );
                const where = [v.location, v.destination].filter(Boolean).join(" · ");
                popup.setHTML(
                  `<div class="villa-pop">` +
                    `<div class="vp-name">${esc(v.name)}</div>` +
                    `<div class="vp-where">${esc(where)}</div>` +
                    `<div class="vp-meta">${v.sleeps != null ? `Sleeps ${v.sleeps} · ` : ""}${v.bedrooms} bd · ${esc(v.priceDisplay)}</div>` +
                    `<a href="/atlas/villa/${esc(v.destinationSlug)}/${esc(v.slug)}">View villa →</a>` +
                    `</div>`,
                );
              })
              .catch(() => {});
          };
          map.on("click", "villa-points", pointClick);
          map.on("click", "villa-points-approx", pointClick);
          for (const layer of ["villa-clusters", "villa-points", "villa-points-approx"]) {
            map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
            map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
          }
          mapReadyRef.current = true;
          refreshPins();
        });
      })
      .catch(() => setMapFailed(true));
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
    };
  }, []);

  // Pin feed tracks the filters (initial load happens from the map's own
  // load handler, whichever finishes last wins via filterQueryRef).
  useEffect(() => {
    refreshPins();
  }, [filterQuery, refreshPins]);

  // ── derived UI state ─────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(data.total / data.perPage));
  const page = data.page;
  const regionFacets = data.facets?.regions || {};
  const regions = taxonomy.map((r) => r.name);
  const activeRegion = taxonomy.find(
    (r) => r.name.toLowerCase() === String(params.region || "").toLowerCase(),
  );
  const shortlistMode = !!params.ids;

  return (
    <>
      <div className="villa-head">
        <div>
          <h1>Villa Atlas</h1>
          <p className="villa-tag">
            3,902 private villas and vacation homes worldwide, arranged by your Aspen
            Travel Advisor. VIP travel benefits, zero membership fees.
          </p>
        </div>
        <div className="villa-count mono">
          {loading ? "Searching…" : `${data.total.toLocaleString()} villa${data.total === 1 ? "" : "s"} match`}
        </div>
      </div>

      <div className="villa-map-wrap">
        {mapFailed ? (
          <div className="villa-map-fallback">Map unavailable right now. The list below is live.</div>
        ) : (
          <div ref={mapEl} className="villa-map" />
        )}
      </div>

      {shortlistMode && (
        <div className="villa-shortlist-note mono">
          Showing your shortlist from The Guide.{" "}
          <button onClick={() => setFilter({ ids: "" })}>Show all villas</button>
        </div>
      )}

      <div className="villa-filters">
        <select
          value={params.region || ""}
          onChange={(e) => setFilter({ region: e.target.value })}
          aria-label="Region"
        >
          <option value="">All regions</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
              {regionFacets[r] != null && !params.region ? ` (${regionFacets[r]})` : ""}
            </option>
          ))}
        </select>
        <select
          value={params.destination || ""}
          onChange={(e) => setFilter({ destination: e.target.value })}
          disabled={!activeRegion}
          aria-label="Destination"
        >
          <option value="">{activeRegion ? "All destinations" : "Destination"}</option>
          {(activeRegion?.destinations || []).map((d) => (
            <option key={d.slug} value={d.name}>
              {d.name}
              {data.facets?.destinations?.[d.name] != null
                ? ` (${data.facets.destinations[d.name]})`
                : ""}
            </option>
          ))}
        </select>
        <select
          value={params.sleeps || ""}
          onChange={(e) => setFilter({ sleeps: e.target.value })}
          aria-label="Sleeps"
        >
          <option value="">Any party size</option>
          {SLEEPS_OPTIONS.map((n) => (
            <option key={n} value={n}>{`Sleeps ${n}+`}</option>
          ))}
        </select>
        <select
          value={params.bedrooms || ""}
          onChange={(e) => setFilter({ bedrooms: e.target.value })}
          aria-label="Bedrooms"
        >
          <option value="">Any bedrooms</option>
          {[2, 3, 4, 5, 6, 8, 10].map((n) => (
            <option key={n} value={n}>{`${n}+ bedrooms`}</option>
          ))}
        </select>
        <select
          value={params.priceMax || ""}
          onChange={(e) => setFilter({ priceMax: e.target.value })}
          aria-label="Nightly budget"
        >
          <option value="">Any nightly rate</option>
          {PRICE_OPTIONS.map((n) => (
            <option key={n} value={n}>{`Under $${n.toLocaleString()}/nt`}</option>
          ))}
        </select>
        <label className="villa-check">
          <input
            type="checkbox"
            checked={params.featured === "1"}
            onChange={(e) => setFilter({ featured: e.target.checked ? "1" : "" })}
          />
          Featured
        </label>
        <label className="villa-check">
          <input
            type="checkbox"
            checked={params.specials === "1"}
            onChange={(e) => setFilter({ specials: e.target.checked ? "1" : "" })}
          />
          Specials
        </label>
        <input
          className="villa-q"
          type="search"
          placeholder="Search villas…"
          defaultValue={params.q || ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") setFilter({ q: (e.target as HTMLInputElement).value });
          }}
          onBlur={(e) => {
            if ((e.target.value || "") !== (params.q || "")) setFilter({ q: e.target.value });
          }}
          aria-label="Search"
        />
      </div>

      <div className="villa-grid" data-loading={loading || undefined}>
        {data.results.map((v) => (
          <VillaCard key={v.id} v={v} />
        ))}
        {!loading && data.results.length === 0 && (
          <div className="villa-empty">
            Nothing matches that exact combination. Loosen a filter, or{" "}
            <Link href="/?ask=Help me find the right private villa for my trip">
              ask The Guide
            </Link>{" "}
            and an advisor can source options directly.
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="villa-pager mono">
          <button
            disabled={page <= 1 || loading}
            onClick={() => setParams((p) => ({ ...p, page: String(page - 1) }))}
          >
            ← Prev
          </button>
          <span>
            Page {page} of {totalPages.toLocaleString()}
          </span>
          <button
            disabled={page >= totalPages || loading}
            onClick={() => setParams((p) => ({ ...p, page: String(page + 1) }))}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}

function VillaCard({ v }: { v: Villa }) {
  const crumb = [v.region, v.destination, v.location].filter(Boolean).join(" › ");
  const stats = [
    v.sleeps != null ? `Sleeps ${v.sleeps}` : null,
    v.bedrooms ? `${v.bedrooms} bd` : null,
    v.bathrooms ? `${v.bathrooms} ba` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="villa-card">
      <Link className="villa-card-media" href={`/atlas/villa/${v.destinationSlug}/${v.slug}`}>
        {v.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.imageUrl} alt={v.name} loading="lazy" />
        ) : (
          <span className="villa-card-noimg" />
        )}
        {v.featured && <span className="villa-badge">Featured</span>}
        {v.hasSpecials && (
          <span className="villa-badge special">{v.specialCategory || "Special offer"}</span>
        )}
      </Link>
      <div className="villa-card-body">
        <span className="villa-crumb mono">{crumb}</span>
        <Link className="villa-name" href={`/atlas/villa/${v.destinationSlug}/${v.slug}`}>
          {v.name}
        </Link>
        <span className="villa-stats mono">
          {stats}
          {stats && " · "}
          <b>{v.priceDisplay}</b>
        </span>
        <div className="villa-card-ctas">
          <Link href={askGuideHref(v)}>Ask the Guide about this villa</Link>
          <Link href={requestAdvisorHref(v)} className="villa-advisor">
            Request through your advisor →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── minimal Mapbox loader (same CDN + pattern as AtlasShell) ─────────────────

interface MBPoint {
  coordinates: [number, number];
}
interface MBEvent {
  point: unknown;
  features?: Array<{ properties: Record<string, number>; geometry: unknown }>;
}
interface MBGeoJSONSource {
  setData(d: unknown): void;
}
interface MBClusterSource {
  getClusterExpansionZoom(id: number, cb: (err: unknown, zoom: number) => void): void;
}
/* eslint-disable @typescript-eslint/no-explicit-any */
type MBMap = any;
type MapboxModule = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// window.mapboxgl is declared globally by AtlasShell; read it loosely here.
const globalMapbox = (): MapboxModule | undefined =>
  (window as unknown as { mapboxgl?: MapboxModule }).mapboxgl;

let mapboxPromise: Promise<MapboxModule> | null = null;
function loadMapbox(): Promise<MapboxModule> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  const existing = globalMapbox();
  if (existing) return Promise.resolve(existing);
  if (mapboxPromise) return mapboxPromise;
  mapboxPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = MAPBOX_CSS;
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = MAPBOX_JS;
    js.onload = () => {
      const mb = globalMapbox();
      if (mb) resolve(mb);
      else reject(new Error("mapbox missing"));
    };
    js.onerror = () => reject(new Error("mapbox failed to load"));
    document.head.appendChild(js);
  });
  return mapboxPromise;
}

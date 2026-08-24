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
import { MAPBOX_JS, MAPBOX_CSS } from "@/lib/mapbox-cdn";
import { fromLatLngPair, isFinitePair } from "@/lib/atlas/geo";
import {
  parseViewParams,
  readStoredStyle,
  setViewParams,
  writeStoredStyle,
} from "@/lib/atlas/adapters/params";
// Same public, URL-restricted token the Living Atlas ships (see AtlasShell).
const FALLBACK_TOKEN =
  "pk.eyJ1IjoiYXNwZW50cmF2ZWwiLCJhIjoiY21xNDJwcHA2MHZxMDJycTI2bm9maXNmMyJ9.xFFm4X4mqbWQVxmBhaQhBA";

const BRASS = "#c9ad6a";
const BRASS_LIGHT = "#e3c98a";
/**
 * Pin colours depend on the basemap — the same problem the Living Atlas solved
 * for routes (see `routePalette` in AtlasShell), arriving here now that a
 * basemap picked on another atlas follows the traveller into this one.
 *
 * Brass over a dark tile layer has plenty of contrast. Over photoreal imagery
 * it has almost none: #c9ad6a lands on sand, dry grass and terracotta roofs,
 * which is most of where villas are, and a 1px casing is not enough edge to cut
 * it out of a photograph. Two things fix it together — lift the mark toward
 * white so it keeps the brand hue but gains luminance, and widen the near-black
 * halo, which is what actually carries over bright terrain.
 *
 * Clusters need the bigger change. A 24%-opacity brass disc over imagery is mud
 * with a number in it, so on imagery the disc goes dark and keeps a brass ring:
 * the count then reads over anything underneath it.
 *
 * The dark basemaps keep their original values exactly.
 */
const SATELLITE_STYLES = new Set<StyleKey>(["satellite", "daylight"]);
/** Brass lifted toward white — brand hue, imagery luminance. */
const BRASS_ON_IMAGERY = "#f2dfae";
const HALO = "#0b0d12";

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
  /** Bookable bedroom counts, ascending. Often [bedrooms]; 698 villas rent a menu. */
  bedroomOptions: number[];
  bathrooms: number;
  nightlyFromUsd: number | null;
  priceDisplay: string;
  /** False when the pin is a location/destination centroid, not the villa's address. */
  exactLocation: boolean;
  featured: boolean;
  hasSpecials: boolean;
  specialCategory: string | null;
  specials: string[];
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

// The house basemaps, same set as the Living Atlas (AtlasShell). The villa map
// is a flat mercator inset, so fog is skipped; the Standard-family styles keep
// their dusk light preset so the water stays deep against the brass pins.
// Same five basemaps as the shared atlas, same names, same order — a villa map
// that offered a different set under different names is one more thing to learn
// for no reason. A villa is chosen on where it sits (the beach, the ridge, the
// next roof over), so the daylight pair matters more here than anywhere.
type StyleKey = "dark" | "satellite" | "daylight" | "dusk" | "city";
const VILLA_STYLES: Record<StyleKey, { label: string; url: string; sw: string; light?: string }> = {
  dark: { label: "Dark", url: "mapbox://styles/mapbox/dark-v11", sw: "#11151c" },
  satellite: {
    label: "Satellite",
    url: "mapbox://styles/mapbox/standard-satellite",
    sw: "#3b5a3a",
    light: "dusk",
  },
  daylight: {
    label: "Satellite (day)",
    url: "mapbox://styles/mapbox/standard-satellite",
    sw: "#7fa9c9",
    light: "day",
  },
  dusk: { label: "3D Dusk", url: "mapbox://styles/mapbox/standard", sw: "#caa46a", light: "dusk" },
  city: {
    label: "3D Day",
    url: "mapbox://styles/mapbox/standard",
    sw: "#cfd8e3",
    light: "day",
  },
};

/**
 * Coerce whatever came back into a payload the render cannot trip over.
 *
 * `data.results.map(...)` and `data.total.toLocaleString()` both run
 * unconditionally during render, so a response missing either field is not a
 * blank list — it is an uncaught TypeError, which in production is the bare
 * "a client-side exception has occurred" page. The search API can answer with a
 * different shape for reasons that have nothing to do with this component (a
 * rate-limit body, an edge error page, a truncated response), and none of those
 * are worth losing the page over: an empty grid still has working filters, and
 * the next keystroke re-fetches.
 */
function safePayload(raw: unknown, fallback: SearchPayload): SearchPayload {
  const p = raw as Partial<SearchPayload> | null;
  if (!p || typeof p !== "object" || !Array.isArray(p.results)) return fallback;
  return {
    total: Number.isFinite(p.total) ? (p.total as number) : p.results.length,
    page: Number.isFinite(p.page) ? (p.page as number) : 1,
    perPage: Number.isFinite(p.perPage) && (p.perPage as number) > 0 ? (p.perPage as number) : 24,
    results: p.results,
    facets: p.facets ?? { regions: {}, sleeps: {}, callForPricing: 0 },
  };
}

const EMPTY_PAYLOAD: SearchPayload = {
  total: 0,
  page: 1,
  perPage: 24,
  results: [],
  facets: { regions: {}, sleeps: {}, callForPricing: 0 },
};

export default function VillaAtlas({ initial, initialParams, taxonomy }: Props) {
  const [params, setParams] = useState<Params>(initialParams);
  // The server payload gets the same treatment as a fetched one: this component
  // is also rendered from a cached RSC payload, which can outlive a change to
  // the search's shape.
  const [data, setData] = useState<SearchPayload>(() => safePayload(initial, EMPTY_PAYLOAD));
  const [loading, setLoading] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [styleKey, setStyleKey] = useState<StyleKey>("dark");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [shared, setShared] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MBMap | null>(null);
  const mapReadyRef = useRef(false);
  const styleKeyRef = useRef<StyleKey>("dark");
  const pinsFCRef = useRef<unknown>(null);
  const firstRender = useRef(true);
  /**
   * The live camera + basemap, for the Share link.
   *
   * Deliberately NOT pushed into the URL as it changes. The filter effect below
   * rewrites the address bar via replaceState on every param change, and making
   * the camera part of that would mean a history write on every pan of the map.
   * The link is built from this ref at the moment Share is pressed instead.
   */
  const viewRef = useRef<{
    center: { lng: number; lat: number }; zoom: number; pitch: number; bearing: number;
  } | null>(null);
  /**
   * The view an incoming shared link asked for, read once before anything
   * rewrites the URL — which the filter effect does on first run, so reading
   * this later would find it already gone.
   */
  const arrivedView = useRef(
    typeof window === "undefined"
      ? { style: null, flat: false, camera: null }
      : parseViewParams(new URLSearchParams(window.location.search)),
  );
  /** True only while a shared camera is still waiting to survive the first auto-fit. */
  const skipFirstFit = useRef(!!arrivedView.current.camera);

  // Filter params only (no page/sort/bbox): the map pins track these. bbox is
  // excluded on purpose — it limits the *list* to the visible area, while the
  // map keeps showing every pin for the active filters (spatial context), and
  // leaving it out means a "Search this area" click never refits the map.
  const filterParams = useMemo(() => {
    const { page: _p, sort: _s, bbox: _b, ...rest } = params;
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
      .then((j: { total?: number; pins?: [number, number, number, number, number][] }) => {
        const m = mapRef.current;
        if (!m || q !== filterQueryRef.current) return; // stale response
        if (!Array.isArray(j?.pins)) return; // not the pin feed — leave the map be
        // Each pin is [id, lat, lon, exact, featured] — the villa dataset's
        // geo.{lat, lon} flattened by lib/villas.js, so the pair is [lat, lon].
        const features = j.pins
          .filter((p) => isFinitePair([p[1], p[2]]))
          .map(([id, lat, lon, exact, featured]) => ({
            type: "Feature" as const,
            properties: { id, exact, featured },
            geometry: { type: "Point" as const, coordinates: fromLatLngPair([lat, lon]) },
          }));
        const src = m.getSource("villas") as MBGeoJSONSource | undefined;
        if (!src) return;
        const fc = { type: "FeatureCollection", features };
        pinsFCRef.current = fc; // cached so a basemap switch repaints without refetching
        src.setData(fc);
        // An explicit shared camera outranks the auto-fit, but only for the
        // first load. Both are "frame the villas", and the link is the more
        // specific instruction — an advisor who framed a hillside and sent it
        // should not have the client's map jump out to the filter's bounds a
        // beat after it opens. Any later filter change refits as normal.
        const honourSharedCamera = skipFirstFit.current;
        skipFirstFit.current = false;
        if (!honourSharedCamera && q && features.length > 0 && features.length < 3600) {
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
      .then((j: unknown) => {
        // Keep the previous results rather than blanking the page when a
        // response arrives in a shape we can't render.
        if (!cancelled) setData((prev) => safePayload(j, prev));
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
      // Changing any real filter drops the map-area limit — the map refits to the
      // new filter and the user can "Search this area" again from there. Only a
      // patch that sets bbox itself keeps it.
      if (!("bbox" in patch)) delete next.bbox;
      // A region change invalidates a narrower destination pick.
      if ("region" in patch) delete next.destination;
      for (const k of Object.keys(next)) if (!next[k]) delete next[k];
      return next;
    });
  }, []);

  // Limit the result list to the villas inside the current map viewport. The map
  // itself is untouched (pins ignore bbox), so this reads as "show me what's in
  // view" rather than a jump.
  const searchThisArea = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const b = map.getBounds?.();
    if (!b) return;
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
      .map((n: number) => Math.round(n * 1e5) / 1e5)
      .join(",");
    setFilter({ bbox });
  }, [setFilter]);

  // ── map ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapEl.current) return;
    let cancelled = false;
    loadMapbox()
      .then((mapboxgl) => {
        if (cancelled || !mapEl.current || mapRef.current) return;
        mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || FALLBACK_TOKEN;
        // A shared link's view wins over the villa atlas's own opening framing.
        // Applied at construction rather than as a flyTo afterwards: the map
        // should OPEN on what was sent, not pan there while the client watches.
        const av = arrivedView.current;
        // Precedence: the URL, then this session's remembered pick, then the
        // villa atlas's own default (dark — its opening look is not the Living
        // Atlas's). The URL outranks the preference on purpose: a Share link is
        // the sender describing what THEY saw, and the recipient's stored
        // basemap has no business overwriting the picture they were sent.
        const arrivedStyle = (av.style as StyleKey | null) ?? null;
        const bootStyle =
          arrivedStyle && VILLA_STYLES[arrivedStyle] ? arrivedStyle : readStoredStyle();
        if (bootStyle && VILLA_STYLES[bootStyle]) {
          styleKeyRef.current = bootStyle;
          setStyleKey(bootStyle);
        }
        const map = new mapboxgl.Map({
          container: mapEl.current,
          style: VILLA_STYLES[styleKeyRef.current].url,
          center: av.camera ? [av.camera.lng, av.camera.lat] : [-40, 25],
          zoom: av.camera ? av.camera.zoom : 1.6,
          pitch: av.camera?.pitch ?? 0,
          bearing: av.camera?.bearing ?? 0,
          minZoom: 1,
          // `flat=1` is the shared param for mercator, and mercator is also this
          // atlas's own default — so only an explicit globe request changes it.
          projection: "mercator",
        }) as MBMap;
        mapRef.current = map;
        // Publish the camera for Share. moveend alone misses the pitch and
        // rotate axes, which is exactly the tilt a shared view most wants.
        const reportView = () => {
          try {
            const c = map.getCenter();
            viewRef.current = {
              center: { lng: c.lng, lat: c.lat },
              zoom: map.getZoom(),
              pitch: map.getPitch(),
              bearing: map.getBearing(),
            };
          } catch { /* view reporting is never load-bearing */ }
        };
        reportView();
        map.on("moveend", reportView);
        map.on("zoomend", reportView);
        map.on("pitchend", reportView);
        map.on("rotateend", reportView);
        // bottom-right: top-right belongs to the fullscreen/style/share stack
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
        const popup = new mapboxgl.Popup({ closeButton: true, offset: 10, maxWidth: "250px" });

        // style.load fires on the first load AND after every basemap switch —
        // a setStyle wipes all sources/layers, so this is the one place they
        // are (re)added. Click handlers are wired once; Mapbox delegates them
        // by layer id, so they survive the layers being re-created.
        let wired = false;
        map.on("style.load", () => {
          const s = VILLA_STYLES[styleKeyRef.current];
          if (s.light) {
            try {
              (map as { setConfigProperty(g: string, k: string, v: string): void })
                .setConfigProperty("basemap", "lightPreset", s.light);
            } catch { /* classic styles have no config */ }
          }
          if (!map.getSource("villas")) {
            map.addSource("villas", {
              type: "geojson",
              data: pinsFCRef.current || { type: "FeatureCollection", features: [] },
              cluster: true,
              clusterMaxZoom: 11,
              clusterRadius: 42,
            });
          }
          // Photoreal basemap? Pins take the imagery palette — see SATELLITE_STYLES.
          // Read here rather than passed in: style.load re-runs on every basemap
          // switch that changes the style URL, which is exactly when the palette
          // needs to change. Satellite⇄Satellite (day) shares a URL and does not
          // re-run, and does not need to — both are imagery.
          const sat = SATELLITE_STYLES.has(styleKeyRef.current);
          map.addLayer({
            id: "villa-clusters",
            type: "circle",
            source: "villas",
            filter: ["has", "point_count"],
            paint: {
              // Translucent brass over imagery is mud; go dark and let the ring
              // and the count carry it.
              "circle-color": sat ? "rgba(11,13,18,0.74)" : "rgba(201,173,106,0.24)",
              "circle-stroke-color": sat ? BRASS_ON_IMAGERY : BRASS,
              "circle-stroke-width": sat ? 1.8 : 1.2,
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
            paint: {
              "text-color": sat ? "#fdf3dc" : BRASS_LIGHT,
              // Belt and braces over imagery: the dark disc already backs the
              // count, but a cluster straddling a cliff edge still needs it.
              "text-halo-color": HALO,
              "text-halo-width": sat ? 1.2 : 0,
            },
          });
          // Exact villa points: solid brass. Featured burn a touch brighter.
          map.addLayer({
            id: "villa-points",
            type: "circle",
            source: "villas",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "exact"], 1]],
            paint: {
              "circle-color": sat
                ? ["case", ["==", ["get", "featured"], 1], "#fff6e0", BRASS_ON_IMAGERY]
                : ["case", ["==", ["get", "featured"], 1], BRASS_LIGHT, BRASS],
              // A touch larger on imagery: the halo eats into the mark, so the
              // same radius reads smaller than it does on a flat dark basemap.
              "circle-radius": sat
                ? ["case", ["==", ["get", "featured"], 1], 6.5, 5.5]
                : ["case", ["==", ["get", "featured"], 1], 5.5, 4.5],
              "circle-stroke-color": HALO,
              // The halo is doing most of the work over terrain; the fill alone
              // cannot win against a photograph.
              "circle-stroke-width": sat ? 2.2 : 1,
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
              // A hollow ring has one stroke to spend, so over imagery the fill
              // becomes the halo — a dark centre that both backs the brass ring
              // and keeps these visibly distinct from the solid exact pins.
              "circle-color": sat ? HALO : "rgba(0,0,0,0)",
              "circle-radius": sat ? 4.5 : 3.5,
              "circle-stroke-color": sat ? BRASS_ON_IMAGERY : BRASS,
              "circle-stroke-width": sat ? 2 : 1.4,
              // Non-zero on the dark basemaps only to keep the ring hit-testable
              // while the centre stays empty.
              "circle-opacity": sat ? 0.55 : 0.001,
            },
          });

          if (!wired) {
            wired = true;
            wireHandlers();
          }
          mapReadyRef.current = true;
          // A basemap switch repaints from the cache; only the first load fetches.
          if (!pinsFCRef.current) refreshPins();
        });

        function wireHandlers() {
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
        }
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

  // ── map controls: basemap, fullscreen, share ─────────────────────────────
  function switchStyle(k: StyleKey) {
    // Every call here is the traveller using the Style menu — this atlas has no
    // automatic switching — so the pick is remembered for the other atlases.
    // Recorded before the no-op return, so re-picking the current style still
    // counts as choosing it.
    writeStoredStyle(k);
    if (k === styleKeyRef.current) return;
    const from = VILLA_STYLES[styleKeyRef.current];
    const to = VILLA_STYLES[k];
    styleKeyRef.current = k;
    setStyleKey(k);
    setMenuOpen(false);
    // Satellite / Satellite (Day) and Dusk / 3D Buildings (Day) are the same
    // Mapbox style under different light presets. setStyle with a URL that is
    // already loaded does nothing — no style.load, no new preset, a menu that
    // ticks and a map that doesn't move. Reconfigure in place for those.
    if (to.url === from.url) {
      try {
        (mapRef.current as unknown as { setConfigProperty(g: string, k: string, v: string): void })
          ?.setConfigProperty("basemap", "lightPreset", to.light || "day");
      } catch { /* classic styles have no config */ }
      return;
    }
    try {
      mapRef.current?.setStyle(to.url); // style.load re-adds the layers
    } catch { /* keep the current basemap */ }
  }

  // Native fullscreen with the same CSS `.fs` fill fallback the Living Atlas
  // uses (iOS Safari only fullscreens <video>).
  function toggleFull() {
    const el = wrapRef.current;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => setIsFull((v) => !v));
    } else {
      setIsFull((v) => !v);
    }
  }
  useEffect(() => {
    const onFsChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);
  useEffect(() => {
    if (!isFull || document.fullscreenElement) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFull]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        mapRef.current?.resize();
      } catch { /* noop */ }
    }, 60);
    return () => clearTimeout(t);
  }, [isFull]);

  // Share the current view.
  //
  // The URL already carries every active filter (kept in sync via
  // replaceState), but it carried ONLY those — the basemap and the camera were
  // dropped, so a link sent from a tilted satellite view of one hillside opened
  // as the default dark world map with the same filters applied. The view is
  // written on at send time, from the live camera rather than the address bar.
  //
  // Native share sheet where the platform has one, clipboard copy elsewhere.
  async function shareView() {
    const u = new URL(window.location.href);
    const v = viewRef.current;
    setViewParams(u.searchParams, {
      style: styleKeyRef.current,
      // No `flat` here. This atlas has no projection toggle — it is mercator,
      // always — so emitting flat=1 would be a param that says nothing and can
      // change nothing, on every link.
      flat: false,
      camera: v
        ? { lng: v.center.lng, lat: v.center.lat, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing }
        : null,
    });
    const url = u.toString();
    const confirmCopied = () => {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    };
    if (navigator.share) {
      try {
        await navigator.share({ title: "Villa atlas", url });
      } catch { /* user dismissed the sheet */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      confirmCopied();
    } catch {
      // Clipboard API blocked (permissions / older browsers): legacy shim.
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        confirmCopied();
      } catch { /* nothing left to try */ }
    }
  }

  // ── derived UI state ─────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(data.total / data.perPage));
  const page = data.page;
  const regionFacets = data.facets?.regions || {};
  const regions = taxonomy.map((r) => r.name);
  const activeRegion = taxonomy.find(
    (r) => r.name.toLowerCase() === String(params.region || "").toLowerCase(),
  );
  const shortlistMode = !!params.ids;
  const areaActive = !!params.bbox;

  return (
    <>
      {/* No heading here.
          AtlasFrame's bar already prints the collection name and count directly
          above this, so a second "Villa atlas" title made the page open with two
          stacked rails saying the same thing — the villa atlas was the only
          collection doing it, because it is the only one that renders its own
          chrome instead of the shared shell's. The description survives: it says
          something the frame's tagline does not (advisor-arranged, VIP benefits,
          no membership fee). */}
      <div className="villa-head">
        <div>
          <p className="villa-tag">
            3,902 private villas and vacation homes worldwide, arranged by your Aspen
            Travel Advisor. VIP travel benefits, zero membership fees.
          </p>
        </div>
        <div className="villa-count mono">
          {loading ? "Searching…" : `${data.total.toLocaleString()} villa${data.total === 1 ? "" : "s"} match`}
        </div>
      </div>

      <div ref={wrapRef} className={`villa-map-wrap${isFull ? " fs" : ""}`}>
        {mapFailed ? (
          <div className="villa-map-fallback">Map unavailable right now. The list below is live.</div>
        ) : (
          <div ref={mapEl} className="villa-map" />
        )}
        {!mapFailed && (
          <div className="atlas-ctrls" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="actrl"
              onClick={toggleFull}
              aria-pressed={isFull}
              title={isFull ? "Exit fullscreen" : "Fullscreen map"}
            >
              {isFull ? "✕ Exit" : "⛶ Fullscreen"}
            </button>
            <div className="actrl-style">
              <button
                type="button"
                className="actrl"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={menuOpen}
                title="Map style"
              >
                <i className="sw" style={{ background: VILLA_STYLES[styleKey].sw }} /> Style
              </button>
              {menuOpen && (
                <div className="actrl-menu" role="menu">
                  {(Object.keys(VILLA_STYLES) as StyleKey[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="menuitem"
                      className={k === styleKey ? "active" : ""}
                      onClick={() => switchStyle(k)}
                    >
                      <i className="sw" style={{ background: VILLA_STYLES[k].sw }} />
                      {VILLA_STYLES[k].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="actrl"
              onClick={shareView}
              title="Share this view — the link carries your filters"
            >
              {shared ? "✓ Link copied" : "Share"}
            </button>
          </div>
        )}
        {!mapFailed && (
          <div className="villa-area-ctrl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="actrl"
              onClick={searchThisArea}
              title="Limit the list below to the villas in the current map view"
            >
              ⌖ Search this area
            </button>
            {areaActive && (
              <button
                type="button"
                className="actrl area-clear"
                onClick={() => setFilter({ bbox: "" })}
                title="Show villas everywhere again"
              >
                ✕ Clear area
              </button>
            )}
          </div>
        )}
      </div>

      {shortlistMode && (
        <div className="villa-shortlist-note mono">
          Showing your shortlist from The Guide.{" "}
          <button onClick={() => setFilter({ ids: "" })}>Show all villas</button>
        </div>
      )}

      {areaActive && (
        <div className="villa-shortlist-note mono">
          Limited to the villas in the current map view.{" "}
          <button onClick={() => setFilter({ bbox: "" })}>Show all villas</button>
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

      {/* The shared results grid, so the two collections are one list in two
          places rather than two lists that look alike. */}
      <div className="atlas-results atlas-results--stay" data-loading={loading || undefined}>
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

/**
 * What the traveller can actually rent, which is not always the villa's size.
 *
 * `bedroomOptions` is the supplier's own list of bookable counts. A single
 * option reads as before; a menu reads as a range, because "10 bd" on an estate
 * that also goes as a 6 hides the version most parties would book. The exact
 * list stays in the tooltip and on the detail page rather than crowding a card.
 */
function bedroomLabel(v: Villa): string | null {
  const opts = v.bedroomOptions?.length ? v.bedroomOptions : v.bedrooms ? [v.bedrooms] : [];
  if (!opts.length) return null;
  const min = opts[0];
  const max = opts[opts.length - 1];
  return min === max ? `${max} bd` : `${min}–${max} bd`;
}

/**
 * A villa, on the shared stay card.
 *
 * The markup here is `AtlasCollection`'s, not villa's own: `.atlas-card
 * --stay`, `.ac-media`, `.ac-body`, `.ac-crumb`, `.ac-meta`, `.ac-note`,
 * `.ac-summary`, `.ac-actions`. Hotels and villas are the same kind of thing to
 * a traveller — somewhere to stay, chosen substantially by how it looks — and
 * they were being drawn by two components that had already converged by hand:
 * `.atlas-collection--hotel` overrode the atlas card's name to 19px serif and
 * added a gold hover on `--card-hover`, which were `.villa-card`'s values
 * copied, and both grids were already `minmax(240px, 1fr)`. One card, one
 * stylesheet, one place to change it.
 *
 * What stays villa's own is what villa actually has and hotels do not: the
 * photograph (`v.imageUrl`, on 3,896 of 3,902), the Featured and Special
 * badges over it, and two advisor CTAs where a hotel card carries a rate
 * search. **A villa card may never grow a booking link** — villas are
 * advisor-arranged, and that rule outranks card symmetry.
 *
 * This is deliberately only the card. The map interplay every other atlas has
 * (click a card, fly to its pin, hold the map still) is Phase 0 of
 * WORKORDER-villa-unification.md and is not here yet, so these are still links
 * rather than a selection.
 */
function VillaCard({ v }: { v: Villa }) {
  const crumb = [v.region, v.destination, v.location].filter(Boolean).join(" · ");
  const bedrooms = bedroomLabel(v);
  const multiBedroom = (v.bedroomOptions?.length ?? 0) > 1;
  const stats = [
    v.sleeps != null ? `Sleeps ${v.sleeps}` : null,
    bedrooms,
    v.bathrooms ? `${v.bathrooms} ba` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // The offer itself, not just its category. The badge over the photo says
  // "Free Night(s)"; this says which nights, on which stay.
  const offer = v.specials?.[0] || null;
  const href = `/atlas/villa/${v.destinationSlug}/${v.slug}`;
  return (
    <article className="atlas-card atlas-card--stay">
      <Link className="ac-media" href={href}>
        {v.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.imageUrl} alt={v.name} loading="lazy" />
        ) : (
          <span className="ac-media-empty" />
        )}
        {v.featured && <span className="villa-badge">Featured</span>}
        {v.hasSpecials && (
          <span className="villa-badge special">{v.specialCategory || "Special offer"}</span>
        )}
      </Link>
      <div className="ac-body">
        <p className="ac-crumb">
          {crumb}
          {/* 236 villas are pinned to a location or destination centroid. The map
              already draws those hollow; saying so here keeps the card honest
              for anyone reading the list without the map. */}
          {!v.exactLocation && <em className="villa-approx"> · approx. location</em>}
        </p>
        <div className="ac-head">
          <div className="ac-headtext">
            <h3>
              <Link href={href}>{v.name}</Link>
            </h3>
          </div>
        </div>
        <p
          className="ac-meta"
          title={multiBedroom ? `Bookable as ${v.bedroomOptions.join(", ")} bedrooms` : undefined}
        >
          {stats}
          {stats && "  ·  "}
          {/* The one thing on a stay card that is a number the supplier
              publishes. Hotels have no equivalent — a TravelWits search is not
              a published rate — so their stats line ends at their attributes. */}
          <b className="ac-price">{v.priceDisplay}</b>
        </p>
        {/* Green rather than the slot's default gold: this is an offer that
            expires, not a standing benefit, and the colour ties it to the
            "Special offer" badge over the photograph. */}
        {offer && <p className="ac-note ac-note--offer">{offer}</p>}
        {v.summary && <p className="ac-summary">{v.summary}</p>}
        <div className="ac-actions ac-actions--stacked">
          <Link className="ac-link" href={askGuideHref(v)}>
            ✦ Ask The Guide about this villa
          </Link>
          <Link className="ac-link ac-advisor" href={requestAdvisorHref(v)}>
            Request through your advisor →
          </Link>
        </div>
      </div>
    </article>
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

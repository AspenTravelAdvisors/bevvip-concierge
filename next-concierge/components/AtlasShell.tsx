"use client";

// Living Atlas — the populated Mapbox globe. On the home page (scope="all") it
// paints the full hotel inventory as an ambient gold field, drops colored
// cruise / jet / yacht / world-cruise region pins from each atlas's live feed,
// fits the globe and idle-spins — the same resting state as the standalone
// deployed atlas (public/index.html). On a single-category /atlas/[type] route
// it shows ONLY that category's layer, with a legend + region chips scoped to
// that atlas.
//
// Map controls (top-right) mirror the original app: fullscreen, a basemap
// switcher (Dark / Satellite / Dusk), and a 2D⇄3D (mercator⇄globe) toggle.
// When The Guide returns recommendations it broadcasts a "bevvip:atlas-plot"
// event; the globe then fits the results and switches to satellite.
//
// Without a Mapbox token it degrades to an elegant fallback panel with the
// external-atlas handoff, so the app still works with zero configuration.

import { useEffect, useRef, useState } from "react";
import type { OfferingType, GuideMeta, OfferingResult } from "@/lib/types";
import { ATLASES, internalAtlasLink } from "@/lib/atlas-config";

const MAPBOX_JS = "https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js";
const MAPBOX_CSS = "https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css";

// Public Mapbox token (Aspen Travel) — public by design, URL-restricted in the
// Mapbox account, and already shipped in the deployed atlas. Inlined as a
// fallback so the globe renders even when the Vercel env var is unset;
// NEXT_PUBLIC_MAPBOX_TOKEN overrides it.
const FALLBACK_TOKEN =
  "pk.eyJ1IjoiYXNwZW50cmF2ZWwiLCJhIjoiY21xNDJwcHA2MHZxMDJycTI2bm9maXNmMyJ9.xFFm4X4mqbWQVxmBhaQhBA";

const HOTEL_BASE = ATLASES.hotel.base;
const HOTEL_DOT_MIN_ZOOM = 2.45; // let hotels emerge before the ambient cloud fades
const HOTEL_CLICK_MIN_ZOOM = 4; // below this dots overlap — taps stay ambient
const ROUTE_ZOOM = 5.5;         // dashed route polylines appear above this zoom
const ROUTES_ENABLED = false;   // set true to activate progressive route layer
const HOTEL_DENSITY_SOURCE = "hotel-density";

// Master atlas overlays: cruise / jet / yacht / world-cruise region pins, each
// from its own live app data. Colors stay distinguishable on the dark globe.
type OverlayKey = "cruise" | "jet" | "yacht" | "worldcruise";
const OVERLAYS: Record<OverlayKey, { label: string; color: string; url: string; data: string }> = {
  cruise: {
    label: "Expedition Cruises",
    color: "#5aa9e6",
    url: ATLASES.cruise.base,
    data: `${ATLASES.cruise.base}/atlas-meta.json`,
  },
  jet: {
    label: "Private Jet Journeys",
    color: "#dfe5f2",
    url: ATLASES.jet.base,
    data: `${ATLASES.jet.base}/itinerary.json`,
  },
  yacht: {
    label: "Luxury Hotel Yachts",
    color: "#e0b84a",
    url: ATLASES.yacht.base,
    data: `${ATLASES.yacht.base}/itinerary.json`,
  },
  worldcruise: {
    label: "World Cruises",
    color: "#45d6c2",
    url: ATLASES.worldcruise.base,
    data: `${ATLASES.worldcruise.base}/itinerary.json`,
  },
};

// Globe-only pin nudges: each atlas centers a region on its own itineraries, so
// the same place can land ~9° apart or nearly on top of another. Shift only
// these live-globe pins so paired regions read clearly. Keyed [lng,lat].
const PIN_NUDGE: Partial<Record<OverlayKey, Record<string, [number, number]>>> = {
  worldcruise: { MED: [20, 36.5] },
  yacht: { MED: [9.36, 41.24], SEASIA: [104.7, 6.6], CENTRALAM: [-81.99, 9.67] },
};

// Fallback region centers [lng,lat,zoom] used to focus a ?region= deep link
// before /api/regions geometry resolves, and to place result pins that arrive
// without coordinates.
const REGION_FALLBACK: Record<string, [number, number, number]> = {
  antarctica: [0, -72, 2.3], arctic: [8, 79, 2.3], galapagos: [-91, -0.4, 5],
  amazon: [-60, -3.5, 3.8], polynesia: [-149, -17, 3.4], patagonia: [-72, -49, 3.6],
  kimberley: [126, -16, 4.3], mediterranean: [15, 38.5, 3.4], norway: [12, 65, 3.4],
  japan: [138, 37, 3.9], namibia: [17, -22, 4.2], alaska: [-149, 60.5, 4],
  caribbean: [-66, 16, 4], baja: [-111.5, 24, 4.4], britishisles: [-3, 58, 4],
  seychelles: [55.5, -4.6, 5],
};

const LEGEND: { key: string; label: string; color: string }[] = [
  { key: "hotel", label: "VIP Hotels", color: "#e6d488" },
  { key: "cruise", label: OVERLAYS.cruise.label, color: OVERLAYS.cruise.color },
  { key: "jet", label: OVERLAYS.jet.label, color: OVERLAYS.jet.color },
  { key: "yacht", label: OVERLAYS.yacht.label, color: OVERLAYS.yacht.color },
  { key: "worldcruise", label: OVERLAYS.worldcruise.label, color: OVERLAYS.worldcruise.color },
];

// Selectable Mapbox basemaps surfaced via the style menu. Each carries its own
// fog so the globe atmosphere stays in key with the basemap.
const GLOBE_FOG = {
  color: "rgb(11,13,18)", "high-color": "rgb(22,27,38)",
  "horizon-blend": 0.04, "space-color": "rgb(6,8,12)", "star-intensity": 0.45,
};
// The globe opens on Dark (the house default). When the Guide plots results we
// flip to Satellite (photoreal) to reveal them; the traveler can switch back, or
// to Dusk (Mapbox Standard vector with 3D buildings), at any time.
type StyleKey = "dark" | "satellite" | "dusk";
const DUSK_FOG = {
  color: "rgb(58,48,62)", "high-color": "rgb(120,86,70)",
  "horizon-blend": 0.05, "space-color": "rgb(10,8,12)", "star-intensity": 0.2,
};
const ATLAS_STYLES: Record<StyleKey, { label: string; url: string; fog: Record<string, unknown>; sw: string; light?: string; theme?: string }> = {
  dark: { label: "Dark", url: "mapbox://styles/mapbox/dark-v11", fog: GLOBE_FOG, sw: "#11151c" },
  satellite: {
    label: "Satellite", url: "mapbox://styles/mapbox/standard-satellite",
    fog: { color: "rgb(18,22,30)", "high-color": "rgb(40,52,72)", "horizon-blend": 0.06, "space-color": "rgb(6,8,12)", "star-intensity": 0.3 },
    sw: "#3b5a3a",
  },
  // Mapbox Standard renders 3D buildings at city zoom; the dusk light preset gives
  // a warm golden-hour cast that stays legible without the brightness of day.
  dusk: { label: "Dusk", url: "mapbox://styles/mapbox/standard", fog: DUSK_FOG, sw: "#caa46a", light: "dusk" },
};

// Imperative handle the control buttons call into; the map lifecycle effect
// fills it so React state (style key, projection, fullscreen) drives Mapbox.
interface AtlasApi {
  setStyle(key: StyleKey): void;
  setProjection(globe: boolean): void;
  resize(): void;
  plot(meta: GuideMeta): void;
  resetView(): void;
}

interface Props {
  type: OfferingType;
  region: string | null;
  externalLink: string;
  /** "all" → the full Living Atlas (home). Omitted → only this `type`'s layer. */
  scope?: "all";
}

export default function AtlasShell({ type, region, externalLink, scope }: Props) {
  const allInventory = scope === "all";
  const showsHotel = allInventory || type === "hotel";
  const overlayKeys = (Object.keys(OVERLAYS) as OverlayKey[]).filter((k) => allInventory || type === k);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || FALLBACK_TOKEN;
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MBMap | null>(null);
  const apiRef = useRef<AtlasApi | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [styleKey, setStyleKey] = useState<StyleKey>("dark");
  const [is3D, setIs3D] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [badge, setBadge] = useState<{ n: number; total: number; deepLink?: string | null } | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  useEffect(() => {
    if (!token || !mapEl.current) return;
    let cancelled = false;
    let spinRAF = 0;
    let spinning = false;
    let ready = false;
    let focused = false;
    let restyling = false;
    let subsetActive = false;
    let homeZoom = 1.25;
    let projGlobe = true;
    let styleKeyLocal: StyleKey = "dark";
    let ro: ResizeObserver | undefined;
    let loadTimeout = 0;
    const node = mapEl.current;

    // Cached feeds so a basemap switch re-paints from memory, not the network.
    let hotelFC: HotelFC | null = null;
    const overlayFeats: Partial<Record<OverlayKey, OverlayFeature[]>> = {};
    const routeLines: Partial<Record<OverlayKey, [number, number][][]>> = {};
    let routesFetched = false;
    let featuredFC: FeaturedFC | null = null;
    let regionsGeo: Record<string, [number, number]> = {};

    function escapeHtml(s: string) {
      return String(s).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
      );
    }
    function regionLookupKey(raw: string) {
      const v = String(raw || "")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!v) return "";
      if (v.includes("alaska")) return "alaska";
      if (v.includes("caribbean") || v.includes("bermuda")) return "caribbean";
      if (v.includes("baja")) return "baja";
      if (v.includes("british isles") || v.includes("northern europe")) return "britishisles";
      if (v.includes("seychelles") || v.includes("indian ocean")) return "seychelles";
      return v.replace(/\s+/g, "");
    }

    loadMapbox()
      .then((mapboxgl) => {
        if (cancelled || !mapEl.current) return;
        mapboxgl.accessToken = token;
        const map = new mapboxgl.Map({
          container: mapEl.current,
          style: ATLAS_STYLES.dark.url,
          projection: "globe",
          center: [10, 20],
          zoom: 1.25,
          minZoom: 0.6,
        }) as MBMap;
        mapRef.current = map;
        const popup = new mapboxgl.Popup({
          closeButton: true,
          closeOnClick: true,
          offset: 12,
          maxWidth: "240px",
        });

        function fitGlobe() {
          const w = node.clientWidth, h = node.clientHeight;
          if (!w || !h) return;
          const z = Math.log2((Math.min(w, h) * 0.92) / 162.97);
          homeZoom = Math.max(map.getMinZoom(), Math.min(z, 5));
          map.setZoom(homeZoom);
        }
        function stopSpin() {
          spinning = false;
          cancelAnimationFrame(spinRAF);
        }
        function spinStep() {
          if (!spinning) return;
          if (projGlobe && !subsetActive && map.getZoom() <= homeZoom + 0.4 && !document.hidden) {
            const c = map.getCenter();
            map.setCenter({ lng: c.lng - 0.045, lat: c.lat });
          }
          spinRAF = requestAnimationFrame(spinStep);
        }
        function startSpin() {
          if (spinning || !projGlobe) return;
          spinning = true;
          spinStep();
        }

        // ── Layer painting (re-run on every style.load so basemap switches keep
        //    their layers) ───────────────────────────────────────────────────
        function paintHotel() {
          if (!showsHotel || !hotelFC || !hotelFC.features.length) return;
          if (!map.getSource(HOTEL_DENSITY_SOURCE)) {
            map.addSource(HOTEL_DENSITY_SOURCE, { type: "geojson", data: hotelFC });
          }
          addLayer(map, {
            id: "hotel-heat", type: "heatmap", source: HOTEL_DENSITY_SOURCE, maxzoom: 4.35,
            paint: {
              "heatmap-weight": 1,
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.65, 3, 1.1],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 12, 3, 24],
              "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.36, 3.4, 0.18, 4.3, 0],
              "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(201,168,76,0)", 0.22, "rgba(201,168,76,0.15)",
                0.55, "rgba(226,200,122,0.34)", 0.86, "rgba(255,238,177,0.55)",
                1, "rgba(255,247,213,0.68)",
              ],
            },
          });
          addLayer(map, {
            id: "hotel-dots", type: "circle", source: HOTEL_DENSITY_SOURCE, minzoom: HOTEL_DOT_MIN_ZOOM,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 2.45, 1.5, 4, 2.7, 7, 3.6, 10, 4.8],
              "circle-color": "#f7e6a0",
              "circle-opacity": subsetActive
                ? 0.12
                : ["interpolate", ["linear"], ["zoom"], 2.45, 0.18, 3.2, 0.62, 7, 0.92],
              "circle-stroke-color": "rgba(26,20,7,.88)",
              "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2.45, 0.45, 7, 1.1],
              "circle-blur": 0,
            },
          });
          applyHidden("hotel");
        }

        function paintOverlay(key: OverlayKey) {
          const feats = overlayFeats[key];
          if (!feats || !feats.length) return;
          const cfg = OVERLAYS[key];
          const src = "t_" + key;
          if (!map.getSource(src)) {
            map.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features: feats } });
          }
          addLayer(map, {
            id: src + "_glow", type: "circle", source: src,
            paint: { "circle-radius": 9, "circle-color": cfg.color, "circle-opacity": 0.18, "circle-blur": 0.8 },
          });
          addLayer(map, {
            id: src + "_dot", type: "circle", source: src,
            paint: { "circle-radius": 5, "circle-color": cfg.color, "circle-stroke-color": "#0b0e14", "circle-stroke-width": 1.2 },
          });
          applyHidden(key);
        }

        function paintFeatured() {
          if (!featuredFC || !featuredFC.features.length) return;
          if (!map.getSource("featured")) {
            map.addSource("featured", { type: "geojson", data: featuredFC });
          } else {
            map.getSource("featured")?.setData(featuredFC);
          }
          addLayer(map, {
            id: "featured-glow", type: "circle", source: "featured",
            paint: { "circle-radius": 12, "circle-color": "#e2c87a", "circle-opacity": 0.24, "circle-blur": 0.7 },
          });
          addLayer(map, {
            id: "featured-dot", type: "circle", source: "featured",
            paint: { "circle-radius": 5.5, "circle-color": "#e2c87a", "circle-stroke-color": "#5f4c1d", "circle-stroke-width": 0.8 },
          });
        }

        function paintAll() {
          paintHotel();
          overlayKeys.forEach(paintOverlay);
          paintFeatured();
          if (ROUTES_ENABLED && routesFetched) overlayKeys.forEach(paintRoutesForKey);
        }

        function paintRoutesForKey(key: OverlayKey) {
          const lines = routeLines[key];
          if (!lines || !lines.length) return;
          const cfg = OVERLAYS[key];
          const src = "r_" + key;
          const data = {
            type: "FeatureCollection" as const,
            features: lines.map((pts) => ({
              type: "Feature" as const,
              geometry: { type: "LineString" as const, coordinates: pts },
              properties: { type: key },
            })),
          };
          if (!map.getSource(src)) {
            map.addSource(src, { type: "geojson", data });
          } else {
            map.getSource(src)?.setData(data);
          }
          addLayer(map, {
            id: src + "_shadow", type: "line", source: src,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#000010", "line-width": 4, "line-opacity": 0.22 },
          });
          addLayer(map, {
            id: src + "_line", type: "line", source: src,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": cfg.color, "line-width": 1.6, "line-dasharray": [1, 5], "line-opacity": 0.82 },
          });
          // Visibility: only above ROUTE_ZOOM and when the type is not hidden
          const vis = map.getZoom() >= ROUTE_ZOOM && !hiddenRef.current.has(key) ? "visible" : "none";
          [src + "_shadow", src + "_line"].forEach((id) => {
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
          });
        }

        async function loadRoutes() {
          routesFetched = true; // set early so style.load repaints work correctly
          await Promise.all(
            overlayKeys.map(async (key) => {
              try {
                routeLines[key] = await fetchRouteLines(key);
                if (!cancelled) paintRoutesForKey(key);
              } catch { /* route data is optional — one miss shouldn't break others */ }
            }),
          );
        }

        function applyHidden(key: string) {
          const off = hiddenRef.current.has(key);
          layerIdsFor(key).forEach((id) => {
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", off ? "none" : "visible");
          });
        }

        // ── Click wiring (once; tolerant of layers re-created on restyle) ─────
        function wireHandlers() {
          map.on("click", "hotel-dots", (e: MBEvent) => {
            if (map.getZoom() < HOTEL_CLICK_MIN_ZOOM) return; // ambient zoom: not tappable
            const f = e.features?.[0];
            if (!f) return;
            const id = f.properties.id || "";
            const name = f.properties.name || "VIP Hotel";
            const reg = f.properties.region;
            const href = id ? `/atlas/hotel?ids=${encodeURIComponent(id)}` : "/atlas/hotel";
            const html =
              `<div class="iw"><div class="iwn">${escapeHtml(name)}</div>` +
              (reg ? `<div class="iwm">${escapeHtml(reg)}</div>` : "") +
              `<a href="${escapeHtml(href)}">Open VIP Hotels Atlas →</a></div>`;
            popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
          });
          map.on("mouseenter", "hotel-dots", () => {
            if (map.getZoom() >= HOTEL_CLICK_MIN_ZOOM) map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "hotel-dots", () => { map.getCanvas().style.cursor = ""; });

          for (const key of overlayKeys) {
            const cfg = OVERLAYS[key];
            const src = "t_" + key;
            map.on("click", src + "_dot", (e: MBEvent) => {
              const f = e.features?.[0];
              if (!f) return;
              const count = Number(f.properties.count) || undefined;
              const href = internalAtlasLink(
                key,
                f.properties.key ? `?region=${encodeURIComponent(f.properties.key)}` : "",
              );
              const html =
                `<div class="iw"><div class="iwn">${escapeHtml(f.properties.name)}</div>` +
                `<div class="iwm">${escapeHtml(overlayMeta(key, count))}</div>` +
                `<a href="${escapeHtml(href)}">Open ${escapeHtml(cfg.label)} Atlas →</a></div>`;
              popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
            });
            map.on("mouseenter", src + "_dot", () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", src + "_dot", () => { map.getCanvas().style.cursor = ""; });
          }

          map.on("click", "featured-dot", (e: MBEvent) => {
            const f = e.features?.[0];
            if (!f) return;
            popup.setLngLat(e.lngLat).setHTML(f.properties.html || "").addTo(map);
          });
          map.on("mouseenter", "featured-dot", () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", "featured-dot", () => { map.getCanvas().style.cursor = ""; });

          // Progressive zoom: load route lines on first crossing above ROUTE_ZOOM,
          // then toggle their visibility on subsequent zoom changes.
          map.on("zoomend", () => {
            const z = map.getZoom();
            if (ROUTES_ENABLED && z >= ROUTE_ZOOM && !routesFetched) {
              loadRoutes();
            } else if (routesFetched) {
              overlayKeys.forEach((key) => {
                const vis = z >= ROUTE_ZOOM && !hiddenRef.current.has(key) ? "visible" : "none";
                ["r_" + key + "_shadow", "r_" + key + "_line"].forEach((id) => {
                  if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
                });
              });
            }
          });
        }

        // ── Result plotting (fit + satellite), triggered by the Guide ─────────
        function plotResults(meta: GuideMeta) {
          // Plot EVERY tool's results, not just the lead. A hotel ask often also
          // fires a yacht sidecar tool that carries no coordinates; picking only
          // the last tool with results meant hotels (which DO have coords) never
          // plotted. Aggregate across tools, each anchored on its own chartRegion.
          const tools = (meta.tools || []).filter((t) => (t.results?.length ?? 0) > 0);
          if (!tools.length) return;
          type Feat = {
            type: "Feature";
            geometry: { type: "Point"; coordinates: [number, number] };
            properties: { name: string; html: string };
          };
          const features: Feat[] = [];
          let total = 0;
          for (const tool of tools) {
            const kind = (tool.type as OfferingType) || "hotel";
            // Center for results that arrive without coordinates: the chart region
            // the Guide chose (e.g. caribbean), never an arbitrary [10,20] point,
            // which sits in the Sahara and made Caribbean results pin over Niger.
            const chart = tool.chartRegion || meta.chartRegion || "";
            const cc = chart ? regionCenter(chart, regionsGeo, regionLookupKey) : null;
            const fallbackCenter: [number, number] | null = cc ? [cc[0], cc[1]] : null;
            const recs = (tool.results ?? []).slice(0, 60);
            total += tool.total ?? recs.length;
            recs.forEach((r, i) => {
              const coords = pointForResult(r, i, recs.length, regionsGeo, fallbackCenter);
              if (!coords) return; // unplaceable: skip rather than mis-pin
              features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: coords },
                properties: { name: r.name || "", html: featuredHtml(r, kind, escapeHtml) },
              });
            });
          }
          featuredFC = { type: "FeatureCollection", features };
          if (!featuredFC.features.length) return; // nothing locatable to plot
          subsetActive = true;
          stopSpin();
          const leadDeep = tools.find((t) => t.deepLink)?.deepLink || meta.deepLink || undefined;
          setBadge({ n: features.length, total, deepLink: toInternalAtlasHref(leadDeep) ?? leadDeep });
          paintHotel(); // re-tint ambient field dimmer
          // Flip to Satellite to reveal the plotted results on the photoreal
          // basemap. The restyle's style.load repaints every layer and re-fits
          // (subsetActive is set), so we only paint/fit inline if already there.
          if (styleKeyLocal !== "satellite") {
            api.setStyle("satellite");
          } else {
            paintFeatured();
            fitFeatured();
          }
        }
        function fitFeatured() {
          if (!featuredFC || !featuredFC.features.length) return;
          try {
            const b = new (mapboxgl as MapboxModule).LngLatBounds();
            featuredFC.features.forEach((f) => b.extend(f.geometry.coordinates));
            map.fitBounds(b, { padding: 78, maxZoom: showsHotel ? 10 : 4.8, duration: 900 });
          } catch { /* fit optional */ }
        }

        // Mapbox emits benign "error" events all session — log, never tear down.
        map.on("error", (e: MBEvent) => {
          const msg = (e as { error?: { message?: string } })?.error?.message;
          if (msg) console.warn("[atlas] map error", msg);
        });

        // Fallback to the elegant handoff panel if the globe never loads.
        loadTimeout = window.setTimeout(() => {
          if (!ready && !cancelled) setMapFailed(true);
        }, 12000);
        ["mousedown", "touchstart", "wheel", "dragstart"].forEach((ev) => map.on(ev, stopSpin));

        ro = new ResizeObserver(() => {
          try {
            map.resize();
            if (ready && !focused && !subsetActive && projGlobe && map.getZoom() <= homeZoom + 0.4) fitGlobe();
          } catch { /* observer noise */ }
        });
        ro.observe(node);

        // style.load fires on the first load AND after every setStyle — the one
        // place we (re)apply fog, projection and all data layers.
        map.on("style.load", () => {
          if (cancelled) return;
          const s = ATLAS_STYLES[styleKeyLocal] || ATLAS_STYLES.dark;
          setFog(map, s.fog);
          // Some Standard-family styles carry a light preset / theme override;
          // styles without them keep Mapbox's day default. Classic styles (Dark)
          // ignore these config calls.
          if (s.light || s.theme) {
            const cfg = map as unknown as { setConfigProperty(s: string, k: string, v: string): void };
            if (s.light) { try { cfg.setConfigProperty("basemap", "lightPreset", s.light); } catch { /* not a Standard style */ } }
            if (s.theme) { try { cfg.setConfigProperty("basemap", "theme", s.theme); } catch { /* theme unsupported */ } }
          }
          try { map.setProjection(projGlobe ? "globe" : "mercator"); } catch { /* projection optional */ }
          paintAll();

          if (!ready) {
            ready = true;
            clearTimeout(loadTimeout);
            wireHandlers();
            setMapReady(true);
            bootData();
          } else if (restyling) {
            restyling = false;
            // Keep any plotted results in view after a manual basemap switch.
            if (subsetActive) fitFeatured();
          }
        });

        // First-load data fetch → cache → paint → fit/spin or focus region.
        async function bootData() {
          if (showsHotel) {
            try {
              hotelFC = await fetchHotelPoints();
              if (cancelled) return;
              paintHotel();
              setLoaded((l) => new Set(l).add("hotel"));
            } catch { /* dot field optional */ }
          }
          regionsGeo = await loadRegions();
          if (cancelled) return;
          // Honor a ?region= deep link: focus that region instead of spinning.
          const focus = region ? regionCenter(region, regionsGeo, regionLookupKey) : null;
          if (focus) {
            focused = true;
            map.flyTo({ center: [focus[0], focus[1]], zoom: focus[2], speed: 0.8 });
          } else {
            fitGlobe();
            startSpin();
          }
          for (const key of overlayKeys) {
            try {
              overlayFeats[key] = await fetchOverlay(key);
              if (cancelled) return;
              paintOverlay(key);
              setLoaded((l) => new Set(l).add(key));
            } catch { /* one atlas down should not break the rest */ }
          }
        }

        // Imperative API the control buttons drive.
        const api: AtlasApi = {
          setStyle(key) {
            if (key === styleKeyLocal) return;
            styleKeyLocal = key;
            setStyleKey(key);
            restyling = true;
            try { map.setStyle(ATLAS_STYLES[key].url); } catch { restyling = false; }
          },
          setProjection(globe) {
            projGlobe = globe;
            setIs3D(globe);
            try { map.setProjection(globe ? "globe" : "mercator"); } catch { /* optional */ }
            if (globe) {
              if (!subsetActive && !focused) { fitGlobe(); startSpin(); }
            } else {
              stopSpin();
            }
          },
          resize() {
            setTimeout(() => { try { map.resize(); } catch { /* noop */ } }, 60);
          },
          plot(meta) { plotResults(meta); },
          resetView() {
            subsetActive = false;
            featuredFC = null;
            setBadge(null);
            if (map.getSource("featured")) {
              ["featured-glow", "featured-dot"].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
              try { (map as MBMap).removeSource("featured"); } catch { /* noop */ }
            }
            paintHotel(); // restore full ambient opacity
            if (projGlobe) { focused = false; fitGlobe(); startSpin(); }
          },
        };
        apiRef.current = api;
      })
      .catch(() => setMapFailed(true));

    return () => {
      cancelled = true;
      cancelAnimationFrame(spinRAF);
      clearTimeout(loadTimeout);
      ro?.disconnect();
      apiRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // region/scope/type captured on mount; route changes re-mount the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // The Guide broadcasts recommendations; fit + satellite to reveal them.
  // It also broadcasts "bevvip:atlas-reset" when the traveler starts the session
  // over, so the globe drops any plotted results and returns to its resting,
  // idle-spinning state — the same restart, in lockstep with the cleared chat.
  useEffect(() => {
    if (!allInventory) return;
    function onPlot(e: Event) {
      const meta = (e as CustomEvent<GuideMeta>).detail;
      if (meta) apiRef.current?.plot(meta);
    }
    function onReset() {
      apiRef.current?.resetView();
    }
    window.addEventListener("bevvip:atlas-plot", onPlot as EventListener);
    window.addEventListener("bevvip:atlas-reset", onReset as EventListener);
    return () => {
      window.removeEventListener("bevvip:atlas-plot", onPlot as EventListener);
      window.removeEventListener("bevvip:atlas-reset", onReset as EventListener);
    };
  }, [allInventory]);

  // Close the style menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc() { setMenuOpen(false); }
    window.addEventListener("click", onDoc);
    return () => window.removeEventListener("click", onDoc);
  }, [menuOpen]);

  // Esc exits fullscreen.
  useEffect(() => {
    if (!isFull) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setIsFull(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFull]);

  // Resize the globe after the panel grows/shrinks for fullscreen.
  useEffect(() => { apiRef.current?.resize(); }, [isFull]);

  function toggleLayer(key: string) {
    const map = mapRef.current;
    const off = !hidden.has(key);
    setHidden((s) => {
      const next = new Set(s);
      if (off) next.add(key);
      else next.delete(key);
      return next;
    });
    if (!map) return;
    layerIdsFor(key).forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", off ? "none" : "visible");
    });
  }

  const showFallback = !token || mapFailed;
  const legendRows = LEGEND.filter((it) => loaded.has(it.key));

  return (
    <div className={`atlas-map${isFull ? " fs" : ""}`}>
      {token && !mapFailed && <div ref={mapEl} className="atlas-canvas" />}
      {token && !mapFailed && !mapReady && (
        <div className="fallback">
          <span className="badge">{region ? `Region · ${region}` : ATLASES[type].label}</span>
          <p>Charting the Atlas…</p>
        </div>
      )}

      {!showFallback && (
        <div className="atlas-ctrls" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="actrl"
            onClick={() => setIsFull((v) => !v)}
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
              <i className="sw" style={{ background: ATLAS_STYLES[styleKey].sw }} /> Style
            </button>
            {menuOpen && (
              <div className="actrl-menu" role="menu">
                {(Object.keys(ATLAS_STYLES) as StyleKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitem"
                    className={k === styleKey ? "active" : ""}
                    onClick={() => { apiRef.current?.setStyle(k); setMenuOpen(false); }}
                  >
                    <i className="sw" style={{ background: ATLAS_STYLES[k].sw }} />
                    {ATLAS_STYLES[k].label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="actrl"
            onClick={() => apiRef.current?.setProjection(!is3D)}
            title={is3D ? "Switch to flat 2D map" : "Switch to 3D globe"}
          >
            {is3D ? "2D" : "3D"}
          </button>
        </div>
      )}

      {!showFallback && legendRows.length > 0 && (
        <div className="atlas-legend">
          <div className="lgcap">Tap to hide</div>
          {legendRows.map((it) => (
            <button
              key={it.key}
              type="button"
              className={`lgi${hidden.has(it.key) ? " off" : ""}`}
              onClick={() => toggleLayer(it.key)}
              title={hidden.has(it.key) ? "Tap to show" : "Tap to hide"}
            >
              <i style={{ background: it.color }} />
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}

      {!showFallback && badge && (
        <div className="atlas-badge">
          {badge.total > badge.n && badge.deepLink ? (
            <>
              Showing {badge.n} of {badge.total} ·{" "}
              <a href={badge.deepLink}>all in Atlas →</a>
            </>
          ) : (
            <>{badge.n} plotted</>
          )}
          <button type="button" className="bx" onClick={() => apiRef.current?.resetView()} title="Show all">
            Reset
          </button>
        </div>
      )}

      {showFallback && (
        <div className="fallback">
          <span className="badge">{region ? `Region · ${region}` : "All inventory"}</span>
          <p>
            Map unavailable right now. The full {ATLASES[type].label} is one click away —
            your selection carries over.
          </p>
          <a className="atlas-cta" href={externalLink}>
            Open {ATLASES[type].label} →
          </a>
          <div className="region-chips">
            {ATLASES[type].sampleRegions.map((r) => (
              <a
                key={r}
                className="chip"
                href={internalAtlasLink(type, `?region=${encodeURIComponent(r)}`)}
              >
                {r}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Data helpers ─────────────────────────────────────────────────────────────

/* Region geometry (bbox + center), used to focus a ?region= deep link and to
   place result pins that arrive without coordinates. */
async function loadRegions(): Promise<Record<string, [number, number]>> {
  const geo: Record<string, [number, number]> = {};
  try {
    const j = await (await fetch(`${HOTEL_BASE}/api/regions`)).json();
    (j.regions || []).forEach((r: { region: string; center?: [number, number] }) => {
      if (Array.isArray(r.center) && r.center.length === 2) geo[r.region] = r.center;
    });
  } catch { /* regions optional; map still usable */ }
  return geo;
}

interface OverlayFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { type: string; key: string; name: string; count: number };
}

async function fetchOverlay(key: OverlayKey): Promise<OverlayFeature[]> {
  const cfg = OVERLAYS[key];
  const json = await (await fetch(cfg.data)).json();
  const regs = regionsFromData(json).sort((a, b) => (b.count || 0) - (a.count || 0));
  const nudge = PIN_NUDGE[key];
  if (nudge) for (const r of regs) { const o = nudge[r.key]; if (o) { r.lng = o[0]; r.lat = o[1]; } }
  return regs.map((r) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] as [number, number] },
    properties: { type: key, key: r.key, name: r.name, count: r.count },
  }));
}

interface Reg { key: string; name: string; lng: number; lat: number; count: number }

/* Normalize an atlas-meta / itinerary feed into region pins. Each app keys its
   regions the same way it tags trips (the `g` array). Counts come from the meta
   when present (cruise), otherwise tallied from TRIPS (jet/yacht/world). */
function regionsFromData(json: {
  REGIONS?: Record<string, { coord?: [number, number]; name?: string; count?: number }>;
  TRIPS?: { g?: string[] }[];
}): Reg[] {
  const R = json.REGIONS || {};
  const trips = Array.isArray(json.TRIPS) ? json.TRIPS : [];
  const tally: Record<string, number> = {};
  for (const t of trips) for (const g of t?.g || []) tally[g] = (tally[g] || 0) + 1;
  const out: Reg[] = [];
  for (const k of Object.keys(R)) {
    const r = R[k];
    if (!r || !Array.isArray(r.coord) || r.coord.length < 2) continue;
    const name = r.name || k;
    if (/^other\b/i.test(k) || /^other\b/i.test(name)) continue; // skip catch-all buckets
    const count = r.count != null ? r.count : tally[k] || 0;
    out.push({ key: k, name, lng: Number(r.coord[1]), lat: Number(r.coord[0]), count });
  }
  return out.filter((r) => Number.isFinite(r.lng) && Number.isFinite(r.lat));
}

function overlayMeta(key: OverlayKey, count?: number): string {
  if (key === "cruise") return `Expedition Cruises${count ? ` · ${count} sailings` : ""}`;
  if (key === "worldcruise") return `World Cruises${count ? ` · ${count} voyages calling here` : ""}`;
  if (key === "jet") return `Private Jet Journeys${count ? ` · ${count} journeys` : ""}`;
  return `Luxury Hotel Yachts${count ? ` · ${count} charters` : ""}`;
}

function regionCenter(
  region: string,
  geo: Record<string, [number, number]>,
  lookupKey: (s: string) => string,
): [number, number, number] | null {
  if (geo[region]) return [geo[region][0], geo[region][1], 4];
  const direct = REGION_FALLBACK[region];
  if (direct) return direct;
  const k = lookupKey(region);
  if (k && REGION_FALLBACK[k]) return REGION_FALLBACK[k];
  return null;
}

/* Coordinates for a result pin: prefer its own lng/lat, else fall back to its
   region center with a tiny per-index spiral so co-located pins don't stack. */
function pointForResult(
  r: OfferingResult,
  i: number,
  total: number,
  geo: Record<string, [number, number]>,
  fallbackCenter: [number, number] | null,
): [number, number] | null {
  const lng = Number((r as { lng?: number }).lng);
  const lat = Number((r as { lat?: number }).lat);
  if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  const key = String(r.region || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const fb = REGION_FALLBACK[key];
  const base: [number, number] | undefined =
    geo[r.region || ""] || (fb ? [fb[0], fb[1]] : undefined) || fallbackCenter || undefined;
  // No coordinates and no region we can place it in: skip the pin rather than
  // dropping it at a meaningless default location.
  if (!base) return null;
  if (total <= 1) return base;
  const ang = (i / total) * Math.PI * 2;
  return [base[0] + Math.cos(ang) * 1.4, base[1] + Math.sin(ang) * 1.4];
}

// Translate an external atlas deep link (…vercel.app/?region=&ids=) into the
// in-app atlas route (/atlas/<type>?…), preserving its query. Returns null when
// the URL isn't one of our atlas bases (so callers can fall back).
function toInternalAtlasHref(url?: string | null): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  for (const t of Object.keys(ATLASES) as OfferingType[]) {
    let baseOrigin: string;
    try {
      baseOrigin = new URL(ATLASES[t].base).origin;
    } catch {
      continue;
    }
    if (u.origin === baseOrigin) return internalAtlasLink(t, u.search);
  }
  return null;
}

function featuredHtml(r: OfferingResult, kind: OfferingType, esc: (s: string) => string): string {
  const meta = [r.brand || r.operator, (r as { ship?: string }).ship, r.region].filter(Boolean).join(" · ");
  const when = [r.duration || r.country, r.dates || (r as { month?: string }).month].filter(Boolean).join("  ·  ");
  const href =
    toInternalAtlasHref(r.deepLink) ||
    internalAtlasLink(kind, r.region ? `?region=${encodeURIComponent(r.region)}` : "");
  return (
    `<div class="iw"><div class="iwn">${esc(r.name || "Recommendation")}</div>` +
    `<div class="iwm">${esc([meta, when].filter(Boolean).join("  ·  "))}</div>` +
    `<a href="${esc(href)}">Open in Atlas →</a></div>`
  );
}

function layerIdsFor(key: string): string[] {
  if (key === "hotel") return ["hotel-heat", "hotel-dots"];
  // Route layers are only added once the user zooms past ROUTE_ZOOM; they may
  // not exist yet when the legend toggle fires, so getLayer guards handle that.
  return ["t_" + key + "_glow", "t_" + key + "_dot", "r_" + key + "_shadow", "r_" + key + "_line"];
}

// ── Route line feed ────────────────────────────────────────────────────────
// Returns arrays of [lng, lat] coordinate pairs (one array per route/trip).
// Each atlas stores route data differently; this normalises them all.

async function fetchRouteLines(key: OverlayKey): Promise<[number, number][][]> {
  try {
    if (key === "cruise") {
      // Dedicated routes file: { [slug]: [{n, ll:[lat,lng]}] }
      const r = await fetch(`${ATLASES.cruise.base}/data/itinerary-routes.json`);
      if (!r.ok) return [];
      const j: Record<string, { n?: string; ll?: [number, number] }[]> = await r.json();
      return Object.values(j)
        .map((stops) =>
          stops
            .filter((s) => Array.isArray(s.ll))
            .map((s) => [s.ll![1], s.ll![0]] as [number, number]),
        )
        .filter((pts) => pts.length >= 2);
    }
    if (key === "jet") {
      // itinerary.json → ROUTES: { [slug]: [{n, r, ll:[lat,lng]}] }
      const r = await fetch(`${ATLASES.jet.base}/itinerary.json`);
      if (!r.ok) return [];
      const j: { ROUTES?: Record<string, { ll?: [number, number] }[]> } = await r.json();
      const ROUTES = j.ROUTES || {};
      return Object.values(ROUTES)
        .map((stops) =>
          stops
            .filter((s) => Array.isArray(s.ll))
            .map((s) => [s.ll![1], s.ll![0]] as [number, number]),
        )
        .filter((pts) => pts.length >= 2);
    }
    // yacht + worldcruise: itinerary.json → TRIPS array + PORTS: {name:[lat,lng]}
    const base = key === "yacht" ? ATLASES.yacht.base : ATLASES.worldcruise.base;
    const r = await fetch(`${base}/itinerary.json`);
    if (!r.ok) return [];
    const j: {
      TRIPS?: { itin?: { n?: string }[] }[];
      PORTS?: Record<string, [number, number]>;
    } = await r.json();
    const PORTS = j.PORTS || {};
    const TRIPS = j.TRIPS || [];
    return TRIPS
      .map((trip) =>
        (trip.itin || [])
          .filter((s) => s.n && PORTS[s.n])
          .map((s) => { const ll = PORTS[s.n!]; return [ll[1], ll[0]] as [number, number]; }),
      )
      .filter((pts) => pts.length >= 2);
  } catch {
    return [];
  }
}

// ── Hotel point feed ───────────────────────────────────────────────────────

interface HotelFC {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: { id: string; region: string | null; name: string } }[];
}
interface FeaturedFC {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: { name: string; html: string } }[];
}

async function fetchHotelPoints(): Promise<HotelFC> {
  const PAGE = 200;
  const first = await fetchHotelPage(0, PAGE);
  const total = Number(first.total) || (first.results || []).length;
  const offsets: number[] = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
  const rest = await Promise.all(offsets.map((o) => fetchHotelPage(o, PAGE).catch(() => ({ results: [] }))));
  const features: HotelFC["features"] = [];
  [first, ...rest].forEach((page) => {
    const results = (page.results || []) as { lng?: number; lat?: number; id?: string; region?: string; name?: string }[];
    results.forEach((h) => {
      const lng = Number(h.lng), lat = Number(h.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { id: h.id || "", region: h.region || null, name: h.name || "" },
      });
    });
  });
  return { type: "FeatureCollection", features };
}

async function fetchHotelPage(offset: number, limit: number): Promise<{ total?: number; results?: unknown[] }> {
  const r = await fetch(`${HOTEL_BASE}/api/luxury-hotels?limit=${limit}&offset=${offset}`, { cache: "force-cache" });
  if (!r.ok) throw new Error("hotel atlas " + r.status);
  return r.json();
}

// ── Mapbox loader + minimal typings ────────────────────────────────────────

function addLayer(map: MBMap, spec: Record<string, unknown>) {
  if (map.getLayer(spec.id as string)) return;
  // On Standard-family styles circle layers are lit by the scene lighting model,
  // so under a dusk/night light preset our pins darken. Force full emissive
  // strength so they hold their color on every basemap (harmless on classic ones).
  if (spec.type === "circle") {
    const paint = (spec.paint ?? {}) as Record<string, unknown>;
    if (paint["circle-emissive-strength"] == null) paint["circle-emissive-strength"] = 1;
    spec.paint = paint;
  }
  try { map.addLayer(spec); } catch { /* layer skipped */ }
}

function setFog(map: MBMap, fog: Record<string, unknown>) {
  try { map.setFog(fog); } catch { /* fog optional */ }
}

interface MBEvent {
  lngLat: { lng: number; lat: number };
  features?: { properties: Record<string, string> }[];
}
interface MBPopup {
  setLngLat(c: { lng: number; lat: number }): MBPopup;
  setHTML(html: string): MBPopup;
  addTo(map: MBMap): MBPopup;
  remove(): void;
}
interface MBBounds {
  extend(c: [number, number]): MBBounds;
}
interface MBMap {
  on(type: string, layerOrCb: string | ((e: MBEvent) => void), cb?: (e: MBEvent) => void): void;
  getZoom(): number;
  getMinZoom(): number;
  getCenter(): { lng: number; lat: number };
  setCenter(c: { lng: number; lat: number }): void;
  setZoom(z: number): void;
  flyTo(opts: { center: [number, number]; zoom: number; speed?: number }): void;
  fitBounds(b: MBBounds, opts: Record<string, unknown>): void;
  resize(): void;
  remove(): void;
  addSource(id: string, src: unknown): void;
  getSource(id: string): { setData(d: unknown): void } | undefined;
  removeSource(id: string): void;
  addLayer(spec: Record<string, unknown>): void;
  getLayer(id: string): unknown;
  removeLayer(id: string): void;
  setPaintProperty(id: string, prop: string, val: unknown): void;
  setLayoutProperty(id: string, prop: string, val: unknown): void;
  setFog(f: unknown): void;
  setStyle(url: string): void;
  setProjection(name: string): void;
  getCanvas(): HTMLCanvasElement;
  getProjection(): { name: string };
}
interface MapboxModule {
  accessToken: string;
  Map: new (opts: Record<string, unknown>) => MBMap;
  Popup: new (opts: Record<string, unknown>) => MBPopup;
  LngLatBounds: new () => MBBounds;
}

declare global {
  interface Window {
    mapboxgl?: MapboxModule;
  }
}

// Cached so React Strict Mode's double-mount (and the home/atlas pages sharing
// the component) reuse one script + one promise instead of racing duplicates.
let mapboxPromise: Promise<MapboxModule> | null = null;

function loadMapbox(): Promise<MapboxModule> {
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  if (mapboxPromise) return mapboxPromise;
  if (!document.querySelector(`link[href="${MAPBOX_CSS}"]`)) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = MAPBOX_CSS;
    document.head.appendChild(css);
  }
  mapboxPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = MAPBOX_JS;
    s.onload = () => (window.mapboxgl ? resolve(window.mapboxgl) : reject(new Error("mapbox missing")));
    s.onerror = () => {
      mapboxPromise = null;
      reject(new Error("mapbox failed to load"));
    };
    document.head.appendChild(s);
  });
  return mapboxPromise;
}

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
// The globe boots on Satellite. When The Guide returns recommendations it
// broadcasts a "bevvip:atlas-plot" event; the globe fits the results (and
// returns to satellite if the traveler had switched away).
//
// Without a Mapbox token it degrades to an elegant fallback panel with the
// external-atlas handoff, so the app still works with zero configuration.

import { useEffect, useRef, useState } from "react";
import type { OfferingType, GuideMeta, OfferingResult } from "@/lib/types";
import { ATLASES, COLLECTIONS, internalAtlasLink } from "@/lib/atlas-config";
import { MAPBOX_JS, MAPBOX_CSS } from "@/lib/mapbox-cdn";
// Every coordinate this component touches is minted here. See lib/atlas/geo.ts
// for why: six upstream feeds disagree about [lat,lng] vs [lng,lat], and the
// convention used to live only in comments.
import {
  type LngLat,
  fromLatLngPair,
  fromLngLatPair,
  fromNamed,
  isFinitePair,
  offset as offsetLngLat,
  unrollLine,
} from "@/lib/atlas/geo";
// arcPts is the only piece of the sea router the browser still needs: jet and
// rail keep runtime geometry. Everything else is precomputed. k = 0.16 is what
// makes an arc read as a journey rather than a ruler — see sea-router.mjs.
import { arcPts } from "@/lib/atlas/sea-router.mjs";
import { mapStyleFallback, hotel3dOpened } from "@/lib/analytics";

// Public Mapbox token (Aspen Travel) — public by design, URL-restricted in the
// Mapbox account, and already shipped in the deployed atlas. Inlined as a
// fallback so the globe renders even when the Vercel env var is unset;
// NEXT_PUBLIC_MAPBOX_TOKEN overrides it.
const FALLBACK_TOKEN =
  "pk.eyJ1IjoiYXNwZW50cmF2ZWwiLCJhIjoiY21xNDJwcHA2MHZxMDJycTI2bm9maXNmMyJ9.xFFm4X4mqbWQVxmBhaQhBA";

// mapbox-gl v3.7's Standard-Satellite style fragment predates the
// show3dObjects config (its schema doesn't carry the key — getConfigProperty
// returns null), yet the fragment ships a ~40-entry .glb model catalog (oak /
// maple / pine / palm / turbine) that the runtime eagerly downloads even
// though nothing at globe zoom renders them. transformRequest serves those
// requests this empty-but-valid glTF instead: zero network, zero error
// events, nothing to draw. Drop it (the init/config show3dObjects toggles
// take over) once GL JS moves to a version whose satellite fragment carries
// show3dObjects in its schema.
const EMPTY_GLB =
  "data:model/gltf-binary;base64,Z2xURgIAAAB4AAAAZAAAAEpTT057ImFzc2V0Ijp7InZlcnNpb24iOiIyLjAifSwic2NlbmVzIjpbeyJub2RlcyI6W119XSwic2NlbmUiOjAsIm5vZGVzIjpbXSwibWVzaGVzIjpbXSwibWF0ZXJpYWxzIjpbXX0g";

const HOTEL_BASE = ATLASES.hotel.base;
const HOTEL_DOT_MIN_ZOOM = 2.45; // let hotels emerge before the ambient cloud fades
const HOTEL_CLICK_MIN_ZOOM = 4; // below this dots overlap — taps stay ambient
const ROUTE_ZOOM = 5.5;         // dashed route polylines appear above this zoom
// Routes are live as of Deliverable 1: sea geometry is precomputed at build
// time (scripts/build-sea-routes.mjs), so enabling this no longer means running
// A* in the visitor's main thread. Lines still only paint above ROUTE_ZOOM.
const ROUTES_ENABLED = true;
const HOTEL_DENSITY_SOURCE = "hotel-density";

// Master atlas overlays: cruise / jet / yacht / world-cruise / rail / villa
// region pins, each from its own live app data. Colors stay distinguishable on
// the dark globe.
type OverlayKey = "cruise" | "jet" | "yacht" | "worldcruise" | "train" | "villa";
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
  train: {
    label: "Rail Journeys",
    color: "#e08d5f",
    url: ATLASES.train.base,
    data: `${ATLASES.train.base}/itinerary.json`,
  },
  // Villa pins come from the villa search API's overlay view (the villa atlas
  // is server-rendered; there is no static /maps/villa data file). Keys are
  // the villa dataset's region names, which /atlas/villa?region= filters
  // natively, so the shared ?region= click-through works unchanged.
  villa: {
    label: "Private Villas",
    color: "#a8d08d",
    url: ATLASES.villa.base,
    data: "/api/villas/search?view=overlay",
  },
};

// Globe-only pin nudges: each atlas centers a region on its own itineraries, so
// the same place can land ~9° apart or nearly on top of another. Shift only
// these live-globe pins so paired regions read clearly. Authored [lng,lat].
const PIN_NUDGE: Partial<Record<OverlayKey, Record<string, LngLat>>> = {
  worldcruise: { MED: fromLngLatPair([20, 36.5]) },
  yacht: {
    MED: fromLngLatPair([9.36, 41.24]),
    SEASIA: fromLngLatPair([104.7, 6.6]),
    CENTRALAM: fromLngLatPair([-81.99, 9.67]),
  },
  // Hawaii's villa volume drags the US circular mean into the Pacific; pin the
  // mainland instead.
  villa: { "United States": fromLngLatPair([-98.5, 38.5]) },
};

// Fallback region cameras used to focus a ?region= deep link before
// /api/regions geometry resolves, and to place result pins that arrive without
// coordinates. Centers are authored [lng,lat]; zoom rides alongside rather
// than as a third tuple slot, so the pair can be minted as a LngLat.
type RegionCamera = { at: LngLat; zoom: number };
const cam = (lng: number, lat: number, zoom: number): RegionCamera => ({
  at: fromLngLatPair([lng, lat]),
  zoom,
});
const REGION_FALLBACK: Record<string, RegionCamera> = {
  antarctica: cam(0, -72, 2.3), arctic: cam(8, 79, 2.3), galapagos: cam(-91, -0.4, 5),
  amazon: cam(-60, -3.5, 3.8), polynesia: cam(-149, -17, 3.4), patagonia: cam(-72, -49, 3.6),
  kimberley: cam(126, -16, 4.3), mediterranean: cam(15, 38.5, 3.4), norway: cam(12, 65, 3.4),
  japan: cam(138, 37, 3.9), namibia: cam(17, -22, 4.2), alaska: cam(-149, 60.5, 4),
  caribbean: cam(-66, 16, 4), baja: cam(-111.5, 24, 4.4), britishisles: cam(-3, 58, 4),
  seychelles: cam(55.5, -4.6, 5), "northwest passage": cam(-95, 74, 2.8),
};

// Derived from the canonical COLLECTIONS list rather than hand-maintained, so
// the legend's order and colors can never drift from the header's Explore menu
// or the home page's promise. (They had: the legend led with hotels, the nav
// led with jets, and the blurb mentioned neither villas nor rail.)
const LEGEND: { key: string; label: string; color: string }[] = COLLECTIONS.map((c) => ({
  key: c.type,
  label: c.type === "hotel" ? "VIP Hotels" : OVERLAYS[c.type as OverlayKey]?.label ?? c.nav,
  color: c.color,
}));

// Selectable Mapbox basemaps surfaced via the style menu. Each carries its own
// fog so the globe atmosphere stays in key with the basemap.
const GLOBE_FOG = {
  color: "rgb(11,13,18)", "high-color": "rgb(22,27,38)",
  "horizon-blend": 0.04, "space-color": "rgb(6,8,12)", "star-intensity": 0.45,
};
// The globe opens on Satellite (photoreal, the house default). When the Guide
// plots results we make sure we're on Satellite to reveal them; the traveler
// can switch to Dark or Dusk (Mapbox Standard vector with 3D buildings) at any
// time.
type StyleKey = "dark" | "satellite" | "dusk";

// ── Basemap fallback ───────────────────────────────────────────────────────
// Satellite and Dusk are both Mapbox Standard-family styles; Dark is a classic
// style, and the two families fail independently. On 2026-07-29 both Standard
// styles stopped completing `style.load` for our token — every dependency
// (style JSON, all three source TileJSONs, sprite, glyphs, 32 .glb models)
// still returned 200 in under 100ms, and GL emitted no error, it simply never
// finished. The globe sat there for 12 seconds and then replaced itself with
// the "Map unavailable" handoff panel, while a working basemap was one
// setStyle away the whole time.
//
// So: if a style hasn't loaded in STYLE_FALLBACK_MS, drop to Dark. A degraded
// globe beats no globe, and this is basemap-agnostic — it covers whichever
// family breaks next, not just this incident.
const STYLE_FALLBACK_KEY: StyleKey = "dark";
const STYLE_FALLBACK_MS = 4000;
const DUSK_FOG = {
  color: "rgb(58,48,62)", "high-color": "rgb(120,86,70)",
  "horizon-blend": 0.05, "space-color": "rgb(10,8,12)", "star-intensity": 0.2,
};
const ATLAS_STYLES: Record<StyleKey, { label: string; url: string; fog: Record<string, unknown>; sw: string; light?: string; theme?: string; objects3d?: boolean }> = {
  dark: { label: "Dark", url: "mapbox://styles/mapbox/dark-v11", fog: GLOBE_FOG, sw: "#11151c" },
  satellite: {
    label: "Satellite", url: "mapbox://styles/mapbox/standard-satellite",
    fog: { color: "rgb(18,22,30)", "high-color": "rgb(40,52,72)", "horizon-blend": 0.06, "space-color": "rgb(6,8,12)", "star-intensity": 0.3 },
    sw: "#3b5a3a",
    // Without this, Standard Satellite falls to Mapbox's default `day` preset,
    // whose bright atmosphere washes the ocean pale after the raster loads.
    // `dusk` keeps the water deep and in key with the atlas's dark-luxe palette.
    light: "dusk",
    // Standard Satellite ships ~40 .glb tree/turbine models that are invisible
    // at globe zoom but cost seconds of cold-load network + parse. Off here;
    // Dusk (Standard) keeps its 3D buildings.
    objects3d: false,
  },
  // Mapbox Standard renders 3D buildings at city zoom; the dusk light preset gives
  // a warm golden-hour cast that stays legible without the brightness of day.
  dusk: { label: "Dusk", url: "mapbox://styles/mapbox/standard", fog: DUSK_FOG, sw: "#caa46a", light: "dusk" },
};

// The Guide's chat is persisted per session, but a route change (opening a
// full atlas, then Back) re-mounts the Living Atlas and would drop the framed
// subset. We stash the last plotted meta here so boot can replay it — the map
// re-opens on the same results the chat still shows, instead of the idle globe.
// Cleared on "start over" (resetView), in lockstep with the cleared chat.
const PLOT_STORAGE_KEY = "bevvip:atlas:last-plot";
function readStoredPlot(): GuideMeta | null {
  try {
    const raw = sessionStorage.getItem(PLOT_STORAGE_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw) as GuideMeta;
    return meta && Array.isArray(meta.tools) ? meta : null;
  } catch {
    return null; // storage unavailable or corrupt — fall back to the globe
  }
}

// Imperative handle the control buttons call into; the map lifecycle effect
// fills it so React state (style key, projection, fullscreen) drives Mapbox.
interface AtlasApi {
  setStyle(key: StyleKey): void;
  setProjection(globe: boolean): void;
  resize(): void;
  plot(meta: GuideMeta): void;
  refit(): void;
  resetView(): void;
}

/** A stop on a traced route: where it is, what it's called, which day. */
export interface FocusStop {
  name: string;
  at: [number, number];
  day?: number | null;
}

interface Props {
  type: OfferingType;
  region: string | null;
  externalLink: string;
  /** "all" → the full Living Atlas (home). Omitted → only this `type`'s layer. */
  scope?: "all";
  /**
   * Draw route lines at every zoom instead of only above ROUTE_ZOOM.
   *
   * On the home globe the zoom gate is right: seven collections' routes at
   * world zoom is a ball of wool. On a single-collection page the routes ARE
   * the content — the rail atlas's own tagline is "drawn along the tracks" —
   * so hiding them until zoom 5.5 means the page opens on an empty globe.
   */
  routesAlways?: boolean;
  /**
   * Collection pages pass this to make a region pin FILTER to that region
   * instead of opening a popup that links to `?region=` — which is the camera
   * focus param, not a filter, so clicking a pin used to "open everything".
   * Home leaves it undefined and keeps the popup + link.
   */
  onRegionSelect?: (regionKey: string) => void;
  /**
   * Draw the ambient all-routes layer at all.
   *
   * The home globe wants it: a faint web of every collection's lanes is the
   * "living atlas" texture. A COLLECTION page does not — there the interaction
   * is one traced route, and painting all 1,045 yacht legs underneath it turns
   * the Mediterranean into a cobweb that buries the route you selected.
   * Defaults on so the home canvas is unchanged.
   */
  ambientRoutes?: boolean;
  /**
   * Collection accent, from OVERLAYS — platinum for jets, copper for rail,
   * gold for yachts. Traced routes and their stop dots use it, so a jet route
   * stops looking like a railway.
   */
  accent?: string;
  /** Basemap this collection opens on. Jets read best on Dark. */
  initialStyle?: StyleKey;
  /** false → open flat (mercator). Long-haul flight arcs read better in 2D. */
  initialGlobe?: boolean;
  /** Exact opening camera, from a shared `@lng,lat,zoom`. */
  initialCamera?: { lng: number; lat: number; zoom: number } | null;
  /**
   * Reports basemap / projection / camera so a Share link can carry the view.
   * An advisor sharing with a client means "look at THIS, like THIS".
   */
  onViewChange?: (v: { style: StyleKey; globe: boolean; center: { lng: number; lat: number }; zoom: number }) => void;
}

export default function AtlasShell({
  type, region, externalLink, scope, routesAlways, onRegionSelect,
  ambientRoutes = true, accent, initialStyle, initialGlobe, initialCamera, onViewChange,
}: Props) {
  const allInventory = scope === "all";
  const showsHotel = allInventory || type === "hotel";
  const overlayKeys = (Object.keys(OVERLAYS) as OverlayKey[]).filter((k) => allInventory || type === k);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || FALLBACK_TOKEN;
  const mapEl = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MBMap | null>(null);
  const apiRef = useRef<AtlasApi | null>(null);
  // Filled by the map effect so the route-trace listener below can reach the
  // painters without re-running the whole map lifecycle.
  // Last traced route, so a basemap switch can repaint it. setStyle wipes all
  // sources and layers; a pinned route must outlive that.
  const lastFocusLegs = useRef<{ mode: string; coordinates: [number, number][] }[]>([]);
  // The map effect is keyed on [token] and never re-runs, so it must read the
  // handler through a ref rather than capturing it.
  const onRegionSelectRef = useRef(onRegionSelect);
  onRegionSelectRef.current = onRegionSelect;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const focusRouteRef = useRef<{
    paint(legs: { mode: string; coordinates: [number, number][] }[], stops?: FocusStop[]): void;
    clear(): void;
    fit(legs: { coordinates: [number, number][] }[]): void;
    /** Mark a routeless selection (a hotel) so the chosen pin is identifiable. */
    mark(stops: FocusStop[]): void;
  } | null>(null);
  const lastFocusStops = useRef<FocusStop[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  // Poster frame: a pre-rendered globe (same camera framing) painted from the
  // SSR HTML so the first "globe" pixel lands before any JS runs. It crossfades
  // out when the live map has fully drawn (mapPainted), then unmounts.
  const [mapPainted, setMapPainted] = useState(false);
  const [posterGone, setPosterGone] = useState(false);
  const [posterPad, setPosterPad] = useState(0);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [styleKey, setStyleKey] = useState<StyleKey>(initialStyle ?? "satellite");
  const [is3D, setIs3D] = useState(initialGlobe ?? true);
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
    let pulseRAF = 0;
    let pulsing = false;
    let ready = false;
    let focused = false;
    let restyling = false;
    let subsetActive = false;
    let homeZoom = 1.25;
    let projGlobe = initialGlobe ?? true;
    let styleKeyLocal: StyleKey = initialStyle ?? "satellite";
    // Collection accent for traced routes; falls back to rail copper.
    const accentLocal = accent || OVERLAYS[type as OverlayKey]?.color || "#e08d5f";
    let ro: ResizeObserver | undefined;
    let loadTimeout = 0;
    let styleWatchdog = 0;
    // Basemaps that failed to load this session. plotResults flips to Satellite
    // to reveal results, so without this every plot would re-attempt a known-
    // broken style and stall for STYLE_FALLBACK_MS again.
    const failedStyles = new Set<StyleKey>();
    const node = mapEl.current;

    // Data fetches launch immediately — in parallel with the mapbox-gl script
    // download and style/tile loading — so no feed waits on the map to boot.
    const hotelPromise: Promise<HotelFC | null> = showsHotel
      ? fetchHotelPoints().catch(() => null)
      : Promise.resolve(null);
    const regionsPromise = loadRegions();

    // Cached feeds so a basemap switch re-paints from memory, not the network.
    let hotelFC: HotelFC | null = null;
    let hotelRevealed = false; // first paint fades the field in; repaints are instant
    const overlayFeats: Partial<Record<OverlayKey, OverlayFeature[]>> = {};
    const routeLines: Partial<Record<OverlayKey, LngLat[][]>> = {};
    let routesFetched = false;
    // Zoom at which route lines become visible. routesAlways collapses it to 0
    // so a collection page opens with its routes already drawn.
    const routeGate = routesAlways ? 0 : ROUTE_ZOOM;
    let featuredFC: FeaturedFC | null = null;
    let regionsGeo: Record<string, LngLat> = {};

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
          style: ATLAS_STYLES[styleKeyLocal].url,
          projection: projGlobe ? "globe" : "mercator",
          center: [10, 20],
          zoom: 1.25,
          minZoom: 0.6,
          // Suppress the boot style's 3D model pipeline before it starts
          // fetching (style.load config below re-asserts this per basemap).
          config: { basemap: { show3dObjects: false } },
          // GL 3.7's satellite fragment ignores show3dObjects (see EMPTY_GLB);
          // stub its model catalog. Dusk keeps its real 3D buildings.
          transformRequest: (url: string) =>
            styleKeyLocal === "satellite" && url.includes("api.mapbox.com/models/")
              ? { url: EMPTY_GLB }
              : undefined,
        }) as MBMap;
        mapRef.current = map;

        // First full draw: start the poster crossfade, and only then release
        // the idle spin (after the blend) so the poster and live globe stay
        // aligned while both are visible.
        let revealed = false;
        let onRevealed: (() => void) | null = null;
        map.on("load", () => {
          if (cancelled) return;
          setMapPainted(true);
          window.setTimeout(() => {
            revealed = true;
            onRevealed?.();
            onRevealed = null;
          }, 750);
        });
        function spinWhenRevealed() {
          if (revealed) startSpin();
          else onRevealed = startSpin;
        }

        // Separate popup for stop labels so it can't fight the pin popup.
        const stopPopup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 10,
          maxWidth: "260px",
        });
        let stopHoverWired = false;

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

        // ── Result-pin pulse ─────────────────────────────────────────────────
        // Plotted results share their gold with the ambient yacht dots, so they
        // announce themselves with motion instead: a sonar ring that expands and
        // fades each cycle, over a glow that gently breathes. Honors
        // prefers-reduced-motion (static glow only) and pauses in hidden tabs.
        const PULSE_MS = 2200;
        function stopPulse() {
          pulsing = false;
          cancelAnimationFrame(pulseRAF);
        }
        function pulseStep(now: number) {
          if (!pulsing) return;
          pulseRAF = requestAnimationFrame(pulseStep);
          if (document.hidden || !map.getLayer("featured-pulse")) return;
          const t = (now % PULSE_MS) / PULSE_MS; // 0→1 each cycle
          const ease = 1 - (1 - t) * (1 - t); // ring races out, then coasts
          try {
            map.setPaintProperty("featured-pulse", "circle-radius", 7 + ease * 22);
            map.setPaintProperty("featured-pulse", "circle-stroke-opacity", (1 - t) * 0.6);
            // The glow breathes on its own slower rhythm.
            const breathe = 0.5 + 0.5 * Math.sin((now / PULSE_MS) * Math.PI); // 0→1→0
            map.setPaintProperty("featured-glow", "circle-radius", 11 + breathe * 5);
            map.setPaintProperty("featured-glow", "circle-opacity", 0.2 + breathe * 0.18);
          } catch { /* mid-restyle: layers momentarily gone */ }
        }
        function startPulse() {
          if (pulsing) return;
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
          pulsing = true;
          pulseRAF = requestAnimationFrame(pulseStep);
        }

        // ── Layer painting (re-run on every style.load so basemap switches keep
        //    their layers) ───────────────────────────────────────────────────
        function paintHotel() {
          if (!showsHotel || !hotelFC || !hotelFC.features.length) return;
          if (!map.getSource(HOTEL_DENSITY_SOURCE)) {
            map.addSource(HOTEL_DENSITY_SOURCE, { type: "geojson", data: hotelFC });
          }
          const heatOpacity = ["interpolate", ["linear"], ["zoom"], 0, 0.36, 3.4, 0.18, 4.3, 0];
          const dotOpacity = subsetActive
            ? 0.12
            : ["interpolate", ["linear"], ["zoom"], 2.45, 0.18, 3.2, 0.62, 7, 0.92];
          // The pins arrive after the globe is already on screen (they no
          // longer gate first paint), so the very first paint breathes them in
          // instead of popping. Basemap-switch repaints stay instant.
          const fadeIn = !hotelRevealed && !map.getLayer("hotel-dots");
          addLayer(map, {
            id: "hotel-heat", type: "heatmap", source: HOTEL_DENSITY_SOURCE, maxzoom: 4.35,
            paint: {
              "heatmap-weight": 1,
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.65, 3, 1.1],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 12, 3, 24],
              "heatmap-opacity": fadeIn ? 0 : heatOpacity,
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
              "circle-opacity": fadeIn ? 0 : dotOpacity,
              "circle-stroke-opacity": fadeIn ? 0 : 1,
              "circle-stroke-color": "rgba(26,20,7,.88)",
              "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2.45, 0.45, 7, 1.1],
              "circle-blur": 0,
            },
          });
          if (fadeIn) {
            hotelRevealed = true;
            requestAnimationFrame(() => {
              if (cancelled) return;
              try {
                map.setPaintProperty("hotel-heat", "heatmap-opacity-transition", { duration: 900 });
                map.setPaintProperty("hotel-dots", "circle-opacity-transition", { duration: 900 });
                map.setPaintProperty("hotel-dots", "circle-stroke-opacity-transition", { duration: 900 });
                map.setPaintProperty("hotel-heat", "heatmap-opacity", heatOpacity);
                map.setPaintProperty("hotel-dots", "circle-opacity", dotOpacity);
                map.setPaintProperty("hotel-dots", "circle-stroke-opacity", 1);
              } catch { /* mid-restyle: layers momentarily gone */ }
            });
          }
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
          // Sonar ring under the glow — stroke only, animated by pulseStep.
          addLayer(map, {
            id: "featured-pulse", type: "circle", source: "featured",
            paint: {
              "circle-radius": 7, "circle-color": "rgba(0,0,0,0)",
              "circle-stroke-color": "#f4e3ae", "circle-stroke-width": 1.6, "circle-stroke-opacity": 0.6,
            },
          });
          addLayer(map, {
            id: "featured-glow", type: "circle", source: "featured",
            paint: { "circle-radius": 12, "circle-color": "#e2c87a", "circle-opacity": 0.24, "circle-blur": 0.7 },
          });
          addLayer(map, {
            id: "featured-dot", type: "circle", source: "featured",
            paint: { "circle-radius": 5.5, "circle-color": "#e2c87a", "circle-stroke-color": "#5f4c1d", "circle-stroke-width": 0.8 },
          });
          startPulse();
        }

        function paintAll() {
          paintHotel();
          overlayKeys.forEach(paintOverlay);
          paintFeatured();
          if (ROUTES_ENABLED && ambientRoutes && routesFetched) overlayKeys.forEach(paintRoutesForKey);
          // A traced route is a deliberate selection — repaint it after a
          // restyle rather than making the traveller hover again.
          if (lastFocusLegs.current.length) {
            focusRouteRef.current?.paint(lastFocusLegs.current, lastFocusStops.current);
          }
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
            paint: {
              "line-color": cfg.color,
              // Rail and jet journeys are SHORT — Scotland, Switzerland, the
              // Rockies — so at world zoom a whole itinerary is a few pixels
              // long. Thicken and solidify the line as you zoom out so the
              // routes still read as routes; above ROUTE_ZOOM these land back
              // on the original 1.6 / 0.82, so the home globe is unchanged.
              "line-width": ["interpolate", ["linear"], ["zoom"], 0, 2.4, ROUTE_ZOOM, 1.6],
              "line-dasharray": [1, 5],
              "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.95, ROUTE_ZOOM, 0.82],
            },
          });
          // Visibility: only above the route gate and when the type is not hidden
          const vis = map.getZoom() >= routeGate && !hiddenRef.current.has(key) ? "visible" : "none";
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
            const f = e.features?.[0];
            if (!f) return;
            // Hotel dots are DRAWN from zoom 2.45 but were only CLICKABLE from
            // 4 — a 1.55-zoom dead band where a pin looks interactive, the
            // cursor never changes, and a tap silently does nothing. The gate
            // is sound (dots overlap down here, so a tap can't mean one hotel);
            // the no-op was not. Drill in toward what was tapped instead.
            if (map.getZoom() < HOTEL_CLICK_MIN_ZOOM) {
              map.flyTo({
                center: [e.lngLat.lng, e.lngLat.lat],
                zoom: HOTEL_CLICK_MIN_ZOOM + 0.6,
                duration: 900,
                essential: true,
              });
              return;
            }
            const id = f.properties.id || "";
            const name = f.properties.name || "VIP Hotel";
            const reg = f.properties.region;

            /*
             * Resolve the property HERE rather than navigating.
             *
             * Browsing a hotel used to cost three hops: Guide globe → the hotel
             * atlas → "See it in 3D". The first hop was pure loss — this globe
             * and /atlas/hotel are the SAME component (AtlasShell) with a
             * different `scope`, so it was one map reloading itself with a
             * filter applied, just to show a property it was already holding.
             *
             * So the pin now marks and frames in place, and the popup offers
             * the two things that actually differ from where you already are:
             * the photoreal view (a different engine — Mapbox has no equivalent)
             * and the filtered browse surface (a different task). Neither is on
             * the way to the other any more.
             */
            const at = f.geometry?.coordinates;
            if (isFinitePair(at)) {
              const pt = fromLngLatPair(at);
              // FocusStop carries a plain pair; the branded value did its job at
              // the parse boundary above (fromLngLatPair), which is the only
              // place order can be got wrong.
              markFocusPlace([{ name, at: [pt[0], pt[1]] }]);
              map.flyTo({ center: pt, zoom: Math.max(map.getZoom(), 12), duration: 1100, essential: true });
            }

            const browse = id ? `/atlas/hotel?ids=${encodeURIComponent(id)}` : "/atlas/hotel";
            const three = id ? `/maps/hotel/index.html?hotel=${encodeURIComponent(id)}` : null;
            const html =
              `<div class="iw"><div class="iwn">${escapeHtml(name)}</div>` +
              (reg ? `<div class="iwm">${escapeHtml(reg)}</div>` : "") +
              (three
                ? `<a class="iw3d" data-hotel3d="${escapeHtml(id)}" href="${escapeHtml(three)}" target="_blank" rel="noopener">See it in 3D ↗</a>`
                : "") +
              `<a href="${escapeHtml(browse)}">Browse VIP hotels →</a></div>`;
            popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
          });
          map.on("mouseenter", "hotel-dots", () => {
            map.getCanvas().style.cursor =
              map.getZoom() >= HOTEL_CLICK_MIN_ZOOM ? "pointer" : "zoom-in";
          });
          map.on("mouseleave", "hotel-dots", () => { map.getCanvas().style.cursor = ""; });

          for (const key of overlayKeys) {
            const cfg = OVERLAYS[key];
            const src = "t_" + key;
            map.on("click", src + "_dot", (e: MBEvent) => {
              const f = e.features?.[0];
              if (!f) return;
              // Collection pages filter in place — no popup, no navigation.
              const select = onRegionSelectRef.current;
              if (select && f.properties.key) { select(f.properties.key); return; }
              const count = Number(f.properties.count) || undefined;
              const href = internalAtlasLink(
                key,
                f.properties.key ? `?region=${encodeURIComponent(f.properties.key)}` : "",
              );
              const html =
                `<div class="iw"><div class="iwn">${escapeHtml(f.properties.name)}</div>` +
                `<div class="iwm">${escapeHtml(overlayMeta(key, count))}</div>` +
                `<a href="${escapeHtml(href)}">Open the ${escapeHtml(cfg.label.toLowerCase())} atlas →</a></div>`;
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

          /* ── Focused route ────────────────────────────────────────────────
           One trip's route, traced on hover or click — the interaction the
           Leaflet atlases had and the reason "I don't see routes" is the right
           complaint about an ambient all-routes layer. Rail legs get the
           original's railway symbology (dark casing, copper rail, sleeper
           hatching); ferry/transfer legs get an honest dashed connector rather
           than pretending to be track. */
        /**
         * Route colours depend on the basemap.
         *
         * The Leaflet atlas only ever ran over a dark tile layer, so its copper
         * (#e08d5f) had plenty of contrast. The globe opens on SATELLITE —
         * bright tan desert, green forest — where that same copper disappears.
         * Satellite therefore gets a hotter line and a heavier dark casing to
         * carry it; the dark styles keep the original values exactly.
         */
        /** Mix a hex colour toward white. Keeps the brand hue, adds contrast. */
        function lighten(hex: string, amount: number): string {
          const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
          if (!m) return hex;
          const n = parseInt(m[1], 16);
          const mix = (c: number) => Math.round(c + (255 - c) * amount);
          const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
          return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
        }

        function routePalette() {
          const satellite = styleKeyLocal === "satellite";
          // The line takes the COLLECTION's accent — platinum for jets, copper
          // for rail, gold for yachts — matching each original atlas's --accent.
          // Painting every collection copper made a jet route look like a
          // railway.
          //
          // SATELLITE needs more than the same colour turned up. Photoreal
          // terrain is bright and busy: copper lands on tan desert and platinum
          // lands on cloud, so both vanish. Two things fix it together —
          // lighten the line toward white so it keeps its hue but gains
          // luminance, and lay it over a near-black casing wide enough to cut
          // it out of the terrain. The casing is doing most of the work; the
          // line alone can't win against a photograph.
          /*
           * Contrast on satellite is TWO problems, not one, and lightening the
           * line only solves one of them. Measured against the two backdrops:
           *
           *   gold #caa44e   vs dark ocean 6.9:1   vs sunlit terrain 1.7:1
           *   lightened 0.5  vs dark ocean 11:1    vs sunlit terrain 2.7:1
           *
           * Over OCEAN the line is already high-contrast and a heavy dark
           * casing just eats into it. Over TERRAIN no amount of lightening
           * helps — light-on-light tops out under 3:1 — and the dark halo is
           * the only thing that works. So: a genuinely bright, wide line
           * (carries the ocean) with a modest dark halo (carries the land),
           * rather than a thin line inside a heavy black cord.
           */
          const lineW = satellite ? 5.2 : 3.4;
          // The line keeps its TRUE brand colour on both basemaps — teal is
          // teal, platinum is platinum. Satellite only differs in needing a
          // dark halo, because photoreal terrain is busy where a flat dark
          // basemap is not.
          return satellite
            ? {
                casing: "#05060a", casingW: lineW + 3, casingO: 0.8,
                line: accentLocal, lineW,
                glowO: 0, tie: "#141922",
                conn: accentLocal, connO: 0.95,
              }
            : {
                casing: "#0b0d12", casingW: lineW + 3.6, casingO: 0.5,
                line: accentLocal, lineW,
                glowO: 0.5, tie: "#141922",
                conn: accentLocal, connO: 0.7,
              };
        }

        function paintFocusRoute(
          legs: { mode: string; coordinates: [number, number][] }[],
          stops?: FocusStop[],
        ) {
          // Tracing a route is a deliberate act of attention — the idle spin
          // has to yield to it, or the camera drifts off the thing you just
          // asked to see (and fitBounds fights the rotation).
          stopSpin();
          const data = {
            type: "FeatureCollection" as const,
            features: legs
              .filter((l) => l.coordinates.length >= 2)
              .map((l) => ({
                type: "Feature" as const,
                geometry: { type: "LineString" as const, coordinates: l.coordinates },
                // rail  → railway symbology (casing + glow + rail + sleepers)
                // primary→ the collection's own route line (jets, sea legs)
                // conn   → a ferry/road hop inside another journey: faint dashes
                properties: {
                  rail: l.mode === "rail" ? 1 : 0,
                  primary: l.mode === "primary" ? 1 : 0,
                  conn: l.mode !== "rail" && l.mode !== "primary" ? 1 : 0,
                },
              })),
          };
          // Remember it so a basemap switch can repaint — setStyle wipes every
          // source and layer, and a traced route should survive that.
          lastFocusLegs.current = legs;
          if (stops) lastFocusStops.current = stops;
          const p = routePalette();

          if (!map.getSource("focus-route")) map.addSource("focus-route", { type: "geojson", data });
          else map.getSource("focus-route")?.setData(data);

          // Casing sits under both the railway and the primary line.
          addLayer(map, {
            id: "fr_casing", type: "line", source: "focus-route",
            filter: ["any", ["==", ["get", "rail"], 1], ["==", ["get", "primary"], 1]],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": p.casing, "line-width": p.casingW, "line-opacity": p.casingO },
          });
          addLayer(map, {
            id: "fr_rail", type: "line", source: "focus-route",
            filter: ["any", ["==", ["get", "rail"], 1], ["==", ["get", "primary"], 1]],
            layout: { "line-join": "round", "line-cap": "butt" },
            paint: { "line-color": p.line, "line-width": p.lineW, "line-opacity": 0.98 },
          });
          addLayer(map, {
            id: "fr_ties", type: "line", source: "focus-route",
            filter: ["==", ["get", "rail"], 1],
            layout: { "line-join": "round", "line-cap": "butt" },
            paint: { "line-color": p.tie, "line-width": p.lineW, "line-opacity": 0.92, "line-dasharray": [2.5, 7] },
          });
          addLayer(map, {
            id: "fr_conn", type: "line", source: "focus-route",
            filter: ["==", ["get", "conn"], 1],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": p.conn, "line-width": 2, "line-opacity": p.connO, "line-dasharray": [2, 9] },
          });
          // Existing layers keep their old palette after a style switch unless
          // told otherwise — addLayer() is a no-op when the id already exists.
          try {
            map.setPaintProperty("fr_casing", "line-color", p.casing);
            map.setPaintProperty("fr_casing", "line-width", p.casingW);
            map.setPaintProperty("fr_rail", "line-width", p.lineW);
            map.setPaintProperty("fr_casing", "line-opacity", p.casingO);
            map.setPaintProperty("fr_rail", "line-color", p.line);
            map.setPaintProperty("fr_ties", "line-color", p.tie);
            map.setPaintProperty("fr_conn", "line-color", p.conn);
            map.setPaintProperty("fr_conn", "line-opacity", p.connO);
          } catch { /* layer missing mid-restyle */ }

          paintFocusStops(stops ?? lastFocusStops.current, p);
        }

        /**
         * Numbered stop dots with a hover label — the Leaflet atlas's
         * `.stopdot` + tooltip ("3. Day 4 · Inverness"). A traced route without
         * its stops is a shape with no legend: you can see the line but not
         * where it calls.
         */
        function paintFocusStops(stops: FocusStop[], p: ReturnType<typeof routePalette>) {
          const data = {
            type: "FeatureCollection" as const,
            features: stops.map((st, i) => ({
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: st.at },
              properties: {
                // A lone stop is a PLACE (a hotel), not stop 1 of an itinerary.
                // Numbering it reads as the start of a route that isn't there.
                n: stops.length > 1 ? String(i + 1) : "",
                label: stops.length === 1
                  ? st.name
                  : st.day ? `${i + 1}. Day ${st.day} · ${st.name}` : `${i + 1}. ${st.name}`,
                // Single selections carry their name on the map permanently —
                // the whole point of clicking is to find out WHICH pin it is,
                // and a hover-only label can't answer that on a touch screen.
                solo: stops.length === 1 ? 1 : 0,
              },
            })),
          };
          if (!map.getSource("focus-stops")) map.addSource("focus-stops", { type: "geojson", data });
          else map.getSource("focus-stops")?.setData(data);

          addLayer(map, {
            id: "fs_dot", type: "circle", source: "focus-stops",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 5, 8, 10],
              "circle-stroke-opacity": 0.95,
              "circle-color": p.line,
              "circle-stroke-color": p.casing,
              "circle-stroke-width": 1.5,
              "circle-opacity": 0.98,
            },
          });
          addLayer(map, {
            id: "fs_num", type: "symbol", source: "focus-stops",
            minzoom: 4,
            layout: {
              "text-field": ["get", "n"],
              "text-size": 10,
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: { "text-color": p.casing, "text-halo-color": p.line, "text-halo-width": 0.6 },
          });
          addLayer(map, {
            id: "fs_label", type: "symbol", source: "focus-stops",
            filter: ["==", ["get", "solo"], 1],
            layout: {
              "text-field": ["get", "label"],
              "text-size": 12,
              "text-offset": [0, 1.1],
              "text-anchor": "top",
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: {
              "text-color": "#f3ead2",
              "text-halo-color": "#0b0e14",
              "text-halo-width": 1.4,
            },
          });
          try {
            map.setPaintProperty("fs_dot", "circle-color", p.line);
            map.setPaintProperty("fs_dot", "circle-stroke-color", p.casing);
            map.setPaintProperty("fs_num", "text-color", p.casing);
            map.setPaintProperty("fs_num", "text-halo-color", p.line);
          } catch { /* layer missing mid-restyle */ }

          if (!stopHoverWired) {
            stopHoverWired = true;
            map.on("mouseenter", "fs_dot", (e: MBEvent) => {
              map.getCanvas().style.cursor = "pointer";
              const f = e.features?.[0];
              if (!f) return;
              stopPopup.setLngLat(e.lngLat).setHTML(
                `<div class="iw"><div class="iwn">${escapeHtml(f.properties.label || "")}</div></div>`,
              ).addTo(map);
            });
            map.on("mouseleave", "fs_dot", () => {
              map.getCanvas().style.cursor = "";
              stopPopup.remove();
            });
          }
        }

        function clearFocusRoute() {
          lastFocusLegs.current = [];
          lastFocusStops.current = [];
          const empty = { type: "FeatureCollection" as const, features: [] };
          if (map.getSource("focus-route")) map.getSource("focus-route")?.setData(empty);
          if (map.getSource("focus-stops")) map.getSource("focus-stops")?.setData(empty);
          stopPopup.remove();
        }

        /**
         * A route that wraps most of the planet cannot be seen on a globe —
         * half of it is always on the far side. Flatten to mercator for those,
         * and only those: a Mediterranean voyage still gets the globe.
         *
         * Measured from the geometry rather than a data flag, because the
         * voyages adapter sets `world: false` for every sailing (only journeys
         * carry the flag), so a world cruise would otherwise be missed.
         */
        function flattenIfCircumnavigation(legs: { coordinates: [number, number][] }[]) {
          let lo = Infinity, hi = -Infinity;
          for (const l of legs) for (const c of l.coordinates) {
            if (c[0] < lo) lo = c[0];
            if (c[0] > hi) hi = c[0];
          }
          if (!(hi - lo > 180) || !projGlobe) return;
          projGlobe = false;
          setIs3D(false);
          try { map.setProjection("mercator"); } catch { /* projection optional */ }
        }

        /**
         * Frame a single place: stop the spin, drop its marker, fly to it.
         *
         * Hotels have no route, and the route path is what used to carry
         * stopSpin(). Without this, clicking a hotel card queued a fitBounds
         * against a still-rotating globe — which is why the map appeared to
         * ignore the click until you grabbed it.
         */
        function markFocusPlace(stops: FocusStop[]) {
          stopSpin();
          lastFocusStops.current = stops;
          paintFocusStops(stops, routePalette());
        }

        function fitFocusRoute(legs: { coordinates: [number, number][] }[]) {
          // Any deliberate camera move outranks the idle spin.
          stopSpin();
          flattenIfCircumnavigation(legs);
          try {
            const b = new (mapboxgl as MapboxModule).LngLatBounds();
            let n = 0;
            let only: [number, number] | null = null;
            for (const l of legs) for (const c of l.coordinates) { b.extend(c); only = c; n++; }
            // One point has no bounds. fitBounds on a degenerate box just lands
            // at maxZoom over open country, which for a hotel is the wrong
            // answer — you asked which building, so fly to the building.
            if (n === 1 && only) {
              map.flyTo({ center: only, zoom: 14, duration: 1200, essential: true });
            } else if (n) {
              map.fitBounds(b, { padding: fitPad(), maxZoom: 9, duration: 900 });
            }
          } catch { /* fit optional */ }
        }

        focusRouteRef.current = {
          paint: paintFocusRoute, clear: clearFocusRoute, fit: fitFocusRoute, mark: markFocusPlace,
        };

        // Progressive zoom: load route lines on first crossing above ROUTE_ZOOM,
          // then toggle their visibility on subsequent zoom changes.
          map.on("zoomend", () => {
            const z = map.getZoom();
            if (ROUTES_ENABLED && ambientRoutes && z >= routeGate && !routesFetched) {
              loadRoutes();
            } else if (routesFetched) {
              overlayKeys.forEach((key) => {
                const vis = z >= routeGate && !hiddenRef.current.has(key) ? "visible" : "none";
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
            geometry: { type: "Point"; coordinates: LngLat };
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
            const fallbackCenter: LngLat | null = cc ? cc.at : null;
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
          // Remember this framing so a re-mount (Back from a full atlas) can
          // replay it instead of resetting to the idle globe.
          try { sessionStorage.setItem(PLOT_STORAGE_KEY, JSON.stringify(meta)); } catch { /* storage optional */ }
          stopSpin();
          const leadDeep = tools.find((t) => t.deepLink)?.deepLink || meta.deepLink || undefined;
          // Only offer the link when it resolves to a real in-app atlas route
          // (or an absolute external atlas). A bare /maps/<type> path is a
          // static asset directory, not a page — linking it was a dead click.
          const internal = toInternalAtlasHref(leadDeep);
          const external = leadDeep && /^https?:\/\//i.test(leadDeep) ? leadDeep : undefined;
          setBadge({ n: features.length, total, deepLink: internal ?? external });
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
            map.fitBounds(b, { padding: fitPad(), maxZoom: showsHotel ? 10 : 4.8, duration: 900 });
          } catch { /* fit optional */ }
        }
        // The home canvas is full-bleed with Guide chrome overlaying it — the
        // bottom sheet / card dock on phones, the floating panel on the left
        // everywhere else — so frame plotted results into the strip of map that
        // stays visible. Full atlas pages have no overlay; keep the even fit.
        function fitPad(): number | { top: number; bottom: number; left: number; right: number } {
          if (!allInventory) return 78;
          if (window.matchMedia("(max-width: 640px)").matches) {
            const h = node.clientHeight;
            const sheetUp = !!document.querySelector(".home--sheet-half, .home--sheet-full");
            const bottom = sheetUp
              ? Math.round(h * 0.62) // half sheet: fit into the top ~38%
              : Math.min(260, Math.round(h * 0.42)); // pill: clear the card strip
            return { top: 56, left: 34, right: 34, bottom };
          }
          const left = panelOverlayWidth();
          if (!left) return 78;
          return { top: 70, left: left + 60, right: 60, bottom: 60 };
        }
        // Width of the floating Guide panel overlaying the home canvas's left
        // edge (0 when closed / on phones / on atlas pages), clamped so padding
        // can never exceed the canvas.
        function panelOverlayWidth(): number {
          const panel = document.querySelector(".home:not(.home--panel-closed) .home-chat");
          if (!panel) return 0;
          return Math.min(Math.round(panel.getBoundingClientRect().width), Math.round(node.clientWidth * 0.55));
        }
        // Keep the *ambient* camera (idle globe, region focus) centered in the
        // visible map rather than under the panel. Persistent map padding; every
        // explicit fit passes its own fitPad() which supersedes it for that move.
        function ambientPadding() {
          if (!allInventory) return;
          const mobile = window.matchMedia("(max-width: 640px)").matches;
          try {
            map.setPadding({ top: 0, bottom: 0, right: 0, left: mobile ? 0 : panelOverlayWidth() });
          } catch { /* padding optional */ }
        }

        // Mapbox emits benign "error" events all session — log, never tear down.
        map.on("error", (e: MBEvent) => {
          const msg = (e as { error?: { message?: string } })?.error?.message;
          if (msg) console.warn("[atlas] map error", msg);
        });

        // Fallback to the elegant handoff panel if the globe never loads. This
        // is now the LAST resort — the style watchdog below gets first refusal,
        // and only a total Mapbox failure should reach this.
        loadTimeout = window.setTimeout(() => {
          if (!ready && !cancelled) setMapFailed(true);
        }, 12000);
        ["mousedown", "touchstart", "wheel", "dragstart"].forEach((ev) => map.on(ev, stopSpin));

        // Publish the view so the page can build a Share link from it.
        const reportView = () => {
          try {
            const c = map.getCenter();
            onViewChangeRef.current?.({
              style: styleKeyLocal, globe: projGlobe, center: { lng: c.lng, lat: c.lat }, zoom: map.getZoom(),
            });
          } catch { /* view reporting is never load-bearing */ }
        };
        map.on("moveend", reportView);
        map.on("zoomend", reportView);

        ro = new ResizeObserver(() => {
          try {
            map.resize();
            if (ready && !focused && !subsetActive && projGlobe && map.getZoom() <= homeZoom + 0.4) fitGlobe();
          } catch { /* observer noise */ }
        });
        ro.observe(node);

        // Watch the style we just asked for. Armed at construction and on every
        // setStyle; disarmed by style.load. See STYLE_FALLBACK_KEY above.
        function armStyleWatchdog() {
          window.clearTimeout(styleWatchdog);
          if (styleKeyLocal === STYLE_FALLBACK_KEY) return; // nothing left to fall back to
          const attempted = styleKeyLocal;
          styleWatchdog = window.setTimeout(() => {
            if (cancelled || styleKeyLocal !== attempted) return;
            console.warn(
              `[atlas] basemap "${attempted}" did not finish loading in ${STYLE_FALLBACK_MS}ms — falling back to "${STYLE_FALLBACK_KEY}"`,
            );
            mapStyleFallback(attempted, STYLE_FALLBACK_KEY);
            failedStyles.add(attempted);
            styleKeyLocal = STYLE_FALLBACK_KEY;
            setStyleKey(STYLE_FALLBACK_KEY);
            // restyling stays as-is: if this fired mid-switch the pending
            // style.load never came, so the flag is already true and the
            // fallback's own style.load will clear it.
            try { map.setStyle(ATLAS_STYLES[STYLE_FALLBACK_KEY].url); } catch { restyling = false; }
          }, STYLE_FALLBACK_MS);
        }
        armStyleWatchdog();

        // style.load fires on the first load AND after every setStyle — the one
        // place we (re)apply fog, projection and all data layers.
        map.on("style.load", () => {
          if (cancelled) return;
          window.clearTimeout(styleWatchdog);
          const s = ATLAS_STYLES[styleKeyLocal] || ATLAS_STYLES.satellite;
          setFog(map, s.fog);
          // Some Standard-family styles carry a light preset / theme override;
          // styles without them keep Mapbox's day default. Classic styles (Dark)
          // ignore these config calls.
          {
            const cfg = map as unknown as { setConfigProperty(s: string, k: string, v: string | boolean): void };
            if (s.light) { try { cfg.setConfigProperty("basemap", "lightPreset", s.light); } catch { /* not a Standard style */ } }
            if (s.theme) { try { cfg.setConfigProperty("basemap", "theme", s.theme); } catch { /* theme unsupported */ } }
            // Per-basemap 3D objects: off for Satellite (globe-zoom models are
            // pure waste), on for Dusk's intentional city buildings.
            try { cfg.setConfigProperty("basemap", "show3dObjects", s.objects3d !== false); } catch { /* not a Standard style */ }
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

        // First-load boot: the globe fits (and readies its spin) immediately —
        // the feeds were kicked off at mount and each paints the moment it
        // lands, so nothing network-bound holds the camera hostage.
        async function bootData() {
          ambientPadding(); // camera lives right of the floating Guide panel
          // Restore the last framed subset on the home Living Atlas after a
          // re-mount (Back from a full atlas), so it re-opens on the results the
          // persisted chat still shows rather than the resting globe. A ?region=
          // deep link still wins — that's an explicit destination request.
          const restored = !region && allInventory ? readStoredPlot() : null;
          if (!region && !restored) {
            fitGlobe();
            spinWhenRevealed();
          }

          // A shared link's exact camera wins over any default framing.
          if (initialCamera) {
            focused = true;
            try {
              map.flyTo({
                center: [initialCamera.lng, initialCamera.lat],
                zoom: initialCamera.zoom,
                speed: 1.4,
              });
              stopSpin();
            } catch { /* camera optional */ }
          }

          // A collection page never crosses ROUTE_ZOOM on its own, so nothing
          // would trigger the lazy load — start it here instead.
          if (ROUTES_ENABLED && ambientRoutes && routesAlways && !routesFetched) loadRoutes();

          // Hotel field: fades in on arrival, off the critical path.
          hotelPromise.then((fc) => {
            if (cancelled || !fc) return;
            hotelFC = fc;
            paintHotel();
            setLoaded((l) => new Set(l).add("hotel"));
          });

          // Overlay pins: all feeds in parallel, each painting on arrival.
          overlayKeys.forEach(async (key) => {
            try {
              const feats = await fetchOverlay(key);
              if (cancelled) return;
              overlayFeats[key] = feats;
              paintOverlay(key);
              setLoaded((l) => new Set(l).add(key));
            } catch { /* one atlas down should not break the rest */ }
          });

          // Region geometry resolves the ?region= deep link / stored-plot
          // anchors; only those camera moves wait for it.
          regionsGeo = await regionsPromise;
          if (cancelled) return;
          const focus = region ? regionCenter(region, regionsGeo, regionLookupKey) : null;
          if (focus) {
            focused = true;
            map.flyTo({ center: focus.at, zoom: focus.zoom, speed: 0.8 });
          } else if (restored) {
            plotResults(restored);
          } else if (region) {
            // ?region= that never resolved: replay a stored subset if the home
            // canvas has one (the pre-restructure behavior), else rest + spin.
            const restoredLate = allInventory ? readStoredPlot() : null;
            if (restoredLate) plotResults(restoredLate);
            else {
              fitGlobe();
              spinWhenRevealed();
            }
          }
        }

        // Imperative API the control buttons drive.
        const api: AtlasApi = {
          setStyle(key) {
            // Already known bad this session — don't spend another 4s finding
            // out. plotResults asks for Satellite on every plot.
            if (failedStyles.has(key)) key = STYLE_FALLBACK_KEY;
            if (key === styleKeyLocal) return;
            styleKeyLocal = key;
            setStyleKey(key);
            restyling = true;
            try { map.setStyle(ATLAS_STYLES[key].url); } catch { restyling = false; }
            // A manual switch into a broken family must degrade too, not hang.
            armStyleWatchdog();
            reportView();
          },
          setProjection(globe) {
            projGlobe = globe;
            setIs3D(globe);
            reportView();
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
          refit() {
            ambientPadding(); // panel opened/closed/resized — recenter ambient camera
            if (subsetActive) fitFeatured();
          },
          resetView() {
            subsetActive = false;
            featuredFC = null;
            try { sessionStorage.removeItem(PLOT_STORAGE_KEY); } catch { /* storage optional */ }
            setBadge(null);
            stopPulse();
            if (map.getSource("featured")) {
              ["featured-pulse", "featured-glow", "featured-dot"].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
              try { (map as MBMap).removeSource("featured"); } catch { /* noop */ }
            }
            paintHotel(); // restore full ambient opacity
            ambientPadding();
            if (projGlobe) { focused = false; fitGlobe(); startSpin(); }
          },
        };
        apiRef.current = api;
      })
      .catch(() => setMapFailed(true));

    return () => {
      cancelled = true;
      cancelAnimationFrame(spinRAF);
      cancelAnimationFrame(pulseRAF);
      clearTimeout(loadTimeout);
      clearTimeout(styleWatchdog);
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
    // NO scope guard. This effect used to begin `if (!allInventory) return;`
    // because plotting was a home-canvas feature and nothing else dispatched
    // to it. Collection pages (Deliverable 3) now drive the same globe through
    // exactly these events — plotting their filtered subset and tracing one
    // trip's route on hover — so a scope guard here silently disabled both, and
    // the symptom was a page where hovering a card did nothing at all.
    //
    // Safe to widen: the events are only dispatched by The Guide (home) and by
    // AtlasCollection (a collection route), and the two never mount together.
    function onPlot(e: Event) {
      const meta = (e as CustomEvent<GuideMeta>).detail;
      if (meta) apiRef.current?.plot(meta);
    }
    function onReset() {
      apiRef.current?.resetView();
    }
    // The mobile chat sheet changing detent moves the visible strip of map —
    // re-frame any plotted subset into it.
    function onRefit() {
      apiRef.current?.refit();
    }
    // Trace one trip's route. Collection pages dispatch this on card hover and
    // click; an empty `legs` clears the trace.
    const onRoute = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | {
            legs?: { mode: string; coordinates: [number, number][] }[];
            stops?: FocusStop[];
            fit?: boolean;
            /** Frame these when the trip has no drawable route at all. */
            fitPoints?: [number, number][];
          }
        | undefined;
      const api = focusRouteRef.current;
      if (!api) return;
      const legs = detail?.legs ?? [];
      if (!legs.length) {
        api.clear();
        // A collection with no routes (hotels) still has a SELECTION, and the
        // clear above would have thrown it away — leaving 2,500 identical pins
        // and no way to tell which one you just clicked. Re-mark it.
        if (detail?.stops?.length) api.mark(detail.stops);
        // Still move the camera if the caller gave us somewhere to go.
        if (detail?.fit && detail.fitPoints?.length) {
          api.fit([{ coordinates: detail.fitPoints }]);
        }
        return;
      }
      api.paint(legs, detail?.stops);
      if (detail?.fit) api.fit(legs);
    };
    // The popup's "See it in 3D" is injected HTML, so it has no React handler.
    // Delegate once rather than re-wiring on every popup open.
    const on3d = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-hotel3d]");
      const id = el?.getAttribute("data-hotel3d");
      if (id) hotel3dOpened(id, "popup");
    };
    document.addEventListener("click", on3d);
    window.addEventListener("bevvip:atlas-route", onRoute as EventListener);
    window.addEventListener("bevvip:atlas-plot", onPlot as EventListener);
    window.addEventListener("bevvip:atlas-reset", onReset as EventListener);
    window.addEventListener("bevvip:atlas-refit", onRefit);
    return () => {
      document.removeEventListener("click", on3d);
      window.removeEventListener("bevvip:atlas-route", onRoute as EventListener);
      window.removeEventListener("bevvip:atlas-plot", onPlot as EventListener);
      window.removeEventListener("bevvip:atlas-reset", onReset as EventListener);
      window.removeEventListener("bevvip:atlas-refit", onRefit);
    };
    // allInventory is no longer read here, but the effect stays keyed to it so
    // a scope change re-registers cleanly.
  }, [allInventory]);

  // Align the poster with the ambient camera: on the home canvas the map is
  // padded right of the floating Guide panel (ambientPadding), so offset the
  // poster's contained globe by the same panel width. Mount-time measurement is
  // enough — the poster only lives for the first seconds of the session.
  useEffect(() => {
    if (!allInventory || posterGone) return;
    if (window.matchMedia("(max-width: 640px)").matches) return;
    const panel = document.querySelector(".home:not(.home--panel-closed) .home-chat");
    const canvasW = mapEl.current?.clientWidth || 0;
    if (panel && canvasW) {
      setPosterPad(Math.min(Math.round(panel.getBoundingClientRect().width), Math.round(canvasW * 0.55)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allInventory]);

  // Close the style menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc() { setMenuOpen(false); }
    window.addEventListener("click", onDoc);
    return () => window.removeEventListener("click", onDoc);
  }, [menuOpen]);

  // Enter/exit true monitor fullscreen via the Fullscreen API. On browsers that
  // reject it (notably iOS Safari, which only fullscreens <video>), fall back to
  // the CSS `.fs` fill so the button still expands the map within the window.
  function toggleFull() {
    const el = shellRef.current;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => setIsFull((v) => !v));
    } else {
      setIsFull((v) => !v); // CSS fallback
    }
  }

  // Keep `isFull` in sync with native fullscreen (covers Esc / browser exit).
  useEffect(() => {
    function onFsChange() { setIsFull(!!document.fullscreenElement); }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Esc exits the CSS fallback fill (native fullscreen handles its own Esc).
  useEffect(() => {
    if (!isFull || document.fullscreenElement) return;
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
  // Every collection, always — see the note on the legend below. On a
  // single-category atlas route only that category is plotted, so the legend
  // narrows to it; on the home globe it is the full canonical list.
  const legendRows = scope === "all" ? LEGEND : LEGEND.filter((it) => it.key === type);

  return (
    <div ref={shellRef} className={`atlas-map${isFull ? " fs" : ""}`}>
      {token && !mapFailed && <div ref={mapEl} className="atlas-canvas" />}
      {token && !mapFailed && !posterGone && (
        <div
          className={`atlas-poster${mapPainted ? " out" : ""}`}
          style={posterPad ? { paddingLeft: posterPad } : undefined}
          aria-hidden="true"
          onTransitionEnd={() => setPosterGone(true)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/globe-poster.webp"
            alt=""
            fetchPriority="high"
            draggable={false}
            onError={() => setPosterGone(true)}
          />
        </div>
      )}
      {token && !mapFailed && !mapReady && posterGone && (
        <div className="fallback">
          <span className="badge">{region ? `Region · ${region}` : ATLASES[type].label}</span>
          <p>Charting the atlas…</p>
        </div>
      )}

      {!showFallback && (
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

      {/* The legend used to render only the layers whose feed had finished
          loading, so it described a different product on every page load —
          five collections on a slow connection, seven on a fast one. It now
          always lists all of them; the ones still in flight read as loading
          rather than silently not existing. Caption was "Tap to hide", an
          instruction used as a heading that named one direction of a toggle;
          the pressed state carries that meaning now, for screen readers too. */}
      {!showFallback && legendRows.length > 0 && (
        <div className="atlas-legend">
          <div className="lgcap">Collections</div>
          {legendRows.map((it) => {
            const pending = !loaded.has(it.key);
            const off = hidden.has(it.key);
            return (
              <button
                key={it.key}
                type="button"
                className={`lgi${off ? " off" : ""}${pending ? " pending" : ""}`}
                aria-pressed={!off}
                disabled={pending}
                onClick={() => toggleLayer(it.key)}
                title={pending ? "Still loading" : off ? "Show on the map" : "Hide from the map"}
              >
                <i style={{ background: it.color }} />
                <span>{it.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {!showFallback && badge && (
        <div className="atlas-badge">
          {badge.total > badge.n && badge.deepLink ? (
            <>
              Showing {badge.n} of {badge.total} ·{" "}
              <a href={badge.deepLink}>all on the atlas →</a>
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
            Map unavailable right now. The full {ATLASES[type].label.toLowerCase()} is one
            click away — your selection carries over.
          </p>
          <a className="atlas-cta" href={externalLink}>
            Open the {ATLASES[type].label.toLowerCase()} →
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
async function loadRegions(): Promise<Record<string, LngLat>> {
  const geo: Record<string, LngLat> = {};
  try {
    const j = await (await fetch(`${HOTEL_BASE}/api/regions`)).json();
    // lib/atlas/hotels.js emits `center: [circular-mean lng, mean lat]`.
    (j.regions || []).forEach((r: { region: string; center?: [number, number] }) => {
      if (isFinitePair(r.center)) geo[r.region] = fromLngLatPair(r.center);
    });
  } catch { /* regions optional; map still usable */ }
  return geo;
}

interface OverlayFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: LngLat };
  properties: { type: string; key: string; name: string; count: number };
}

async function fetchOverlay(key: OverlayKey): Promise<OverlayFeature[]> {
  const cfg = OVERLAYS[key];
  const json = await (await fetch(cfg.data)).json();
  const regs = regionsFromData(json).sort((a, b) => (b.count || 0) - (a.count || 0));
  const nudge = PIN_NUDGE[key];
  if (nudge) for (const r of regs) { const o = nudge[r.key]; if (o) r.at = o; }
  return regs.map((r) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: r.at },
    properties: { type: key, key: r.key, name: r.name, count: r.count },
  }));
}

interface Reg { key: string; name: string; at: LngLat; count: number }

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
    // Every atlas feed (and the villa overlay view) writes REGIONS.coord as
    // [lat, lng] — the one place that fact is now stated.
    if (!r || !isFinitePair(r.coord)) continue;
    const name = r.name || k;
    if (/^other\b/i.test(k) || /^other\b/i.test(name)) continue; // skip catch-all buckets
    const count = r.count != null ? r.count : tally[k] || 0;
    out.push({ key: k, name, at: fromLatLngPair(r.coord), count });
  }
  return out;
}

function overlayMeta(key: OverlayKey, count?: number): string {
  if (key === "cruise") return `Expedition Cruises${count ? ` · ${count} sailings` : ""}`;
  if (key === "worldcruise") return `World Cruises${count ? ` · ${count} voyages calling here` : ""}`;
  if (key === "jet") return `Private Jet Journeys${count ? ` · ${count} journeys` : ""}`;
  if (key === "train") return `Rail Journeys${count ? ` · ${count} departures` : ""}`;
  if (key === "villa") return `Private Villas${count ? ` · ${count} villas` : ""}`;
  return `Luxury Hotel Yachts${count ? ` · ${count} charters` : ""}`;
}

function regionCenter(
  region: string,
  geo: Record<string, LngLat>,
  lookupKey: (s: string) => string,
): RegionCamera | null {
  if (geo[region]) return { at: geo[region], zoom: 4 };
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
  geo: Record<string, LngLat>,
  fallbackCenter: LngLat | null,
): LngLat | null {
  // Search results carry named lng/lat (hotels, villas via lib/villas.js).
  const named = r as { lng?: number; lat?: number };
  if (Number.isFinite(Number(named.lng)) && Number.isFinite(Number(named.lat))) {
    return fromNamed({ lat: Number(named.lat), lng: Number(named.lng) });
  }
  const key = String(r.region || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const fb = REGION_FALLBACK[key];
  const base: LngLat | undefined =
    geo[r.region || ""] || fb?.at || fallbackCenter || undefined;
  // No coordinates and no region we can place it in: skip the pin rather than
  // dropping it at a meaningless default location.
  if (!base) return null;
  if (total <= 1) return base;
  const ang = (i / total) * Math.PI * 2;
  return offsetLngLat(base, Math.cos(ang) * 1.4, Math.sin(ang) * 1.4);
}

// Translate an atlas deep link into the in-app atlas route (/atlas/<type>?…),
// preserving its query. Returns null when the URL isn't one of our atlas bases
// (so callers can fall back).
//
// Deep links are usually RELATIVE ("/maps/hotel?ids=h_001") because the atlas
// bases default to relative paths; only an external deploy makes them absolute.
// This used to call `new URL(url)` with no base, which throws on every relative
// path — so it returned null for the common case and the badge's "all on the
// atlas" link fell back to the raw /maps/<type> asset path, which the app does
// not serve as a page. Parse against a placeholder base and match on origin
// (external bases) or pathname (relative ones).
const PLACEHOLDER_ORIGIN = "http://internal.atlas";

function parseHref(raw: string): { origin: string | null; pathname: string; search: string } | null {
  try {
    const u = new URL(raw, PLACEHOLDER_ORIGIN);
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    return { origin: absolute ? u.origin : null, pathname: u.pathname, search: u.search };
  } catch {
    return null;
  }
}

const trimSlashes = (s: string) => s.replace(/\/+$/, "") || "/";

function toInternalAtlasHref(url?: string | null): string | null {
  if (!url) return null;
  // Already an in-app atlas route — nothing to translate.
  if (/^\/atlas\//.test(url)) return url;
  const u = parseHref(url);
  if (!u) return null;
  for (const t of Object.keys(ATLASES) as OfferingType[]) {
    const b = parseHref(ATLASES[t].base);
    if (!b) continue;
    const match = b.origin
      ? u.origin === b.origin
      : u.origin === null && trimSlashes(u.pathname) === trimSlashes(b.pathname);
    if (match) return internalAtlasLink(t, u.search);
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
    `<a href="${esc(href)}">Open on the atlas →</a></div>`
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

/** Precomputed sea geometry, one file per collection. Built by
 *  scripts/build-sea-routes.mjs — see SEA_ROUTES_BASE consumers. */
const SEA_ROUTE_KEYS = new Set<OverlayKey>(["cruise", "yacht", "worldcruise"]);

async function fetchRouteLines(key: OverlayKey): Promise<LngLat[][]> {
  try {
    if (key === "villa") return []; // villas are stays, not routes

    if (SEA_ROUTE_KEYS.has(key)) {
      // Precomputed at build time: land-avoiding A* geometry, already unrolled
      // across the antimeridian and simplified. The 765 KB land mask and the
      // per-visitor A* it fed are both gone from the browser.
      const r = await fetch(`/maps/shared/sea-routes-${key}.json`, { cache: "force-cache" });
      if (!r.ok) return [];
      const j: { features?: { geometry?: { coordinates?: [number, number][] } }[] } = await r.json();
      return (j.features || [])
        .map((f) => (f.geometry?.coordinates || []).filter(isFinitePair).map(fromLngLatPair))
        .filter((pts) => pts.length >= 2);
    }

    // TRAIN IS NOT ARCED. Trains follow tracks, and the rail atlas ships the
    // real geometry (public/maps/train/data/rail-routes.json, 269 legs and
    // 23,541 points). Arcing a rail journey draws a bezier over Loch Lomond
    // instead of the West Highland Line. Rail routes are traced per-trip from
    // that file — see lib/atlas/adapters/rail-geometry.ts and the focused-route
    // layer — so this ambient path is jet-only geometry.
    if (key === "train") return [];

    // jet: an aircraft really does fly the arc, and a straight line between two
    // cities reads as a wire rather than a journey. It needs the antimeridian
    // unroll too, which the old code gave it neither of.
    // itinerary.json → ROUTES: { [slug]: [{n, r, ll:[lat,lng]}] }
    const r = await fetch(`${ATLASES[key].base}/itinerary.json`);
    if (!r.ok) return [];
    const j: { ROUTES?: Record<string, { ll?: [number, number] }[]> } = await r.json();
    const ROUTES = j.ROUTES || {};
    return Object.values(ROUTES)
      .map((stops) => {
        const pts = stops.filter((s) => isFinitePair(s.ll)).map((s) => fromLatLngPair(s.ll!));
        if (pts.length < 2) return pts;
        // Unroll first, then arc each leg in that frame — same order the sea
        // router uses, and for the same reason: arcing raw coordinates across
        // the antimeridian sweeps the wrong way round the world.
        const frame = unrollLine(pts);
        const out: LngLat[] = [];
        for (let i = 0; i < frame.length - 1; i++) {
          const seg = arcPts(
            [frame[i][1], frame[i][0]],
            [frame[i + 1][1], frame[i + 1][0]],
          ) as [number, number][];
          for (let k = out.length ? 1 : 0; k < seg.length; k++) {
            out.push(fromLatLngPair(seg[k]));
          }
        }
        return out;
      })
      .filter((pts) => pts.length >= 2);
  } catch {
    return [];
  }
}

// ── Hotel point feed ───────────────────────────────────────────────────────

interface HotelFC {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: { type: "Point"; coordinates: LngLat }; properties: { id: string; region: string | null; name: string } }[];
}
interface FeaturedFC {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: { type: "Point"; coordinates: LngLat }; properties: { name: string; html: string } }[];
}

async function fetchHotelPoints(): Promise<HotelFC> {
  try {
    const r = await fetch(`${HOTEL_BASE}/hotel-points.json`, { cache: "force-cache" });
    if (r.ok) {
      const data = (await r.json()) as {
        type?: string;
        features?: {
          geometry?: { coordinates?: [number, number] };
          properties?: { id?: string; name?: string; region?: string | null; marqueeRegion?: string | null };
        }[];
      };
      if (data && data.type === "FeatureCollection" && Array.isArray(data.features)) {
        const features: HotelFC["features"] = data.features.flatMap((f) => {
          // hotel-points.json is GeoJSON — coordinates are already [lng, lat].
          const c = f.geometry?.coordinates;
          if (!isFinitePair(c)) return [];
          const at = fromLngLatPair(c);
          return [{
            type: "Feature",
            geometry: { type: "Point", coordinates: at },
            properties: {
              id: f.properties?.id || "",
              region: f.properties?.marqueeRegion || f.properties?.region || null,
              name: f.properties?.name || "",
            },
          }];
        });
        if (features.length) return { type: "FeatureCollection", features };
      }
    }
  } catch {
    // Fall back to the paged API below; the point file is a speed path, not a dependency.
  }

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
      // The paged hotel API returns named {lng, lat}, not a pair.
      if (!Number.isFinite(Number(h.lng)) || !Number.isFinite(Number(h.lat))) return;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: fromNamed({ lat: Number(h.lat), lng: Number(h.lng) }) },
        properties: { id: h.id || "", region: h.region || null, name: h.name || "" },
      });
    });
  });
  return { type: "FeatureCollection", features };
}

async function fetchHotelPage(offset: number, limit: number): Promise<{ total?: number; results?: unknown[] }> {
  const r = await fetch(`${HOTEL_BASE}/api/luxury-hotels?limit=${limit}&offset=${offset}&summary=1`, { cache: "force-cache" });
  if (!r.ok) throw new Error("hotel atlas " + r.status);
  return r.json();
}

// ── Mapbox loader + minimal typings ────────────────────────────────────────

function addLayer(map: MBMap, spec: Record<string, unknown>) {
  if (map.getLayer(spec.id as string)) return;
  /*
   * Standard-family styles light OUR layers with the scene lighting model, so
   * under a dusk/night preset they darken. Satellite sets `light: "dusk"`,
   * which is why a route that is exactly right on Dark (a CLASSIC style, no
   * lighting model) renders muted and dark on Satellite. Full emissive
   * strength makes a layer hold its own colour on every basemap; it is a no-op
   * on classic styles.
   *
   * This was already being done for circles. It was never done for LINES, and
   * that — not the hex value — is why every satellite route looked dark. No
   * amount of lightening the colour could have fixed it.
   */
  const kind = spec.type as string;
  const emissive: Record<string, string> = {
    circle: "circle-emissive-strength",
    line: "line-emissive-strength",
    symbol: "text-emissive-strength",
  };
  const prop = emissive[kind];
  if (prop) {
    const paint = (spec.paint ?? {}) as Record<string, unknown>;
    if (paint[prop] == null) paint[prop] = 1;
    spec.paint = paint;
  }
  try { map.addLayer(spec); } catch { /* layer skipped */ }
}

function setFog(map: MBMap, fog: Record<string, unknown>) {
  try { map.setFog(fog); } catch { /* fog optional */ }
}

interface MBEvent {
  lngLat: { lng: number; lat: number };
  features?: {
    properties: Record<string, string>;
    geometry?: { coordinates?: [number, number] };
  }[];
}
interface MBPopup {
  setLngLat(c: { lng: number; lat: number }): MBPopup;
  setHTML(html: string): MBPopup;
  addTo(map: MBMap): MBPopup;
  remove(): void;
}
interface MBBounds {
  // readonly, so a branded LngLat from lib/atlas/geo.ts passes without a cast.
  extend(c: readonly [number, number]): MBBounds;
}
interface MBMap {
  on(type: string, layerOrCb: string | ((e: MBEvent) => void), cb?: (e: MBEvent) => void): void;
  getZoom(): number;
  getMinZoom(): number;
  getCenter(): { lng: number; lat: number };
  setCenter(c: { lng: number; lat: number }): void;
  setZoom(z: number): void;
  flyTo(opts: {
    center: readonly [number, number];
    zoom: number;
    speed?: number;
    duration?: number;
    essential?: boolean;
  }): void;
  fitBounds(b: MBBounds, opts: Record<string, unknown>): void;
  setPadding(p: { top: number; bottom: number; left: number; right: number }): void;
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
  // Match stylesheets only: the root layout preloads this same href
  // (rel="preload" as="style"), which downloads but never APPLIES the CSS —
  // an href-only check sees it and skips the real stylesheet, leaving the map
  // unstyled (attribution in flow, popups shifting layout, broken touch-action).
  if (!document.querySelector(`link[rel="stylesheet"][href="${MAPBOX_CSS}"]`)) {
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

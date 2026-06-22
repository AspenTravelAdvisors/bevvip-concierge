"use client";

// Living Atlas — the populated Mapbox globe. On load it paints the full hotel
// inventory as an ambient gold field, drops colored cruise / jet / yacht /
// world-cruise region pins from each atlas's live feed, fits the globe and
// idle-spins — the same resting state as the standalone deployed atlas
// (public/index.html). A legend toggles each layer; clicking a pin or hotel
// opens the matching Atlas with the selection carried over.
//
// Without a Mapbox token it degrades to an elegant fallback panel with the
// external-atlas handoff, so the app still works with zero configuration.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { OfferingType } from "@/lib/types";
import { ATLASES } from "@/lib/atlas-config";

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
// before /api/regions geometry resolves.
const REGION_FALLBACK: Record<string, [number, number, number]> = {
  antarctica: [0, -72, 2.3], arctic: [8, 79, 2.3], galapagos: [-91, -0.4, 5],
  amazon: [-60, -3.5, 3.8], polynesia: [-149, -17, 3.4], patagonia: [-72, -49, 3.6],
  kimberley: [126, -16, 4.3], mediterranean: [15, 38.5, 3.4], norway: [12, 65, 3.4],
  japan: [138, 37, 3.9], namibia: [17, -22, 4.2], alaska: [-149, 60.5, 4],
  caribbean: [-66, 16, 4], baja: [-111.5, 24, 4.4], britishisles: [-3, 58, 4],
  seychelles: [55.5, -4.6, 5],
};

const LEGEND: { key: string; label: string; color: string }[] = [
  { key: "hotel", label: "VIP Hotels", color: "#c9a84c" },
  { key: "cruise", label: OVERLAYS.cruise.label, color: OVERLAYS.cruise.color },
  { key: "jet", label: OVERLAYS.jet.label, color: OVERLAYS.jet.color },
  { key: "yacht", label: OVERLAYS.yacht.label, color: OVERLAYS.yacht.color },
  { key: "worldcruise", label: OVERLAYS.worldcruise.label, color: OVERLAYS.worldcruise.color },
];

interface Props {
  type: OfferingType;
  region: string | null;
  externalLink: string;
}

export default function AtlasShell({ type, region, externalLink }: Props) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || FALLBACK_TOKEN;
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MBMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!token || !mapEl.current) return;
    let cancelled = false;
    let spinRAF = 0;
    let spinning = false;
    let ready = false;
    let focused = false;
    let homeZoom = 1.25;
    let ro: ResizeObserver | undefined;
    let loadTimeout = 0;
    const node = mapEl.current;

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
          style: "mapbox://styles/mapbox/dark-v11",
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
          let isGlobe = true;
          try { isGlobe = map.getProjection().name === "globe"; } catch { /* default */ }
          if (isGlobe && map.getZoom() <= homeZoom + 0.4 && !document.hidden) {
            const c = map.getCenter();
            map.setCenter({ lng: c.lng - 0.045, lat: c.lat });
          }
          spinRAF = requestAnimationFrame(spinStep);
        }
        function startSpin() {
          if (spinning) return;
          spinning = true;
          spinStep();
        }

        // Mapbox emits benign "error" events (a dropped tile, an optional
        // source) all through a session — those must not tear down the globe,
        // so the handler only logs. Total failures surface via the construction
        // catch and the load-timeout fallback below.
        map.on("error", (e: MBEvent) => {
          const msg = (e as { error?: { message?: string } })?.error?.message;
          if (msg) console.warn("[atlas] map error", msg);
        });

        // If the globe never finishes loading (broken token, no WebGL, a
        // sandbox that can't run Mapbox), fall back to the elegant handoff panel
        // instead of leaving "Charting…" up forever.
        loadTimeout = window.setTimeout(() => {
          if (!ready && !cancelled) setMapFailed(true);
        }, 12000);
        ["mousedown", "touchstart", "wheel", "dragstart"].forEach((ev) =>
          map.on(ev, stopSpin),
        );

        // The map can be constructed before the panel has laid out (0×0), which
        // leaves the canvas at Mapbox's 400×300 default. Resize to the real
        // container as it settles, and keep the whole globe fitted while idle.
        ro = new ResizeObserver(() => {
          try {
            map.resize();
            if (ready && !focused && map.getZoom() <= homeZoom + 0.4) fitGlobe();
          } catch {
            /* observer noise */
          }
        });
        ro.observe(node);

        map.on("load", () => {
          if (cancelled) return;
          ready = true;
          clearTimeout(loadTimeout);
          setFog(map);
          map.resize();
          setMapReady(true);
          loadHotelField(map, popup, escapeHtml);
          loadRegions(map).then((geo) => {
            if (cancelled) return;
            // Honor a ?region= deep link: focus that region instead of spinning.
            const focus = region ? regionCenter(region, geo, regionLookupKey) : null;
            if (focus) {
              focused = true;
              map.flyTo({ center: [focus[0], focus[1]], zoom: focus[2], speed: 0.8 });
            } else {
              fitGlobe();
              startSpin();
            }
          });
          loadOverlays(map, popup, escapeHtml, (key) =>
            setLoaded((s) => new Set(s).add(key)),
          );
          setLoaded((s) => new Set(s).add("hotel"));
        });
      })
      .catch(() => setMapFailed(true));

    return () => {
      cancelled = true;
      cancelAnimationFrame(spinRAF);
      clearTimeout(loadTimeout);
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // region is captured for the initial focus only; deep-link changes re-mount via route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
    <div className="atlas-map">
      {token && !mapFailed && <div ref={mapEl} className="atlas-canvas" />}
      {token && !mapFailed && !mapReady && (
        <div className="fallback">
          <span className="badge">{region ? `Region · ${region}` : "All inventory"}</span>
          <p>Charting the Atlas…</p>
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
      {showFallback && (
        <div className="fallback">
          <span className="badge">{region ? `Region · ${region}` : "All inventory"}</span>
          <p>
            Map unavailable right now. The full {ATLASES[type].label} is one click away —
            your selection carries over.
          </p>
          <a className="atlas-cta" href={externalLink} target="_blank" rel="noreferrer">
            Open {ATLASES[type].label} ↗
          </a>
          <div className="region-chips">
            {ATLASES[type].sampleRegions.map((r) => (
              <Link key={r} className="chip" href={`/atlas/${type}?region=${encodeURIComponent(r)}`}>
                {r}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Layer loaders ──────────────────────────────────────────────────────────

/* Ambient: the full hotel inventory as a heatmap that resolves into clickable
   gold dots as the traveler zooms in. */
async function loadHotelField(map: MBMap, popup: MBPopup, escapeHtml: (s: string) => string) {
  try {
    const fc = await fetchHotelPoints();
    if (!fc.features.length) return;
    map.addSource(HOTEL_DENSITY_SOURCE, { type: "geojson", data: fc });
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
        "circle-color": "#f1d879",
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 2.45, 0.18, 3.2, 0.62, 7, 0.92],
        "circle-stroke-color": "rgba(26,20,7,.88)",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2.45, 0.45, 7, 1.1],
        "circle-blur": 0,
      },
    });
    map.on("click", "hotel-dots", (e: MBEvent) => {
      if (map.getZoom() < HOTEL_CLICK_MIN_ZOOM) return; // ambient zoom: not tappable
      const f = e.features?.[0];
      if (!f) return;
      const id = f.properties.id || "";
      const name = f.properties.name || "VIP Hotel";
      const region = f.properties.region;
      const href = id ? `${HOTEL_BASE}/?ids=${encodeURIComponent(id)}` : HOTEL_BASE;
      const html =
        `<div class="iw"><div class="iwn">${escapeHtml(name)}</div>` +
        (region ? `<div class="iwm">${escapeHtml(region)}</div>` : "") +
        `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">Open VIP Hotels Atlas ↗</a></div>`;
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
    map.on("mouseenter", "hotel-dots", () => {
      if (map.getZoom() >= HOTEL_CLICK_MIN_ZOOM) map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "hotel-dots", () => {
      map.getCanvas().style.cursor = "";
    });
  } catch {
    /* dot field is optional */
  }
}

/* Region geometry (bbox + center), used to focus a ?region= deep link. */
async function loadRegions(map: MBMap): Promise<Record<string, [number, number]>> {
  const geo: Record<string, [number, number]> = {};
  try {
    const j = await (await fetch(`${HOTEL_BASE}/api/regions`)).json();
    (j.regions || []).forEach((r: { region: string; center?: [number, number] }) => {
      if (Array.isArray(r.center) && r.center.length === 2) geo[r.region] = r.center;
    });
  } catch {
    /* regions optional; map still usable */
  }
  return geo;
}

/* Master atlas: cruise / jet / yacht / world-cruise region pins, colored, from
   each live app's data feed. */
async function loadOverlays(
  map: MBMap,
  popup: MBPopup,
  escapeHtml: (s: string) => string,
  onLoaded: (key: string) => void,
) {
  for (const key of Object.keys(OVERLAYS) as OverlayKey[]) {
    try {
      await addOverlay(map, key, popup, escapeHtml);
      onLoaded(key);
    } catch {
      /* one atlas down should not break the rest */
    }
  }
}

async function addOverlay(map: MBMap, key: OverlayKey, popup: MBPopup, escapeHtml: (s: string) => string) {
  const cfg = OVERLAYS[key];
  const json = await (await fetch(cfg.data)).json();
  const regs = regionsFromData(json).sort((a, b) => (b.count || 0) - (a.count || 0));
  const nudge = PIN_NUDGE[key];
  if (nudge) for (const r of regs) { const o = nudge[r.key]; if (o) { r.lng = o[0]; r.lat = o[1]; } }
  const features = regs.map((r) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] },
    properties: { type: key, key: r.key, name: r.name, count: r.count },
  }));
  const src = "t_" + key;
  map.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features } });
  map.addLayer({
    id: src + "_glow", type: "circle", source: src,
    paint: { "circle-radius": 9, "circle-color": cfg.color, "circle-opacity": 0.18, "circle-blur": 0.8 },
  });
  map.addLayer({
    id: src + "_dot", type: "circle", source: src,
    paint: { "circle-radius": 5, "circle-color": cfg.color, "circle-stroke-color": "#0b0e14", "circle-stroke-width": 1.2 },
  });
  map.on("click", src + "_dot", (e: MBEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    const count = Number(f.properties.count) || undefined;
    const href = f.properties.key ? `${cfg.url}?region=${encodeURIComponent(f.properties.key)}` : cfg.url;
    const meta = overlayMeta(key, count);
    const html =
      `<div class="iw"><div class="iwn">${escapeHtml(f.properties.name)}</div>` +
      `<div class="iwm">${escapeHtml(meta)}</div>` +
      `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">Open ${escapeHtml(cfg.label)} Atlas ↗</a></div>`;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  });
  map.on("mouseenter", src + "_dot", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", src + "_dot", () => { map.getCanvas().style.cursor = ""; });
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

function layerIdsFor(key: string): string[] {
  return key === "hotel" ? ["hotel-heat", "hotel-dots"] : ["t_" + key + "_glow", "t_" + key + "_dot"];
}

// ── Hotel point feed ───────────────────────────────────────────────────────

interface HotelFC {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: { id: string; region: string | null; name: string } }[];
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
  try { map.addLayer(spec); } catch { /* layer skipped */ }
}

function setFog(map: MBMap) {
  try {
    map.setFog({
      color: "rgb(11,13,18)", "high-color": "rgb(22,27,38)",
      "horizon-blend": 0.04, "space-color": "rgb(6,8,12)", "star-intensity": 0.45,
    });
  } catch { /* fog optional */ }
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
interface MBMap {
  on(type: string, layerOrCb: string | (() => void) | ((e: MBEvent) => void), cb?: (e: MBEvent) => void): void;
  getZoom(): number;
  getMinZoom(): number;
  getCenter(): { lng: number; lat: number };
  setCenter(c: { lng: number; lat: number }): void;
  setZoom(z: number): void;
  flyTo(opts: { center: [number, number]; zoom: number; speed?: number }): void;
  resize(): void;
  remove(): void;
  addSource(id: string, src: unknown): void;
  getSource(id: string): { setData(d: unknown): void } | undefined;
  addLayer(spec: Record<string, unknown>): void;
  getLayer(id: string): unknown;
  setPaintProperty(id: string, prop: string, val: unknown): void;
  setLayoutProperty(id: string, prop: string, val: unknown): void;
  setFog(f: unknown): void;
  getCanvas(): HTMLCanvasElement;
  getProjection(): { name: string };
}
interface MapboxModule {
  accessToken: string;
  Map: new (opts: Record<string, unknown>) => MBMap;
  Popup: new (opts: Record<string, unknown>) => MBPopup;
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

// lib/globe.ts — Mapbox plotting for the Living Atlas globe.
//
// Ports the inventory layers public/index.html draws onto the resting globe:
// the full hotel set as an ambient gold heatmap + dot field (from
// /api/atlas-points), and colored region pins for cruise / jet / yacht (from
// /api/atlas-data). Kept framework-agnostic so AtlasShell stays a thin client
// component. Every fetch is best-effort: a feed being down just means fewer
// dots, never a broken map.

import type { OfferingType } from "./types";

// Public token, URL-restricted in the Mapbox account — same one the legacy
// app ships, so the globe renders with zero configuration. Override per
// deploy with NEXT_PUBLIC_MAPBOX_TOKEN.
export const DEFAULT_MAPBOX_TOKEN =
  "pk.eyJ1IjoiYXNwZW50cmF2ZWwiLCJhIjoiY21xNDJwcHA2MHZxMDJycTI2bm9maXNmMyJ9.xFFm4X4mqbWQVxmBhaQhBA";

export const TYPE_COLORS: Record<string, string> = {
  hotel: "#c9a84c",
  cruise: "#5aa9e6",
  jet: "#dfe5f2",
  yacht: "#e0b84a",
};

export const LEGEND_ITEMS: { key: string; label: string; color: string }[] = [
  { key: "hotel", label: "Hotels", color: TYPE_COLORS.hotel },
  { key: "cruise", label: "Expedition Cruise", color: TYPE_COLORS.cruise },
  { key: "jet", label: "Jet", color: TYPE_COLORS.jet },
  { key: "yacht", label: "Yacht", color: TYPE_COLORS.yacht },
];

const HOTEL_DENSITY_SOURCE = "hotel-density";
const HOTEL_DOT_MIN_ZOOM = 2.45;
const OVERLAY_TYPES: OfferingType[] = ["cruise", "jet", "yacht"];

// ── minimal Mapbox typings (only the surface we touch) ──────────────────────
type Coord = [number, number];
interface FeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: Coord };
    properties: Record<string, unknown>;
  }>;
}
interface GeoJSONSource {
  setData(data: FeatureCollection): void;
}
export interface MapboxPopup {
  setLngLat(lnglat: Coord | { lng: number; lat: number }): MapboxPopup;
  setHTML(html: string): MapboxPopup;
  addTo(map: MapboxMap): MapboxPopup;
  remove(): void;
}
export interface LngLatBounds {
  extend(coord: Coord): LngLatBounds;
}
interface MapMouseEvent {
  lngLat: { lng: number; lat: number };
  features?: Array<{ properties: Record<string, unknown> }>;
}
export interface MapboxMap {
  on(event: string, cb: (e: MapMouseEvent) => void): void;
  on(event: string, layerId: string, cb: (e: MapMouseEvent) => void): void;
  getLayer(id: string): unknown;
  getSource(id: string): GeoJSONSource | undefined;
  addSource(id: string, spec: { type: "geojson"; data: FeatureCollection }): void;
  addLayer(spec: Record<string, unknown>): void;
  setPaintProperty(layer: string, prop: string, value: unknown): void;
  setLayoutProperty(layer: string, prop: string, value: unknown): void;
  setFog(opts: Record<string, unknown>): void;
  getCanvas(): HTMLCanvasElement;
  flyTo(opts: Record<string, unknown>): void;
  fitBounds(bounds: LngLatBounds, opts?: Record<string, unknown>): void;
  resize(): void;
  remove(): void;
}
export interface MapboxModule {
  accessToken: string;
  Map: new (opts: Record<string, unknown>) => MapboxMap;
  Popup: new (opts?: Record<string, unknown>) => MapboxPopup;
  LngLatBounds: new () => LngLatBounds;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );

// ── fog / atmosphere (matches the legacy globe) ─────────────────────────────
export function applyFog(map: MapboxMap) {
  map.setFog({
    color: "rgb(11,13,18)",
    "high-color": "rgb(22,27,38)",
    "horizon-blend": 0.04,
    "space-color": "rgb(6,8,12)",
    "star-intensity": 0.45,
  });
}

// ── hotel ambient field ─────────────────────────────────────────────────────
async function fetchHotelFeed(): Promise<FeatureCollection | null> {
  try {
    const r = await fetch("/api/atlas-points", { cache: "no-store" });
    if (!r.ok) return null;
    const fc = await r.json();
    return fc && Array.isArray(fc.features) && fc.features.length ? fc : null;
  } catch {
    return null;
  }
}

export async function loadHotelField(map: MapboxMap) {
  const fc = await fetchHotelFeed();
  if (!fc) return;
  if (map.getSource(HOTEL_DENSITY_SOURCE)) {
    map.getSource(HOTEL_DENSITY_SOURCE)!.setData(fc);
  } else {
    map.addSource(HOTEL_DENSITY_SOURCE, { type: "geojson", data: fc });
  }
  if (!map.getLayer("hotel-heat")) {
    map.addLayer({
      id: "hotel-heat",
      type: "heatmap",
      source: HOTEL_DENSITY_SOURCE,
      maxzoom: 4.35,
      paint: {
        "heatmap-weight": 1,
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.65, 3, 1.1],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 12, 3, 24],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.36, 3.4, 0.18, 4.3, 0],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(201,168,76,0)",
          0.22, "rgba(201,168,76,0.15)",
          0.55, "rgba(226,200,122,0.34)",
          0.86, "rgba(255,238,177,0.55)",
          1, "rgba(255,247,213,0.68)",
        ],
      },
    });
  }
  if (!map.getLayer("hotel-dots")) {
    map.addLayer({
      id: "hotel-dots",
      type: "circle",
      source: HOTEL_DENSITY_SOURCE,
      minzoom: HOTEL_DOT_MIN_ZOOM,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2.45, 1.5, 4, 2.7, 7, 3.6, 10, 4.8],
        "circle-color": "#f1d879",
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 2.45, 0.18, 3.2, 0.62, 7, 0.92],
        "circle-stroke-color": "rgba(26,20,7,.88)",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2.45, 0.45, 7, 1.1],
        "circle-blur": 0,
      },
    });
  }
}

// ── cruise / jet / yacht region pins ────────────────────────────────────────
interface RegionRow {
  key: string;
  name: string;
  lng: number;
  lat: number;
  count: number;
}

// Normalize a meta/itinerary feed into region pins. Each app keys its regions
// the same way it tags trips (the `g` array); counts come from the meta when
// present, otherwise tallied from TRIPS. `coord` is [lat, lng].
function regionsFromData(json: Record<string, unknown>): RegionRow[] {
  const R = (json.REGIONS as Record<string, Record<string, unknown>>) || {};
  const trips = Array.isArray(json.TRIPS) ? (json.TRIPS as Record<string, unknown>[]) : [];
  const tally: Record<string, number> = {};
  for (const t of trips) {
    const gs = Array.isArray(t.g) ? (t.g as string[]) : [];
    for (const g of gs) tally[g] = (tally[g] || 0) + 1;
  }
  const out: RegionRow[] = [];
  for (const k of Object.keys(R)) {
    const r = R[k];
    const coord = r && Array.isArray(r.coord) ? (r.coord as number[]) : null;
    if (!coord || coord.length < 2) continue;
    const name = (r.name as string) || k;
    if (/^other\b/i.test(k) || /^other\b/i.test(name)) continue; // skip catch-all buckets
    const count = r.count != null ? Number(r.count) : tally[k] || 0;
    out.push({ key: k, name, lng: Number(coord[1]), lat: Number(coord[0]), count });
  }
  return out.filter((r) => Number.isFinite(r.lng) && Number.isFinite(r.lat));
}

function typeDeepLink(base: string, regionKey: string) {
  return regionKey ? `${base}?region=${encodeURIComponent(regionKey)}` : base;
}
function overlayMeta(type: OfferingType, label: string, count: number) {
  if (type === "cruise") return `Expedition Cruises${count ? ` · ${count} sailings` : ""}`;
  return `${label} expeditions${count ? ` · ${count}` : ""}`;
}

async function addTypeLayer(
  map: MapboxMap,
  mapboxgl: MapboxModule,
  popup: MapboxPopup,
  type: OfferingType,
  label: string,
  base: string,
) {
  const res = await fetch(`/api/atlas-data?type=${type}`, { cache: "no-store" });
  if (!res.ok) return;
  const json = await res.json();
  const regs = regionsFromData(json).sort((a, b) => (b.count || 0) - (a.count || 0));
  if (!regs.length) return;
  const fc: FeatureCollection = {
    type: "FeatureCollection",
    features: regs.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lng, r.lat] as Coord },
      properties: { type, key: r.key, name: r.name, count: r.count },
    })),
  };
  const src = "t_" + type;
  if (map.getSource(src)) {
    map.getSource(src)!.setData(fc);
    return;
  }
  const color = TYPE_COLORS[type];
  map.addSource(src, { type: "geojson", data: fc });
  map.addLayer({
    id: src + "_glow",
    type: "circle",
    source: src,
    paint: { "circle-radius": 9, "circle-color": color, "circle-opacity": 0.18, "circle-blur": 0.8 },
  });
  map.addLayer({
    id: src + "_dot",
    type: "circle",
    source: src,
    paint: {
      "circle-radius": 5,
      "circle-color": color,
      "circle-stroke-color": "#0b0e14",
      "circle-stroke-width": 1.2,
    },
  });
  map.on("click", src + "_dot", (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    const p = f.properties;
    const href = typeDeepLink(base, String(p.key || ""));
    const html =
      `<div class="iw"><div class="iwn">${esc(p.name)}</div>` +
      `<div class="iwm">${esc(overlayMeta(type, label, Number(p.count)))}</div>` +
      `<a href="${esc(href)}" target="_blank" rel="noopener">Open ${esc(label)} ↗</a></div>`;
    popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
  });
  map.on("mouseenter", src + "_dot", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", src + "_dot", () => {
    map.getCanvas().style.cursor = "";
  });
}

export async function loadTypeOverlays(
  map: MapboxMap,
  mapboxgl: MapboxModule,
  popup: MapboxPopup,
  atlases: Record<string, { label: string; base: string }>,
) {
  await Promise.all(
    OVERLAY_TYPES.map((type) =>
      addTypeLayer(map, mapboxgl, popup, type, atlases[type].label, atlases[type].base).catch(
        () => {},
      ),
    ),
  );
}

// Map a legend key to the Mapbox layers it controls.
export function layerIdsFor(key: string): string[] {
  return key === "hotel" ? ["hotel-heat", "hotel-dots"] : ["t_" + key + "_glow", "t_" + key + "_dot"];
}

export function setLayerVisibility(map: MapboxMap, key: string, visible: boolean) {
  for (const id of layerIdsFor(key)) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}

// ── region fly-to ───────────────────────────────────────────────────────────
// Fallback centers [lng, lat, zoom] for a named region, so a deep link like
// ?region=Caribbean opens zoomed to the right place even before pins load.
const REGION_FALLBACK: Record<string, [number, number, number]> = {
  antarctica: [0, -72, 2.3], arctic: [8, 79, 2.3], galapagos: [-91, -0.4, 5],
  amazon: [-60, -3.5, 3.8], polynesia: [-149, -17, 3.4], patagonia: [-72, -49, 3.6],
  kimberley: [126, -16, 4.3], mediterranean: [15, 38.5, 3.4], norway: [12, 65, 3.4],
  japan: [138, 37, 3.9], namibia: [17, -22, 4.2], alaska: [-149, 60.5, 4],
  caribbean: [-66, 16, 4], baja: [-111.5, 24, 4.4], britishisles: [-3, 58, 4],
  seychelles: [55.5, -4.6, 5], africa: [20, 0, 2.6], asia: [100, 30, 2.6],
  europe: [12, 50, 3], world: [10, 20, 1.3],
};

function regionLookupKey(raw: string): string {
  const v = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!v) return "";
  if (v.includes("antarctic")) return "antarctica";
  if (v.includes("arctic") || v.includes("svalbard")) return "arctic";
  if (v.includes("galapagos")) return "galapagos";
  if (v.includes("amazon")) return "amazon";
  if (v.includes("polynesia") || v.includes("tahiti") || v.includes("bora")) return "polynesia";
  if (v.includes("patagonia")) return "patagonia";
  if (v.includes("kimberley") || v.includes("kimberly")) return "kimberley";
  if (v.startsWith("med") || v.includes("mediterranean")) return "mediterranean";
  if (v.includes("norway") || v.includes("fjord")) return "norway";
  if (v.includes("japan")) return "japan";
  if (v.includes("namibia")) return "namibia";
  if (v.includes("alaska")) return "alaska";
  if (v.startsWith("carib") || v.includes("caribbean") || v.includes("bermuda")) return "caribbean";
  if (v.includes("baja")) return "baja";
  if (v.includes("british isles") || v.includes("northern europe")) return "britishisles";
  if (v.includes("seychelles") || v.includes("indian ocean")) return "seychelles";
  if (v.includes("africa")) return "africa";
  if (v.includes("asia")) return "asia";
  if (v.includes("europe")) return "europe";
  if (v.includes("world")) return "world";
  return v.replace(/\s+/g, "");
}

export function flyToRegion(map: MapboxMap, region: string | null) {
  if (!region) return;
  const f = REGION_FALLBACK[regionLookupKey(region)];
  if (!f) return;
  map.flyTo({ center: [f[0], f[1]], zoom: f[2], speed: 0.8, essential: true });
}

/**
 * The "Chart" basemap: a nautical-chart look built from stock Mapbox tilesets.
 *
 * Pale water banded by depth with faint depth contours, cream land under a
 * warm hillshade, a quiet latitude/longitude grid, and navy labels. No roads,
 * no landcover, no buildings. It is the engraved-chart reference the route
 * palette has always been drawn against (see routePalette in AtlasShell), now
 * offered as an actual basemap. It reads best at archipelago and coastline
 * scale, where the bathymetry carries the picture; at world scale it is simply
 * a light globe.
 *
 * Written as a style object rather than a Studio style so it needs no account
 * asset and no publish step: every source is a public Mapbox tileset the house
 * token can already read.
 *
 *   mapbox.mapbox-streets-v8      water, coastline, borders, place labels
 *   mapbox.mapbox-bathymetry-v2   `depth` polygons keyed by `min_depth` (m)
 *   mapbox.mapbox-terrain-dem-v1  hillshade
 *
 * Use {@link basemapInput} to hand it to `new Map` / `setStyle`: Mapbox keeps
 * a reference to the object it is given, and the atlases compare basemaps by
 * this object's identity, so the constant itself must never reach the map.
 */

// ── palette ────────────────────────────────────────────────────────────────
const LAND = "#f2ecdd";
const SHALLOW = "#f1f8f8";
const DEEP = "#cfe5ea";
const CONTOUR = "#b9d7dd";
const COAST = "#a9c9cf";
const GRID = "#9db8c2";
const BORDER = "#b8a88a";
const INK = "#1d3557"; // navy labels
const INK_WATER = "#5d8a9c";
const HALO = "rgba(250,252,250,0.9)";

const NAME = ["coalesce", ["get", "name_en"], ["get", "name"]];

/** Parallels and meridians every 10°, densified so they bend on the globe. */
function graticule() {
  const features: unknown[] = [];
  const line = (coords: [number, number][], label: string) =>
    features.push({ type: "Feature", properties: { label }, geometry: { type: "LineString", coordinates: coords } });
  for (let lat = -80; lat <= 80; lat += 10) {
    const coords: [number, number][] = [];
    for (let lng = -180; lng <= 180; lng += 2) coords.push([lng, lat]);
    line(coords, `${Math.abs(lat)}°`);
  }
  for (let lng = -180; lng < 180; lng += 10) {
    const coords: [number, number][] = [];
    for (let lat = -85; lat <= 85; lat += 2) coords.push([lng, lat]);
    line(coords, `${Math.abs(lng)}°`);
  }
  return { type: "FeatureCollection", features };
}

export const CHART_STYLE: Record<string, unknown> = {
  version: 8,
  name: "BevVIP Chart",
  glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
  sources: {
    streets: { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" },
    bathymetry: { type: "vector", url: "mapbox://mapbox.mapbox-bathymetry-v2" },
    dem: { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 },
    graticule: { type: "geojson", data: graticule() },
  },
  layers: [
    { id: "land", type: "background", paint: { "background-color": LAND } },
    {
      id: "water",
      type: "fill",
      source: "streets",
      "source-layer": "water",
      paint: { "fill-color": SHALLOW },
    },
    {
      // Deeper bands draw on top (sort key), so the shelf stays lightest and
      // the basin darkens toward the abyss, as on a printed chart.
      id: "depth",
      type: "fill",
      source: "bathymetry",
      "source-layer": "depth",
      layout: { "fill-sort-key": ["get", "min_depth"] },
      paint: {
        "fill-color": [
          "interpolate", ["linear"], ["get", "min_depth"],
          0, SHALLOW, 200, "#e6f2f4", 1000, "#dcedf0", 3000, "#d4e9ed", 6000, DEEP,
        ],
        "fill-antialias": false,
      },
    },
    {
      id: "depth-contours",
      type: "line",
      source: "bathymetry",
      "source-layer": "depth",
      paint: {
        "line-color": CONTOUR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.3, 8, 0.7],
        "line-opacity": 0.8,
      },
    },
    {
      id: "coastline",
      type: "line",
      source: "streets",
      "source-layer": "water",
      paint: { "line-color": COAST, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.3, 10, 0.9] },
    },
    {
      id: "hillshade",
      type: "hillshade",
      source: "dem",
      paint: {
        "hillshade-shadow-color": "#7d5f3c",
        "hillshade-highlight-color": "#fbf6ea",
        "hillshade-accent-color": "#6b5032",
        "hillshade-illumination-direction": 315,
        "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 3, 0.35, 9, 0.6, 13, 0.4],
      },
    },
    {
      id: "graticule",
      type: "line",
      source: "graticule",
      paint: { "line-color": GRID, "line-width": 0.5, "line-opacity": 0.55 },
    },
    {
      id: "borders",
      type: "line",
      source: "streets",
      "source-layer": "admin",
      filter: ["all", ["==", ["get", "admin_level"], 0], ["==", ["get", "maritime"], 0]],
      paint: { "line-color": BORDER, "line-width": 0.6, "line-opacity": 0.6, "line-dasharray": [3, 2] },
    },
    {
      id: "graticule-labels",
      type: "symbol",
      source: "graticule",
      minzoom: 3,
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 400,
        "text-field": ["get", "label"],
        "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"],
        "text-size": 9,
      },
      paint: { "text-color": GRID, "text-halo-color": HALO, "text-halo-width": 1 },
    },
    {
      id: "water-labels",
      type: "symbol",
      source: "streets",
      "source-layer": "natural_label",
      filter: ["match", ["get", "class"], ["ocean", "sea", "bay", "water"], true, false],
      layout: {
        "text-field": NAME,
        "text-font": ["DIN Pro Italic", "Arial Unicode MS Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 8, 13],
        "text-letter-spacing": 0.15,
        "text-max-width": 8,
      },
      paint: { "text-color": INK_WATER, "text-halo-color": HALO, "text-halo-width": 1 },
    },
    {
      // Islands, capes and peaks: the names an itinerary map is actually read by.
      id: "landform-labels",
      type: "symbol",
      source: "streets",
      "source-layer": "natural_label",
      filter: ["match", ["get", "class"], ["ocean", "sea", "bay", "water"], false, true],
      layout: {
        "text-field": NAME,
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        "text-size": 12,
        "text-max-width": 8,
      },
      paint: { "text-color": INK, "text-halo-color": HALO, "text-halo-width": 1.2 },
    },
    {
      id: "place-labels",
      type: "symbol",
      source: "streets",
      "source-layer": "place_label",
      filter: ["match", ["get", "class"], ["settlement", "settlement_subdivision"], true, false],
      minzoom: 4,
      layout: {
        "text-field": NAME,
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 14],
        "text-max-width": 8,
      },
      paint: { "text-color": INK, "text-halo-color": HALO, "text-halo-width": 1.2 },
    },
    {
      id: "country-labels",
      type: "symbol",
      source: "streets",
      "source-layer": "place_label",
      filter: ["==", ["get", "class"], "country"],
      maxzoom: 8,
      layout: {
        "text-field": NAME,
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 1, 9, 6, 13],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.18,
        "text-max-width": 7,
      },
      paint: { "text-color": INK, "text-opacity": 0.75, "text-halo-color": HALO, "text-halo-width": 1.2 },
    },
  ],
};

/**
 * What to pass to `new Map({ style })` / `setStyle`: style URLs as they are,
 * style objects as a fresh copy (see the module note).
 */
export function basemapInput(style: string | Record<string, unknown>): string | Record<string, unknown> {
  return typeof style === "string" ? style : structuredClone(style);
}

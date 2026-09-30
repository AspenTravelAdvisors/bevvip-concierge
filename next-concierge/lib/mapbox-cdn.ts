// Single source of truth for the mapbox-gl CDN build. The root layout preloads
// these exact URLs, so a version bump here keeps the resource hints, AtlasShell
// and VillaAtlas in lockstep.
//
// Keep this reasonably current. Mapbox serves its Standard styles from the
// server, and they move on without us: by September 2026, 3.7.0 fetched the
// standard-satellite style JSON and then never fired `style.load` — no error,
// no further requests — so the fallback watchdog in AtlasShell dropped every
// visitor to Dark after 4s (map_style_fallback on half of all visitors, which
// was everyone who reached a globe). 3.32.0 loaded the same style in ~0.3s.
export const MAPBOX_GL_VERSION = "3.32.0";
export const MAPBOX_JS = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.js`;
export const MAPBOX_CSS = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.css`;

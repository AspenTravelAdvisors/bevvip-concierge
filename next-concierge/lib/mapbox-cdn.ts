// Single source of truth for the mapbox-gl CDN build. The root layout preloads
// these exact URLs, so a version bump here keeps the resource hints, AtlasShell
// and VillaAtlas in lockstep.
export const MAPBOX_GL_VERSION = "3.7.0";
export const MAPBOX_JS = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.js`;
export const MAPBOX_CSS = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}/mapbox-gl.css`;

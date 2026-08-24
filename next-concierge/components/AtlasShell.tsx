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

import { useCallback, useEffect, useRef, useState } from "react";
import type { OfferingType, GuideMeta, GuideToolMeta, OfferingResult } from "@/lib/types";
import { ATLASES, COLLECTIONS, atlasRegionQuery, internalAtlasLink } from "@/lib/atlas-config";
import { MAPBOX_JS, MAPBOX_CSS } from "@/lib/mapbox-cdn";
// Every coordinate this component touches is minted here. See lib/atlas/geo.ts
// for why: six upstream feeds disagree about [lat,lng] vs [lng,lat], and the
// convention used to live only in comments.
import {
  type LngLat,
  fromLatLngPair,
  fromLngLatPair,
  fromNamed,
  geodesicLine,
  isFinitePair,
  offset as offsetLngLat,
  unrollLine,
} from "@/lib/atlas/geo";
import { mapStyleFallback, hotel3dOpened, mapEngineChosen } from "@/lib/analytics";
import { askAboutPin, askGuide, askGuideHref } from "@/lib/atlas/ask";
import Atlas3DLayer, {
  type Atlas3DHandle,
  type Camera3DState,
  type Point3D,
} from "./Atlas3DLayer";
import { rangeFromZoom, tiltFromPitch, zoomFromRange } from "@/lib/atlas/google3d";
import {
  parseViewParams,
  readStoredStyle,
  setViewParams,
  writeStoredStyle,
  type ShareStyle,
} from "@/lib/atlas/adapters/params";
import { frameRoute, framePoints } from "@/lib/atlas/route-frame";
import { bookingLink } from "@/lib/atlas/booking.js";
import { getTrip } from "@/lib/trip-state";

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
/*
 * Tilt.
 *
 * 55° is the shallowest angle at which Mapbox Standard's extruded footprints
 * read as buildings rather than as shaded roof polygons, and it is still flat
 * enough that the far side of the frame doesn't dissolve into horizon.
 *
 * STREET_ZOOM is where those footprints actually exist in the tiles. Camera
 * moves that land at or past it arrive pre-tilted — the pitch travels inside
 * the same flyTo ease, so it costs no extra animation and, unlike a
 * pitch-follows-zoom rule, it never touches the camera while the traveller is
 * driving it.
 */
const TILT_PITCH = 55;
const STREET_ZOOM = 13.5;
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
    label: "Private Jet Expeditions",
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
  // `nav` is the canonical name now that it reads "VIP Hotels" and "Private
  // Villas" — the hotel special-case that used to live here existed only
  // because the registry said plain "Hotels".
  label: OVERLAYS[c.type as OverlayKey]?.label ?? c.nav,
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
// Derived from the deep-link parser's list, so a basemap the menu offers is
// always one a Share link can carry. See SHARE_STYLES for why that direction.
export type StyleKey = ShareStyle;

/**
 * Basemaps that render photoreal imagery. `plotResults` forces one of these
 * before revealing a result set, and the model-suppression hack below applies
 * to all of them — so the set is named once rather than compared against the
 * string "satellite" in three places, which is what made adding a second
 * satellite style a three-file change instead of one line.
 */
const SATELLITE_KEYS = new Set<StyleKey>(["satellite", "daylight"]);

/**
 * Auto daylight: the light preset follows the camera.
 *
 * The house Satellite runs `dusk` on purpose — it keeps the ocean deep and in
 * key with the dark-luxe palette, which is right for an ambient globe. It is
 * wrong for the thing people zoom in TO DO: read a coastline, a reef, a piste,
 * or the shortlist the Guide just plotted. Past a certain altitude `dusk` stops
 * being a mood and becomes an underexposed photograph.
 *
 * So the globe still opens dark, and hands over to `daylight` once the camera
 * is close enough that the ground is the subject. Cheap: both satellite entries
 * are one Mapbox style URL under two light presets, so the swap is a
 * setConfigProperty, not a style reload (see AtlasApi.setStyle's same-url path).
 *
 * The two thresholds are deliberately apart. A single one would flip the
 * basemap back and forth every time a wheel gesture settled a hair either side
 * of it; the gap means you have to mean it in both directions. Roughly: IN is
 * an island group filling the frame, OUT is back to a basin or a continent.
 */
const AUTO_DAYLIGHT_IN = 8.5;
const AUTO_DAYLIGHT_OUT = 7;

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
// Daytime atmosphere: a bright blue limb and no stars. Reusing the dark fog
// under a `day` light preset is what makes a daylight globe look wrong — the
// terrain is lit at noon and the horizon is still at midnight.
const DAY_FOG = {
  color: "rgb(186,210,235)", "high-color": "rgb(96,140,200)",
  "horizon-blend": 0.08, "space-color": "rgb(18,30,54)", "star-intensity": 0,
};
/*
 * The basemaps, IN MENU ORDER — the style picker renders Object.keys(), so this
 * object's key order is the order the traveller sees. It runs flat-to-photoreal
 * and then into the two 3D-building views, which is also roughly the order of
 * how far in you are looking: Dark for the whole world, imagery for a coastline,
 * extruded buildings for a street.
 */
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
    // the 3D basemaps below keep their real buildings.
    objects3d: false,
  },
  /*
   * Daylight satellite.
   *
   * The house Satellite deliberately runs the `dusk` preset so the ocean stays
   * deep and in key with the dark palette — which is right for the ambient
   * globe and wrong for the thing people actually reach for imagery to do,
   * which is to look at a beach, a reef or a piste and see it in daylight. Both
   * now exist; nobody has to choose between the product's mood and being able
   * to see the ground.
   */
  daylight: {
    label: "Satellite (day)", url: "mapbox://styles/mapbox/standard-satellite",
    fog: DAY_FOG, sw: "#7fa9c9", light: "day", objects3d: false,
  },
  /*
   * Mapbox Standard extrudes real building footprints at city zoom. The two
   * presets below are the same style under different light, and are named for
   * what distinguishes them — the 3D, and the hour — rather than for the
   * Mapbox style they happen to share.
   */
  dusk: { label: "3D Dusk", url: "mapbox://styles/mapbox/standard", fog: DUSK_FOG, sw: "#caa46a", light: "dusk", objects3d: true },
  city: {
    label: "3D Day", url: "mapbox://styles/mapbox/standard",
    fog: DAY_FOG, sw: "#cfd8e3", light: "day", objects3d: true,
  },
};

// The traveller's remembered basemap pick lives in lib/atlas/adapters/params —
// see readStoredStyle there for why, and for why only explicit picks are
// written. Deliberately NOT cleared by resetView: starting the trip over clears
// the chat, the shortlist and the camera, all of which belong to the trip.
// Which basemap you like to read maps on does not.
//
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
  /**
   * `source` says who asked. "user" (the default, and what the Style menu
   * sends) is a deliberate choice and permanently disarms auto daylight for the
   * session — having picked a basemap, you should not watch the map overrule
   * you every time you zoom. "auto" is the shell talking to itself: the zoom
   * watcher, and plotResults forcing imagery to reveal a result set.
   */
  setStyle(key: StyleKey, source?: "user" | "auto"): void;
  setProjection(globe: boolean): void;
  /** Tilt the camera off vertical so extruded buildings read as buildings. */
  setTilt(on: boolean): void;
  resize(): void;
  plot(meta: GuideMeta): void;
  refit(): void;
  resetView(): void;
  /**
   * Repaint every collection's layers from the legend's current state.
   *
   * Solo is a whole-legend gesture — one click hides six collections — so the
   * legend can no longer poke individual layer ids and hope. This is owned by
   * the map effect because only that scope knows the route zoom gate: without
   * it, un-hiding a collection below ROUTE_ZOOM paints its whole route web
   * across the globe.
   */
  applyLayers(): void;
}

/** A stop on a traced route: where it is, what it's called, which day. */
export interface FocusStop {
  name: string;
  at: [number, number];
  day?: number | null;
}

/** The payload of `bevvip:atlas-route` — one trip to trace, or a clear. */
export interface RouteDetail {
  legs?: { mode: string; coordinates: [number, number][] }[];
  stops?: FocusStop[];
  /** Move the camera onto it. A click/deep link fits; a hover preview doesn't. */
  fit?: boolean;
  /** Frame these when the trip has no drawable route at all. */
  fitPoints?: [number, number][];
  /**
   * This framing belongs to an offering the page is SELECTING.
   *
   * Only the photoreal engine reads it, and only to stand down: selecting a
   * property emits this route and then flies the engine to the building, so
   * framing it here first would land the camera on top of the property and
   * leave the arrival with nowhere to fly from. Mapbox has no second flight and
   * ignores it. A framing with no `selecting` (a filter that narrows to one
   * property, a search) is nobody else's job and is flown here.
   */
  selecting?: boolean;
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
   * instead of opening a popup link. Home keeps the popup + link; those links
   * carry both `region=` (legacy focus) and `regions=` (native filter).
   * Home leaves it undefined and keeps the popup + link.
   */
  onRegionSelect?: (regionKey: string) => void;
  /**
   * Draw the ambient all-routes layer at all. OFF by default.
   *
   * The theory was that a faint web of every collection's lanes reads as
   * "living atlas" texture. In practice it doesn't survive contact with the
   * data: above the zoom gate every collection paints at a flat 0.82 opacity
   * with no fade, so the denser the region the worse it gets — the western
   * Mediterranean, the densest corner of the inventory, becomes an unreadable
   * mat of dashes over the labels and pins you actually came to read.
   *
   * The same judgement already applied to collection pages ("all 1,045 yacht
   * legs underneath one traced route"). It applies to the home globe for the
   * same reason; only the threshold differed. So routes are now on demand:
   * hover, click, or a plotted result set. Those paths draw through
   * `focus-route`, which is independent of this flag and unaffected.
   *
   * The precomputed sea routes from D1 are NOT wasted — collection pages still
   * draw every leg from them. This governs only the ambient underlay.
   */
  ambientRoutes?: boolean;
  /**
   * Collection accent, from OVERLAYS — platinum for jets, copper for rail,
   * gold for yachts. Traced routes and their stop dots use it, so a jet route
   * stops looking like a railway.
   */
  accent?: string;
  /**
   * Offer the Google Photorealistic 3D engine as a choice on this surface.
   *
   * An ENGINE, not a basemap: the shell keeps its Mapbox map alive underneath
   * and swaps which one is drawing, carrying the camera across in both
   * directions. Only surfaces with something worth looking at up close pass it
   * — photoreal tiles are worthless at globe zoom and cost real money to load,
   * so offering them on the world-cruise atlas would be an expensive way to
   * show someone a blurry ocean.
   *
   * `points` is the FILTERED set, so switching engines keeps the rail's
   * meaning; `selectedId` / `onSelect` are the selected property, shared with
   * the card list so a click means the same thing on either engine.
   */
  photoreal?: {
    points: Point3D[];
    selectedId: string | null;
    /** A pin was tapped: select it. The light gesture, same as a card tap. */
    onSelect: (id: string) => void;
    /**
     * A pin's own "Property details & 3D" was pressed: select it AND open its
     * panel. Separate from `onSelect` since selecting stopped disclosing —
     * the popup button is an explicit request for the file, a tap on the pin
     * behind it is not.
     */
    onOpenDetail: (id: string) => void;
    /**
     * Which engine is drawing, and how to change it. CONTROLLED by the page,
     * not held here: the page's Share link, its deep-link parse and its card
     * actions all need to know and to set it, and an engine that lived in the
     * shell would have been a second answer to a question the page already
     * has to answer. The shell renders the choice and reports changes.
     */
    engine: "mapbox" | "photoreal";
    onEngineChange: (engine: "mapbox" | "photoreal") => void;
  };
  /** Basemap this collection opens on. Jets read best on Dark. */
  initialStyle?: StyleKey;
  /** false → open flat (mercator). Long-haul flight arcs read better in 2D. */
  initialGlobe?: boolean;
  /**
   * Exact opening camera, from a shared `@lng,lat,zoom[,pitch[,bearing]]`.
   * pitch/bearing are absent on legacy links; absent means "don't touch that
   * axis", which is not the same as zero.
   */
  initialCamera?: { lng: number; lat: number; zoom: number; pitch?: number; bearing?: number } | null;
  /**
   * Reports basemap / projection / camera so a Share link can carry the view.
   * An advisor sharing with a client means "look at THIS, like THIS".
   */
  onViewChange?: (v: {
    style: StyleKey;
    globe: boolean;
    center: { lng: number; lat: number };
    zoom: number;
    pitch: number;
    bearing: number;
    /** [west, south, east, north] of what is on screen, when readable. */
    bounds?: [number, number, number, number] | null;
  }) => void;
  /**
   * true → this surface owns its view through the URL alone: the shell reads
   * ?style/?flat/?@ off the address bar on mount, and renders a Share button
   * that writes them back.
   *
   * Only the home globe sets it. Everywhere else the page is the authority —
   * collection pages run the full deep-link parse (their links carry filters
   * and a pinned journey too) and hand the result down as initialStyle /
   * initialGlobe / initialCamera, and their Share lives in the filter rail
   * where the rest of the link's meaning is assembled. A second button on the
   * map would be a second answer to the same question.
   *
   * Gating the URL read on this as well as the button is deliberate: a surface
   * whose parent already resolved the view must not have the shell second-guess
   * it from the raw query string.
   */
  selfShare?: boolean;
  /**
   * false → hide the collections legend. The home globe plots all seven
   * collections but is not a browsing surface; the panel there was a key to a
   * legend nobody was reading, taking the top-left corner of the world.
   */
  showLegend?: boolean;
  /**
   * Run the ambient auto-tour: the globe keeps its idle spin, then walks
   * westward through four places, dropping a captioned pin at each, and stops
   * dead the moment the visitor touches anything. See TOUR_STOPS / startTour.
   *
   * Home only. It is a demonstration for someone who has not yet decided to
   * engage, and every other surface is reached BY engaging.
   */
  ambientTour?: boolean;
}

/**
 * The ambient tour's itinerary — four places, walked west.
 *
 * WHY A TOUR AT ALL, given IntroTour was just made opt-in: that one narrated
 * the chrome ("this is the composer, this is the nav") and dimmed the product
 * to do it. This narrates the INVENTORY, on the map, with nothing dimmed and
 * no step to dismiss. It teaches by showing you the thing rather than by
 * pointing at the buttons that reach the thing.
 *
 * FOUR, and four spanning four different collections. One pin proves nothing;
 * a dozen is a screensaver. Four is enough to establish that the pins are
 * unlike each other — a Greek hotel, a Caribbean villa, a polar sailing, a
 * Canadian train — which is the claim the headline's single number can't make.
 *
 * The captions name a place and give one concrete reason to want it. They do
 * NOT restate the count: the headline directly above already owns that number,
 * and four pins each re-announcing scale would read as a spec sheet. Division
 * of labor — the headline says how many, the pins say how good.
 *
 * Ordered by descending longitude so the camera only ever travels westward,
 * matching the direction of the idle spin it interrupts. A tour that doubles
 * back reads as a slideshow; one that keeps going reads as a planet turning.
 */
interface TourStop {
  /** [lng, lat] of the place itself. */
  at: [number, number];
  name: string;
  /** One line. It is a caption, not a description — no second sentence. */
  hook: string;
}

const TOUR_STOPS: TourStop[] = [
  { at: [23.13, 37.31], name: "Amanzoe", hook: "Hilltop pavilions above the Argolic Gulf" },
  { at: [-61.19, 12.88], name: "Mustique", hook: "Private villas, fully staffed" },
  { at: [-60.0, -64.5], name: "Antarctic Peninsula", hook: "Ship-based, November to March" },
  { at: [-118.0, 51.2], name: "Rocky Mountaineer", hook: "Two days glass-domed, Banff to Vancouver" },
];

/**
 * How long the camera takes to swing to each stop, and how long it rests there.
 *
 * These are a BUDGET, not a taste. The Guide is held back until the tour ends
 * (see the "bevvip:tour-ended" broadcast in finishTour / abortTour), so every
 * millisecond here is a millisecond the visitor is looking at a product they
 * cannot yet type into. At the original 3400/2600 the whole run was 25.7s,
 * which is not a demonstration, it is a wait.
 *
 * 2400/1600 puts the full run at ~17.7s and the first pin at 4.1s. The dwell is
 * short on purpose: the captions are one line each, and a line you have already
 * read does not become more persuasive by staying on screen.
 */
const TOUR_TRAVEL_MS = 2400;
const TOUR_DWELL_MS = 1600;
/**
 * Idle spin before the first pin drops.
 *
 * Not zero. The globe arriving and immediately being driven somewhere reads as
 * a canned animation; a beat of plain rotation first establishes that the map
 * is live, so the tour reads as the map doing something rather than as a video.
 */
const TOUR_LEAD_MS = 1700;

/**
 * How long the globe takes to swing onto a result.
 *
 * These are the camera moves that ANSWER something — the Guide plotting a
 * shortlist, a card being framed — as opposed to the housekeeping eases (a
 * tilt toggle, a zoom-gate nudge), which stay quick because nobody is meant to
 * watch them.
 *
 * Deliberately ~2.7x the old 900/1200. At that speed the globe had already
 * arrived before you looked up from the chat, so the one moment that shows the
 * planet turning under the answer was the moment you missed — and screen
 * recordings of it were unusable, the rotation over in three frames. Slow
 * enough to read as travel, short enough that nobody waits on it.
 */
const REVEAL_MS = 2400;
/** Same move, but landing on a single place — further to fall, so longer. */
const REVEAL_POINT_MS = 3000;
/**
 * Re-framing results that are ALREADY on screen — the Guide panel was dragged
 * wider or collapsed, the phone sheet changed detent, the traveller switched
 * basemap. Nothing is being revealed, so this stays quick; at reveal speed,
 * closing the panel left the map crawling into place for the next two and a
 * half seconds.
 */
const REFRAME_MS = 700;

export default function AtlasShell({
  type, region, externalLink, scope, routesAlways, onRegionSelect,
  ambientRoutes = false, accent, initialStyle, initialGlobe, initialCamera, onViewChange,
  selfShare = false, showLegend = true, ambientTour = false, photoreal,
}: Props) {
  const allInventory = scope === "all";
  const showsHotel = allInventory || type === "hotel";
  const overlayKeys = (Object.keys(OVERLAYS) as OverlayKey[]).filter((k) => allInventory || type === k);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || FALLBACK_TOKEN;
  const mapEl = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MBMap | null>(null);
  const apiRef = useRef<AtlasApi | null>(null);
  const pendingPlotRef = useRef<GuideMeta | null>(null);
  /**
   * A route that arrived before the globe could draw it.
   *
   * `bevvip:atlas-route` used to be dropped on the floor when it landed before
   * the map was ready — `if (!api) return`, with no queue behind it, where the
   * sibling plot path has had one since it shipped. That is precisely the case
   * a "See on the map" hand-off hits: the collection's feed is a small JSON
   * file and the globe is a 900KB Mapbox chunk plus a style, so on a warm cache
   * the trip to trace resolves FIRST. The symptom is the one deep links are
   * for — you asked to see one voyage and got an untouched, idle-spinning
   * planet with no route on it.
   */
  const pendingRouteRef = useRef<RouteDetail | null>(null);
  /** Applies a route detail; set by the event effect, called by the flush. */
  const applyRouteRef = useRef<((detail: RouteDetail) => void) | null>(null);
  /** True once style.load has run: before that, painting a route throws. */
  const routeReadyRef = useRef(false);
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
  /**
   * The most recently reported camera, kept here as well as handed upward.
   *
   * The map effect is keyed on [token] and never re-runs, so the built-in Share
   * fallback cannot close over live state — and a page that passes no
   * onViewChange (the home globe) has nowhere else for the view to live.
   */
  const viewRef = useRef<{
    style: StyleKey; globe: boolean;
    center: { lng: number; lat: number }; zoom: number; pitch: number; bearing: number;
    bounds?: [number, number, number, number] | null;
  } | null>(null);
  /**
   * The view an incoming shared link asked for, read straight off the URL.
   *
   * Read ONLY under `selfShare` — the home globe, whose route has no filters to
   * parse and which stays a static prerender precisely because it never touches
   * searchParams on the server. Every other surface has a parent that already
   * resolved the view, and the shell must not reinterpret the query string
   * underneath it.
   *
   * Consumed only inside the map effect and never during render. That ordering
   * is the point: the server has no URL to read, so any render-path dependency
   * on this would be a hydration mismatch. The effect runs post-mount, where
   * the two sides have already agreed.
   */
  const arrivedView = useRef(
    typeof window === "undefined" || !selfShare
      ? { style: null, flat: false, camera: null }
      : parseViewParams(new URLSearchParams(window.location.search)),
  );
  const focusRouteRef = useRef<{
    paint(legs: { mode: string; coordinates: [number, number][] }[], stops?: FocusStop[]): void;
    clear(): void;
    fit(legs: { coordinates: [number, number][] }[]): void;
    /**
     * Drop to mercator if this geometry is too wide to frame on a globe.
     * Returns whether it switched, so the caller can let the transform settle
     * before fitting. Exposed because the plotted-results fit lives outside
     * wireHandlers() and needs the same gate the traced-route fit uses.
     */
    flatten(legs: { coordinates: [number, number][] }[]): boolean;
    /** Mark a routeless selection (a hotel) so the chosen pin is identifiable. */
    mark(stops: FocusStop[]): void;
  } | null>(null);
  const lastFocusStops = useRef<FocusStop[]>([]);
  // Stops the traced route's dash animation. Filled by the map effect; called
  // from its cleanup so an unmounted map can't keep a rAF loop alive.
  const stopFlowRef = useRef<(() => void) | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  /**
   * Boot card: mapbox-gl has to download, evaluate and build a first frame
   * before the canvas is anything but an empty rectangle, and this covers that
   * gap with words instead of a picture.
   *
   * It replaced a pre-rendered globe photo (/globe-poster.webp). That was a bad
   * trade twice over. A fixed square image can never sit exactly where the live
   * camera puts its globe across every viewport, so the handoff read as a photo
   * being swapped for a video — worse than the map's own layered load-in
   * (sphere → atmosphere → tiles sharpening), which is the smooth part the
   * poster was covering up. And it failed dangerously: the poster only cleared
   * on Mapbox's `load`, so anything that stopped the map getting there left a
   * fake globe on screen looking like a map that worked.
   *
   * Crossfades out at mapReady, then unmounts on transitionend.
   */
  const [bootGone, setBootGone] = useState(false);

  // Defensive release: the normal path unmounts on transitionend. Back/forward
  // cache and interrupted navigations can miss that lifecycle, so never let a
  // ready map sit behind an immortal card.
  useEffect(() => {
    if (bootGone || !mapReady) return;
    const id = window.setTimeout(() => setBootGone(true), 900);
    return () => window.clearTimeout(id);
  }, [bootGone, mapReady]);

  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [styleKey, setStyleKey] = useState<StyleKey>(initialStyle ?? "satellite");
  const [is3D, setIs3D] = useState(initialGlobe ?? true);
  /**
   * Camera pitch, as a plain on/off.
   *
   * The projection toggle is NOT this. It swaps globe⇄mercator, which is a
   * choice about the shape of the world, and it was labelled "3D" — so the one
   * control that promised perspective delivered a sphere seen from directly
   * above, and the extruded buildings on the Standard basemaps were invisible
   * at every zoom because you were always looking straight down at their roofs.
   *
   * Tilt is its own button and its own state. Crucially it is a one-shot
   * easeTo, not a function of zoom: an earlier attempt interpolated pitch from
   * the zoom level, which fought every wheel event and made zooming feel broken.
   * Pitch changes only when the traveller asks for it, or on arrival at a
   * street-level camera move (flyTo carries the pitch in the same ease).
   */
  const [tilted, setTilted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  /* ── Engine ───────────────────────────────────────────────────────────
   *
   * Which map is drawing: Mapbox, or Google Photorealistic 3D.
   *
   * This is a different axis from the basemap. A basemap changes what the
   * Mapbox renderer paints; an engine changes which renderer is on screen. The
   * two are kept apart because the traveller's basemap pick has to survive a
   * trip through photoreal and back — going to 3D and returning should land you
   * on the Satellite you were on, not reset you to the house default.
   *
   * Mapbox stays mounted underneath rather than being torn down. Rebuilding a
   * GL map costs a style load, a source refetch and every layer this shell
   * adds; hiding it costs nothing and makes the return instant.
   */
  const engine = photoreal?.engine ?? "mapbox";
  const setEngine = useCallback(
    (next: "mapbox" | "photoreal") => photoreal?.onEngineChange(next),
    [photoreal],
  );
  const [engineNote, setEngineNote] = useState<string | null>(null);
  const [threeReady, setThreeReady] = useState(false);
  const threeRef = useRef<Atlas3DHandle | null>(null);
  /**
   * The camera the photoreal engine opens on, captured at the moment of the
   * switch. A ref, not state: it is a handover value read once on mount, and
   * making it reactive would rebuild the engine every time the camera moved.
   */
  const threeCameraRef = useRef<Camera3DState>({
    lat: 20, lng: 0, range: 12_000_000, tilt: 0, heading: 0,
  });
  const photorealOn = engine === "photoreal" && !!photoreal;
  /*
   * The map effect is keyed on [token] and never re-runs, so the popup builders
   * inside it cannot close over the photoreal wiring. Same pattern as
   * onRegionSelectRef.
   */
  const photorealRef = useRef(photoreal);
  photorealRef.current = photoreal;

  /** The Mapbox camera, expressed the way the photoreal engine wants it. */
  const cameraToPhotoreal = useCallback((): Camera3DState => {
    const map = mapRef.current;
    const height = shellRef.current?.clientHeight || 640;
    const view = viewRef.current;
    const center = map ? map.getCenter() : { lng: view?.center.lng ?? 0, lat: view?.center.lat ?? 20 };
    const zoom = map ? map.getZoom() : view?.zoom ?? 2;
    const pitch = map ? map.getPitch() : view?.pitch ?? 0;
    const bearing = map ? map.getBearing() : view?.bearing ?? 0;
    const range = rangeFromZoom(zoom, center.lat, height);
    return {
      lat: center.lat,
      lng: center.lng,
      range,
      tilt: tiltFromPitch(pitch, range),
      heading: bearing,
    };
  }, []);

  /**
   * Switch engines, carrying the camera.
   *
   * A switch that teleports you is a switch nobody uses twice, so each
   * direction hands its camera to the other: zoom ⇄ range through the field-of-
   * view conversion in lib/atlas/google3d, pitch ⇄ tilt through the same tilt
   * ceiling the photoreal camera enforces on itself.
   */
  const setEngineChoice = useCallback(
    (next: "mapbox" | "photoreal") => {
      setMenuOpen(false);
      setEngineNote(null);
      if (next === engine) return;
      if (next === "photoreal") {
        if (!photoreal) return;
        threeCameraRef.current = cameraToPhotoreal();
        setThreeReady(false);
        setEngine("photoreal");
        return;
      }
      mapEngineChosen(type, "mapbox", true);
      // Photoreal → Mapbox: land where the 3D camera was left.
      const cam = threeRef.current?.getCamera();
      setEngine("mapbox");
      const map = mapRef.current;
      if (cam && map) {
        const height = shellRef.current?.clientHeight || 640;
        try {
          map.jumpTo({
            center: [cam.lng, cam.lat],
            zoom: zoomFromRange(cam.range, cam.lat, height),
            pitch: Math.min(cam.tilt, 85),
            bearing: cam.heading,
          });
          setTilted(cam.tilt > 1);
        } catch {
          /* a camera we cannot apply is not worth blocking the switch for */
        }
      }
      // The canvas was hidden while photoreal drew; GL needs to be told its box
      // is visible again or the first frame back is stretched.
      window.setTimeout(() => {
        try { mapRef.current?.resize(); } catch { /* unmounted */ }
      }, 0);
    },
    [engine, photoreal, cameraToPhotoreal, setEngine, type],
  );

  /**
   * The engine could not start. Fall back rather than showing an empty box —
   * the same judgement as the basemap watchdog: a degraded map beats no map.
   */
  const onThreeUnavailable = useCallback((reason: "nokey" | "load") => {
    mapEngineChosen(type, "photoreal", false);
    setEngine("mapbox");
    setEngineNote(
      reason === "nokey"
        ? "Photoreal 3D isn't configured for this deployment."
        : "Photoreal 3D couldn't load — showing the Mapbox view.",
    );
    window.setTimeout(() => {
      try { mapRef.current?.resize(); } catch { /* unmounted */ }
    }, 0);
  }, [setEngine, type]);

  /** Phones only: the legend sheet's open state. Desktop renders it inline. */
  const [legendOpen, setLegendOpen] = useState(false);
  const [isFull, setIsFull] = useState(false);
  /** Transient "✓ Link copied" confirmation for the built-in share path. */
  const [shared, setShared] = useState(false);
  const [badge, setBadge] = useState<{ n: number; total: number; deepLink?: string | null } | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  /**
   * Ambient route lines are muted while ONE thing is being looked at.
   *
   * Dormant while `ambientRoutes` is off (its default), but kept because it is
   * what makes re-enabling the underlay safe: without it, flying to a hotel
   * crosses ROUTE_ZOOM and repaints the whole web over the property you asked
   * to see.
   *
   * Flying to a hotel crosses ROUTE_ZOOM, and every collection's itineraries
   * then paint across the view — the cobweb, arriving precisely when the user
   * asked to see a single property. Same principle already applied to traced
   * routes ("a deliberate act of attention"): a selection outranks ambience.
   * A ref rather than state because `zoomend` re-derives visibility from inside
   * the map closure and would otherwise repaint over the mute.
   */
  const ambientMutedRef = useRef(false);

  useEffect(() => {
    if (!token || !mapEl.current) return;
    let cancelled = false;
    let spinRAF = 0;
    let spinning = false;
    /**
     * Something outranked the ambience and owns the camera from here on.
     *
     * Latched by stopSpin — a traced route, a plotted answer, a framed hotel, a
     * shared link's camera, or the visitor's own hand on the globe. Boot is the
     * reason it exists: the resting state is reached TWICE (once at style.load,
     * once when the region feed resolves), and both passes used to fitGlobe()
     * and restart the spin over whatever had claimed the camera in between. A
     * deep-linked trip therefore traced correctly and was then thrown back out
     * to the whole planet, spinning — which is what "See on the map" looked
     * like from the outside.
     */
    let cameraClaimed = false;
    let pulseRAF = 0;
    let pulsing = false;
    // Ambient auto-tour. `tourArmed` is one-way: the tour gets exactly one
    // chance per mount, so a refit or a projection toggle can never restart a
    // demonstration the visitor has already sat through (or already dismissed
    // by touching the map).
    let tourArmed = false;
    let tourActive = false;
    // Set by the first thing that outranks the tour — an interaction, a plotted
    // answer, a traced route. One-way, and checked separately from `tourActive`
    // so the scheduled-but-not-yet-running lead-in can be cancelled too.
    let tourDismissed = false;
    let tourTimer = 0;
    // Separate from tourTimer because the two are waiting on different things —
    // one on the clock, one on the network — and abortTour has to cancel both.
    let tourPaintTimer = 0;
    let tourStep = 0;
    // The swing back to the equator after the tour finishes. Effect-scoped so
    // an unmount mid-swing can cancel it. See settleToEquator.
    let settleTimer = 0;
    let ready = false;
    let focused = false;
    let restyling = false;
    /**
     * A restyle that a PLOT started, so the fit it hands to style.load is a
     * reveal and takes the slow camera. Without this the guide's answer landed
     * at re-frame speed for anyone not already on daylight imagery — the one
     * path where the reveal is handed off rather than run inline.
     */
    let restyleIsReveal = false;
    let subsetActive = false;
    let homeZoom = 1.25;
    // Props first, then the URL, then the defaults. See `arrivedView`.
    const arrived = arrivedView.current;
    const arrivedStyle = (arrived.style as StyleKey | null);
    let projGlobe = initialGlobe ?? (arrived.flat ? false : true);
    // Precedence: the prop, then the URL, then this session's remembered pick,
    // then the house default. The URL outranks the preference on purpose — a
    // Share link is the sender describing what THEY saw, and the recipient's
    // stored basemap has no business overwriting the picture they were sent.
    const linkedStyle = arrivedStyle && ATLAS_STYLES[arrivedStyle] ? arrivedStyle : null;
    const storedStyle = readStoredStyle();
    let styleKeyLocal: StyleKey =
      initialStyle ?? linkedStyle ?? storedStyle ?? "satellite";
    /*
     * Auto daylight is armed unless a PERSON picked the boot basemap.
     *
     * A Share link, or a pick carried in from another atlas, is someone having
     * already chosen — including a link captured while auto had switched to
     * daylight, which re-opens on daylight rather than snapping back.
     *
     * `initialStyle` is NOT someone choosing. It is the PAGE's default, and
     * every collection atlas passes "satellite" (hotel, jet, yacht, cruise,
     * worldcruise). Treating it as a choice meant the altitude handoff ran on
     * the home globe alone: zooming into a coastline from /atlas/yacht sat on
     * `dusk` forever, the one place a traveller is closest to actually reading
     * the ground. The rule the atlases wanted is the plain one — on dusk
     * satellite, coming in close brings the lights up.
     *
     * Armed only from a photoreal boot style. The zoomend watcher re-checks
     * (Dark and the 3D presets are nobody's idea of "satellite, but lit"), but
     * arming honestly here keeps the flag meaning what it says.
     */
    let autoLight = !linkedStyle && !storedStyle && SATELLITE_KEYS.has(styleKeyLocal);
    const arrivedCamera = initialCamera ?? arrived.camera;
    // Reconcile the controls with what the URL just decided. Safe to call here
    // and nowhere earlier: this is post-mount, so it re-renders the swatch and
    // the Globe/Flat label rather than desyncing them from the server's HTML.
    if (styleKeyLocal !== styleKey) setStyleKey(styleKeyLocal);
    if (projGlobe !== is3D) setIs3D(projGlobe);
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
            SATELLITE_KEYS.has(styleKeyLocal) && url.includes("api.mapbox.com/models/")
              ? { url: EMPTY_GLB }
              : undefined,
        }) as MBMap;
        mapRef.current = map;

        // First full draw. The idle spin is held back a beat rather than started
        // here: at `load` the satellite tiles are still resolving, and a globe
        // that starts turning mid-sharpen reads as jitter.
        let revealed = false;
        let onRevealed: (() => void) | null = null;
        map.on("load", () => {
          if (cancelled) return;
          window.setTimeout(() => {
            revealed = true;
            onRevealed?.();
            onRevealed = null;
          }, 750);
        });
        function spinWhenRevealed() {
          // Re-checked at FIRE time, not at call time. The reveal is 750ms
          // behind the first paint, which is easily long enough for a deep link
          // to trace its route in between — and a spin started after that puts
          // the globe back in motion under a camera someone asked to hold.
          const go = () => { if (cameraClaimed) return; startSpin(); armTour(); };
          if (revealed) go();
          else onRevealed = go;
        }

        // Separate popup for stop labels so it can't fight the pin popup.
        const stopPopup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 10,
          maxWidth: "260px",
          // Inert to the pointer. The label sits directly over the stop's
          // (now generous) hit target, so a popup that took mouse events would
          // pull the cursor off the layer, close itself, hand the cursor back
          // and reopen — a flicker loop right where you are trying to aim.
          className: "atlas-stopcap",
        });
        let stopHoverWired = false;
        /**
         * A stop label opened by a TAP, which must survive until the next tap
         * lands somewhere else. Hover labels close themselves on mouseleave;
         * a touch screen never sends one, so without this a tapped stop would
         * either close instantly or stay stuck on the map forever.
         */
        let stopPinned = false;
        /** Set by the stop click handler so the map-wide one can skip its turn. */
        let stopClickHandled = false;

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
          // A tilted camera at globe scale is a smeared horizon, not a view.
          // This is the resting frame, so level it — an explicit camera command
          // at a known moment, NOT a pitch-follows-zoom rule.
          if (map.getPitch() > 0.5) { try { map.setPitch(0); } catch { /* optional */ } }
        }
        /**
         * Stop the rotation and NOTHING else.
         *
         * Split out from stopSpin because the ambient tour has to stop the spin
         * in order to start — it drives the camera itself — and stopSpin now
         * means "something outranked the ambience", which is the one thing the
         * tour taking the wheel is not. Routing the tour's own hand-off through
         * stopSpin latched it as dismissed a moment before it began, leaving a
         * tour that ran happily and could never afterwards be interrupted.
         */
        function haltSpin() {
          spinning = false;
          cancelAnimationFrame(spinRAF);
        }
        function stopSpin() {
          haltSpin();
          // One-way for the rest of this mount: the resting state must not be
          // restored on top of whatever just took the camera. See cameraClaimed.
          cameraClaimed = true;
          // …and outranks the swing back to the equator that follows it. Without
          // this a visitor who grabbed the globe during the settle would be
          // fighting an ease they can't see the reason for.
          cancelSettle();
          // Anything that outranks the idle spin outranks the ambient tour.
          // Every such path already funnels through here — the interaction
          // listeners below, plotResults, markFocusPlace, fitFocusRoute, the
          // projection toggle — so the tour needs no interaction list of its
          // own to fall out of sync with. Declaration hoisting makes the
          // forward reference safe.
          abortTour();
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

        /**
         * How long the globe takes to swing back to the equator after the tour.
         *
         * Short — this is a return to rest, not a fifth stop. Long enough to
         * read as the planet settling rather than as a cut.
         */
        const SETTLE_MS = 1100;
        /** Give up the settle and leave the camera exactly where it is. */
        function cancelSettle() {
          if (!settleTimer) return;
          clearTimeout(settleTimer);
          settleTimer = 0;
          try { map.stop(); } catch { /* camera optional */ }
        }
        /**
         * Level the globe back onto the equator, then hand it to `then`.
         *
         * The tour's last stop is a Canadian one, so it leaves the camera near
         * 37°N — and fitGlobe only restores zoom and pitch, never latitude. The
         * idle spin that resumed after it therefore turned a planet tipped
         * toward the north pole, which is not the resting frame the globe
         * ARRIVED in and reads as the tour having left something behind.
         *
         * The spin is deliberately not started until the swing lands: spinStep
         * writes the centre every frame, so starting both at once would have
         * the rotation and the ease overwriting each other's centre.
         */
        function settleToEquator(then: () => void) {
          const c = map.getCenter();
          if (Math.abs(c.lat) < 1) { then(); return; } // already level
          try {
            map.easeTo({
              center: [c.lng, 0],
              zoom: homeZoom,
              duration: SETTLE_MS,
              essential: true,
            });
          } catch { then(); return; }
          settleTimer = window.setTimeout(() => {
            settleTimer = 0;
            then();
          }, SETTLE_MS);
        }

        // ── Ambient auto-tour ────────────────────────────────────────────────
        // Four captioned pins, dropped one at a time while the globe walks
        // west. It answers "what is in here?" by showing four unlike things,
        // which is the one question the headline's single number can't answer.
        //
        // THE WHOLE DESIGN IS THAT IT YIELDS. It runs only when nothing else
        // has claimed the camera, and the first sign of a visitor with their
        // own intent ends it permanently — see `abortTour`, wired into
        // stopSpin() so that every existing path which already outranks the
        // idle spin (a click, a drag, a wheel, a plotted answer, a traced
        // route, a framed hotel) outranks the tour too, for free and without a
        // second list to keep in sync.
        /**
         * Tell the page the stage is free.
         *
         * The Guide is held back on the home surface until this fires, which
         * makes it the single most load-bearing line in the tour: if it can
         * fail to fire, a visitor is left on a page with no way to type. So it
         * is emitted from every exit the tour has — natural completion, an
         * interruption, reduced motion, and the case where the tour was never
         * enabled at all — and latched so the several paths that legitimately
         * overlap can't double-fire it.
         *
         * HomeSplit also runs its own independent fallback timer, because "this
         * event always fires" is a claim about code that can be edited and the
         * cost of it being wrong is a dead page. Two mechanisms, deliberately.
         */
        let tourEndAnnounced = false;
        function announceTourEnd() {
          if (tourEndAnnounced) return;
          tourEndAnnounced = true;
          try { window.dispatchEvent(new Event("bevvip:tour-ended")); } catch { /* SSR/JSDOM */ }
        }

        const tourPins: { at: [number, number]; name: string }[] = [];
        const tourCap = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          focusAfterOpen: false,
          offset: 16,
          maxWidth: "260px",
          className: "atlas-tourcap",
        });

        function paintTourPins() {
          const data = {
            type: "FeatureCollection" as const,
            features: tourPins.map((p) => ({
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: p.at },
              properties: { label: p.name },
            })),
          };
          if (!map.getSource("tour-pins")) map.addSource("tour-pins", { type: "geojson", data });
          else map.getSource("tour-pins")?.setData(data);
          addLayer(map, {
            id: "tour_glow", type: "circle", source: "tour-pins",
            paint: {
              "circle-radius": 13,
              "circle-color": "#e6d488",
              "circle-opacity": 0.16,
              "circle-blur": 0.7,
            },
          });
          addLayer(map, {
            id: "tour_dot", type: "circle", source: "tour-pins",
            paint: {
              "circle-radius": 5.5,
              "circle-color": "#f3ead2",
              "circle-stroke-color": "#0b0e14",
              "circle-stroke-width": 1.4,
              "circle-opacity": 0.98,
            },
          });
        }

        function clearTourPins() {
          tourPins.length = 0;
          try {
            map.getSource("tour-pins")?.setData({ type: "FeatureCollection", features: [] });
          } catch { /* source may not exist yet, or may be between styles */ }
        }

        function showTourPin(stop: TourStop) {
          // Only the visible stop gets a tour pin. The previous one is removed
          // at the same moment the next caption appears, so stale tour dots can
          // never sit on the map as clickable-looking artifacts.
          clearTourPins();
          tourPins.push({ at: stop.at, name: stop.name });
          paintTourPins();
        }

        /**
         * Latitude the camera actually centres on, which is not the stop's own.
         *
         * Centring on a place at 64°S puts the pole in the middle of the frame
         * and the visible hemisphere becomes mostly ice and edge — the globe
         * stops reading as a globe. Damping toward the equator keeps the sphere
         * legible while still bringing the place comfortably into view; the
         * clamp is the backstop for anywhere further out than our own stops go.
         */
        function tourLat(lat: number) {
          return Math.max(-52, Math.min(52, lat * 0.72));
        }

        /**
         * Stand down, permanently.
         *
         * The `tourDismissed` latch — not `tourActive` — is what this guards
         * on, and the difference is a bug worth naming. For the first 1.7s the
         * tour is scheduled but not yet running: `tourActive` is still false.
         * Guarding on it meant a visitor who grabbed the globe half a second
         * after it appeared got the camera pulled out from under them a beat
         * later by a tour that had already been told to stop. "Until first
         * interaction" has to include the interval before the first pin, which
         * is precisely the interval a curious visitor is most likely to reach
         * for the thing they just noticed moving.
         */
        function abortTour() {
          if (tourDismissed) return;
          tourDismissed = true; // one-way; nothing re-arms the tour this mount
          clearTimeout(tourTimer); // kills the lead-in as well as a leg in flight
          clearTimeout(tourPaintTimer); // …and a leg waiting on tiles
          // Before anything else: an interrupted tour must still free the
          // stage. The visitor just told us they are engaged — that is the
          // moment to hand them the composer, not to withhold it.
          announceTourEnd();
          try { tourCap.remove(); } catch { /* popup optional */ }
          clearTourPins();
          if (!tourActive) return; // dismissed before it ever took the camera
          tourActive = false;
          // Stop the camera where it is rather than letting the in-flight ease
          // finish — "freezes" has to mean the frame you grabbed, not the frame
          // the tour was heading for.
          try { map.stop(); } catch { /* camera optional */ }
        }

        /**
         * Run `fn` once the map has finished painting where it just went.
         *
         * The tour used to pace purely on the clock, which assumed tile loading
         * is faster than a 3.4s camera ease. On a cold cache it is not: the
         * globe would arrive over the Caribbean with South America still an
         * unpainted black shape, and drop a caption reading "Private villas,
         * fully staffed" over a hole in the world. A demonstration of the
         * inventory that runs before the inventory has drawn is an argument
         * against the product.
         *
         * `idle` is Mapbox's own "camera stopped AND every requested tile is
         * in" signal, which is exactly the question being asked. The cap is
         * there because a slow connection must delay the tour, not strand it —
         * past that point a partly-painted map is still better than a tour that
         * silently never resumes.
         */
        function whenPainted(fn: () => void, capMs = 4000) {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(tourPaintTimer);
            fn();
          };
          if (map.areTilesLoaded?.()) { finish(); return; }
          tourPaintTimer = window.setTimeout(finish, capMs);
          map.once("idle", finish);
        }

        function tourNext() {
          if (!tourActive || cancelled) return;
          const stop = TOUR_STOPS[tourStep];
          if (!stop) { finishTour(); return; }
          tourStep++;
          // A backgrounded tab eases nothing and burns the whole itinerary in
          // one tick when it wakes. Hold position and re-check.
          if (document.hidden) {
            tourTimer = window.setTimeout(tourNext, 900);
            tourStep--;
            return;
          }
          try {
            map.easeTo({
              center: [stop.at[0], tourLat(stop.at[1])],
              zoom: homeZoom,
              duration: TOUR_TRAVEL_MS,
              essential: true,
            });
          } catch { /* camera optional */ }
          tourTimer = window.setTimeout(() => {
            if (!tourActive || cancelled) return;
            // The camera has arrived; the ground underneath it may not have.
            // Hold the pin and the caption until it has, and start the dwell
            // from THAT moment — a caption you read over unpainted terrain has
            // not been shown for 2.6 seconds, it has been wasted for 2.6.
            whenPainted(() => {
              if (!tourActive || cancelled) return;
              showTourPin(stop);
              try {
                tourCap
                  .setLngLat(stop.at)
                  .setHTML(
                    `<b>${escapeHtml(stop.name)}</b><span>${escapeHtml(stop.hook)}</span>`,
                  )
                  .addTo(map);
              } catch { /* caption optional */ }
              tourTimer = window.setTimeout(tourNext, TOUR_DWELL_MS);
            });
          }, TOUR_TRAVEL_MS);
        }

        function finishTour() {
          tourActive = false;
          clearTimeout(tourTimer);
          clearTimeout(tourPaintTimer);
          try { tourCap.remove(); } catch { /* popup optional */ }
          clearTourPins();
          // Run to completion and the globe returns to the resting state it
          // came from — including the latitude it came from, which fitGlobe
          // does not restore. Only an interaction leaves it frozen — that
          // stillness is the map acknowledging you took the wheel.
          fitGlobe();
          settleToEquator(startSpin);
          // The globe is turning again and nothing is being narrated — the beat
          // the Guide slides in on.
          announceTourEnd();
        }

        /**
         * No camera movement, no captions cycling, no tour pins.
         *
         * prefers-reduced-motion turns this from a choreographed demonstration
         * into an immediate hand-off. Temporary tour pins are deliberately not
         * left behind as a static overlay.
         */
        function staticTour() {
          clearTourPins();
          announceTourEnd();
        }

        function armTour() {
          // Every early return here is a case where no tour will play, and a
          // page where no tour will play must not hide its composer waiting for
          // one. `ambientTour` off (every surface but home), a flat projection,
          // already dismissed — all of them free the stage immediately.
          if (!ambientTour || !projGlobe) { announceTourEnd(); return; }
          if (tourArmed || tourDismissed) return;
          tourArmed = true;
          if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
            staticTour();
            return;
          }
          /*
           * Everything below re-checks at FIRE time, not arm time: the lead-in
           * is long enough for an answer to land, a deep link to resolve, or
           * the visitor to simply start dragging.
           *
           * And every one of those bail-outs announces. This is the bug the
           * harness caught: an answer arriving inside the first 1.7s made the
           * tour stand down silently, so the Guide — which is waiting on that
           * announcement — stayed hidden until the 22s dead-man's timer, on the
           * exact visit where the traveller had already asked a question.
           * `cancelled` is the sole exception: the component is unmounting and
           * there is nobody left to tell.
           */
          const standDown = () => {
            if (!cancelled) announceTourEnd();
          };
          tourTimer = window.setTimeout(() => {
            if (cancelled || tourDismissed) return; // abortTour already announced
            if (focused || subsetActive || !projGlobe) { standDown(); return; }
            if (map.getZoom() > homeZoom + 0.4) { standDown(); return; }
            // Don't start over a half-drawn world. The lead-in is a fixed
            // 1.7s and the first paint is not; on a cold cache the tour was
            // taking the camera while whole continents were still black.
            // Waiting on the resting globe costs nothing — it is idle-spinning
            // and looks entirely intentional either way.
            whenPainted(() => {
              if (cancelled || tourDismissed) return;
              if (focused || subsetActive || !projGlobe) { standDown(); return; }
              // haltSpin, NOT stopSpin: the tour taking the camera is not the
              // camera being taken FROM the tour. See haltSpin.
              haltSpin();
              tourActive = true;
              tourStep = 0;
              tourNext();
            });
          }, TOUR_LEAD_MS);
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
            paint: { "line-color": "#000010", "line-width": 3.2, "line-opacity": 0.22 },
          });
          addLayer(map, {
            id: src + "_line", type: "line", source: src,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": cfg.color,
              // Rail and jet journeys are SHORT — Scotland, Switzerland, the
              // Rockies — so at world zoom a whole itinerary is a few pixels
              // long. Thicken and solidify the line as you zoom out so the
              // routes still read as routes.
              "line-width": ["interpolate", ["linear"], ["zoom"], 0, 2, ROUTE_ZOOM, 1.3],
              // Was [1, 5] — one part colour to five parts the dark shadow
              // underneath, which is a black line with a hint of colour in it,
              // not a coloured route. Inverted: the collection's colour is the
              // line and the dark shows through as a break.
              "line-dasharray": [6, 1.6],
              "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.95, ROUTE_ZOOM, 0.82],
            },
          });
          // Visibility: above the route gate, type not hidden, nothing focused.
          const vis = routeVis(map.getZoom(), key);
          [src + "_shadow", src + "_line"].forEach((id) => {
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
          });
        }

        /** The single source of truth for whether a collection's routes draw. */
        function routeVis(z: number, key: string): "visible" | "none" {
          if (ambientMutedRef.current) return "none";
          return z >= routeGate && !hiddenRef.current.has(key) ? "visible" : "none";
        }

        /** Mute/unmute ambient routes and repaint what is already on the map. */
        function setAmbientMuted(on: boolean) {
          if (ambientMutedRef.current === on) return;
          ambientMutedRef.current = on;
          const z = map.getZoom();
          overlayKeys.forEach((key) => {
            const vis = routeVis(z, key);
            ["r_" + key + "_shadow", "r_" + key + "_line"].forEach((id) => {
              if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
            });
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
          // Closing the popup ends the selection: unmark the pin and let the
          // ambient routes back in. Otherwise the mute outlives its cause and
          // the globe stays quietly wrong until the next click.
          popup.on("close", () => {
            if (ambientMutedRef.current) clearFocusRoute();
          });
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
             * Browsing a hotel used to cost three hops: Guide globe → a hotel
             * browse atlas → "See it in 3D". The browse hop was pure loss:
             * someone who picked one property wants the photoreal property
             * view, not another list of hotels.
             *
             * So the pin opens a real popup in place. Do not also mark, label
             * or street-zoom the Mapbox canvas from here: in Mapbox GL 3.7 that
             * extra single-hotel focus path can throw inside the renderer and
             * leave the map apparently frozen while the popup remains clickable.
             * The photoreal view is the deliberate property-level handoff.
             */
            const three = id ? `/atlas/hotel?hotel=${encodeURIComponent(id)}` : null;
            const head =
              `<div class="iwn">${escapeHtml(name)}</div>` +
              (reg ? `<div class="iwm">${escapeHtml(reg)}</div>` : "");
            /*
             * Two shapes for one promise.
             *
             * Where this page HAS the photoreal engine (the hotel atlas), the
             * button opens the property right here — dossier beside the map,
             * camera down onto the building. Where it does not (the home
             * globe), it is still a link to the collection page, which will do
             * exactly that on arrival. What must never differ is the promise:
             * the property's whole dossier, of which the photoreal building is
             * one part.
             */
            const threeLink = !three
              ? ""
              : photorealRef.current
                ? `<button type="button" class="iw3d" data-hotel-open="${escapeHtml(id)}" data-hotel3d="${escapeHtml(id)}" title="Full profile: description, ratings, address, VIP benefits and rates — with the photoreal 3D view">Property details &amp; 3D</button>`
                : `<a class="iw3d" data-hotel3d="${escapeHtml(id)}" href="${escapeHtml(three)}" title="Full profile: description, ratings, address, VIP benefits and rates — with the photoreal 3D view">Property details &amp; 3D →</a>`;
            /*
             * And the question.
             *
             * A hotel pin used to offer a rate search and a 3D view and no way
             * to ask about the property — on the home globe, the single most
             * common thing someone does with a pin they just found. The text is
             * built here so it carries what the pin knows.
             */
            const askLink =
              `<button type="button" class="iwask" data-ask="${escapeHtml(askAboutPin({ name, region: reg }))}">✦ Ask The Guide</button>`;
            /*
             * The popup's headline action is the rate search, not another
             * browse surface.
             *
             * It used to read "Browse VIP hotels →". Someone who had just
             * picked one property out of 2,501 was offered, as their only
             * forward step, a filtered list containing that one property. The
             * link a traveller wants there is the price.
             *
             * The TravelWits identity lives server-side, so the link arrives a
             * beat later (see /api/hotel/tw). We paint the popup immediately and
             * patch the CTA in when it resolves — a popup that waits on a fetch
             * feels broken, and a link that cannot run its search is worse than
             * none at all.
             */
            popup
              .setLngLat(e.lngLat)
              .setHTML(`<div class="iw">${head}${threeLink}${askLink}</div>`)
              .addTo(map);
            if (id) {
              hotelRateLink(id, name).then((rate) => {
                if (!popup.isOpen?.()) return;
                popup.setHTML(
                  `<div class="iw">${head}` +
                    (rate
                      ? `<span class="iwbook-wrap"><a class="iwbook" href="${escapeHtml(rate.url)}" target="_blank" rel="noopener">${escapeHtml(rate.label)} ↗</a>` +
                        (rate.note ? `<span class="iwbook-code">${escapeHtml(rate.note)}</span>` : "") +
                        `</span>`
                      : "") +
                    threeLink +
                    askLink +
                    `</div>`,
                );
              });
            }
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
                atlasRegionQuery(f.properties.key),
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
          // Any photoreal basemap needs the heavier casing, not just the dusk
          // one — daylight imagery is if anything busier to draw a line over.
          const satellite = SATELLITE_KEYS.has(styleKeyLocal);
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
          /*
           * Weight. Thinner again — 4 / 2.8 before, 5.2 / 3.4 before that.
           *
           * Stacked up, the old values drew a 6.8px near-black cord with a 4px
           * coloured line sitting on it. That is the weight a printed road
           * atlas gives a motorway, and it is the single thing that made a
           * traced itinerary look mass-market: the reference for this map is
           * an engraved chart, where the route is a drawn line and the
           * restraint IS the luxury. A route is the only line on an otherwise
           * quiet collection map, so it never has to compete to be found.
           *
           * Everything below is expressed as a multiple of this one number, so
           * there is exactly one knob to turn if it wants to go thinner still.
           */
          const lineW = satellite ? 1.7 : 1.4;
          /*
           * A fixed pixel width is wrong at both ends of the zoom range: it
           * vanishes when a whole ocean is on screen, and swells into a road
           * once you are down among the streets. Ramping holds the line at the
           * same DRAWN weight relative to whatever is around it.
           *
           * (Dash arrays are in line-width units, so the tie rhythm rides this
           * ramp for free and reads identically at every zoom.)
           */
          const ramp = (w: number) =>
            ["interpolate", ["linear"], ["zoom"], 2, w * 0.8, 6, w, 12, w * 1.55];
          // The line keeps its TRUE brand colour on both basemaps — teal is
          // teal, platinum is platinum. Satellite only differs in needing a
          // dark halo, because photoreal terrain is busy where a flat dark
          // basemap is not.
          //
          // `tie` is now a LIGHTENED accent rather than near-black (#141922).
          // Black ticks chopping a gold line read as hazard tape; the same
          // rhythm in a brighter tint of the line's own colour reads as light
          // travelling along a wire, which is the thing the animation was
          // always trying to say.
          return satellite
            ? {
                casing: "#05060a", casingW: ramp(lineW + 1.7), casingO: 0.62,
                line: accentLocal, lineW: ramp(lineW), lineO: 0.95,
                tie: lighten(accentLocal, 0.68), tieO: 0.88,
                conn: accentLocal, connO: 0.85, connW: ramp(lineW * 0.72),
              }
            : {
                casing: "#0b0d12", casingW: ramp(lineW + 1.3), casingO: 0.34,
                line: accentLocal, lineW: ramp(lineW), lineO: 0.92,
                tie: lighten(accentLocal, 0.6), tieO: 0.8,
                conn: accentLocal, connO: 0.62, connW: ramp(lineW * 0.72),
              };
        }

        /*
         * Drive the dash phase.
         *
         * Runs ONLY while a route is traced — one line on screen, one
         * setPaintProperty every 55ms. The ambient underlay is deliberately not
         * animated: hundreds of lines repainting together is the kind of motion
         * that makes a map feel cheap, and costs real frames on a phone.
         *
         * Honours prefers-reduced-motion: the route still reads as dashed, it
         * just doesn't move.
         */
        let flowRAF = 0;
        let flowStep = 0;
        let flowLast = 0;
        const reduceMotion =
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

        function startRouteFlow() {
          if (flowRAF || reduceMotion) return;
          const tick = (now: number) => {
            flowRAF = requestAnimationFrame(tick);
            if (now - flowLast < FLOW_MS) return;
            flowLast = now;
            flowStep = (flowStep + 1) % FLOW_STEPS;
            try {
              if (map.getLayer("fr_ties")) {
                map.setPaintProperty("fr_ties", "line-dasharray", dashPhase(flowStep));
              }
            } catch { /* layer torn down mid-restyle */ }
          };
          flowRAF = requestAnimationFrame(tick);
        }
        function stopRouteFlow() {
          if (!flowRAF) return;
          cancelAnimationFrame(flowRAF);
          flowRAF = 0;
        }
        stopFlowRef.current = stopRouteFlow;

        function paintFocusRoute(
          legs: { mode: string; coordinates: [number, number][] }[],
          stops?: FocusStop[],
        ) {
          // Tracing a route is a deliberate act of attention — the idle spin
          // has to yield to it, or the camera drifts off the thing you just
          // asked to see (and fitBounds fights the rotation).
          stopSpin();
          /*
           * Order, orient and single-frame the geometry before anything touches
           * it. The shipped sea legs are deduplicated across trips, so they
           * arrive unordered, in arbitrary directions, and split across several
           * longitude frames — see lib/atlas/route-frame.ts. Everything
           * downstream (the dash animation's direction, the bounding box the
           * camera fits) assumes a route that runs one way through one frame.
           */
          const stopPts = (stops ?? lastFocusStops.current ?? [])
            .map((s) => s.at)
            .filter((at): at is [number, number] => Array.isArray(at) && at.length === 2);
          const framed = frameRoute(legs, stopPts);
          const data = {
            type: "FeatureCollection" as const,
            features: framed.map((l) => ({
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
          // Remember the FRAMED legs, not the raw ones: a basemap switch
          // repaints from here, and re-framing already-framed geometry is a
          // no-op, where re-framing raw geometry twice is not.
          lastFocusLegs.current = framed;
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
          // Round caps here, butt on the ties below: this layer is solid, so
          // the cap only ever shows at a leg's two ends, where a rounded
          // terminus is softer than a guillotined one.
          addLayer(map, {
            id: "fr_rail", type: "line", source: "focus-route",
            filter: ["any", ["==", ["get", "rail"], 1], ["==", ["get", "primary"], 1]],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": p.line, "line-width": p.lineW, "line-opacity": p.lineO },
          });
          /*
           * The travelling mark.
           *
           * A tint of the line's own colour laid OVER it, not a black tick cut
           * into it: the route stays one continuous colour and the mark is a
           * highlight sliding along it. It used to be rail-only ([2.5, 7],
           * sleepers), so a sea or air leg was a plain solid stroke with no
           * rhythm and no way to tell which end it started from; then it went
           * to every mode but in near-black, which at a heavy line weight read
           * as hazard tape rather than motion. One long, sparse, brighter
           * segment (TIE_DASH : TIE_GAP) says the same thing quietly.
           *
           * Values are in line-width units, so the rhythm scales with the line
           * and looks the same at every zoom and basemap weight.
           *
           * Cap stays BUTT. dashPhase() emits a zero-length lead dash for most
           * of its cycle, and a zero-length dash under a round cap renders as a
           * dot — a stray bead that would appear and vanish at the route's
           * start on every pass.
           */
          addLayer(map, {
            id: "fr_ties", type: "line", source: "focus-route",
            filter: ["any", ["==", ["get", "rail"], 1], ["==", ["get", "primary"], 1]],
            layout: { "line-join": "round", "line-cap": "butt" },
            paint: {
              "line-color": p.tie,
              "line-width": p.lineW,
              "line-opacity": p.tieO,
              "line-dasharray": dashPhase(0),
            },
          });
          // A connector is a hop the itinerary does not sell — a ferry, a
          // transfer. It should be legible and clearly subordinate, so it runs
          // thinner than the route proper and on a finer dash.
          addLayer(map, {
            id: "fr_conn", type: "line", source: "focus-route",
            filter: ["==", ["get", "conn"], 1],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": p.conn, "line-width": p.connW, "line-opacity": p.connO,
              "line-dasharray": [1.6, 4.4],
            },
          });
          /*
           * Direction, stated rather than implied.
           *
           * The travelling highlight above says which way the voyage runs, but
           * only if you happen to be looking when it moves — and it says
           * nothing at all under prefers-reduced-motion, in a screenshot, or on
           * the frame a traveller actually stops on. Sparse chevrons riding the
           * line answer "which way round does this go?" instantly and
           * statically, which is the ordinary cartographic idiom for it.
           *
           * `text-keep-upright: false` is the whole feature: left at its
           * default, Mapbox flips glyphs that would render upside-down so they
           * stay readable, which silently points half the chevrons back up the
           * route. Overlap is NOT allowed, so they thin out on a tight coastal
           * leg instead of piling into a smear.
           *
           * The fontstack is named explicitly with Arial Unicode MS behind it:
           * a missing glyph renders as nothing at all, and losing the direction
           * cue to a font fallback is not a failure that would be obvious.
           */
          addLayer(map, {
            id: "fr_arrow", type: "symbol", source: "focus-route",
            filter: ["any", ["==", ["get", "rail"], 1], ["==", ["get", "primary"], 1]],
            minzoom: 3,
            layout: {
              "symbol-placement": "line",
              "symbol-spacing": 110,
              "text-field": "›",
              "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
              "text-size": 15,
              "text-keep-upright": false,
              "text-allow-overlap": false,
              "text-ignore-placement": false,
              "text-padding": 4,
            },
            paint: {
              "text-color": p.tie,
              "text-halo-color": p.casing,
              "text-halo-width": 1.1,
              "text-opacity": 0.9,
            },
          });
          startRouteFlow();
          // Existing layers keep their old palette after a style switch unless
          // told otherwise — addLayer() is a no-op when the id already exists.
          try {
            map.setPaintProperty("fr_casing", "line-color", p.casing);
            map.setPaintProperty("fr_casing", "line-width", p.casingW);
            map.setPaintProperty("fr_casing", "line-opacity", p.casingO);
            map.setPaintProperty("fr_rail", "line-color", p.line);
            map.setPaintProperty("fr_rail", "line-width", p.lineW);
            map.setPaintProperty("fr_rail", "line-opacity", p.lineO);
            map.setPaintProperty("fr_ties", "line-color", p.tie);
            map.setPaintProperty("fr_ties", "line-width", p.lineW);
            map.setPaintProperty("fr_ties", "line-opacity", p.tieO);
            map.setPaintProperty("fr_conn", "line-color", p.conn);
            // Width too: it used to be a literal, so a restyle never had to
            // carry it. Now it rides the basemap-dependent ramp like the rest.
            map.setPaintProperty("fr_conn", "line-width", p.connW);
            map.setPaintProperty("fr_conn", "line-opacity", p.connO);
            map.setPaintProperty("fr_arrow", "text-color", p.tie);
            map.setPaintProperty("fr_arrow", "text-halo-color", p.casing);
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

          // Sized against the line, not independently of it. A 10px bead on a
          // 1.4px thread is a pin dropped on a route; a 6px one is a call on
          // it. Radius and stroke came down with the line weight so the two
          // still read as one drawing.
          addLayer(map, {
            id: "fs_dot", type: "circle", source: "focus-stops",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3.2, 8, 6.4],
              "circle-stroke-opacity": 0.9,
              "circle-color": p.line,
              "circle-stroke-color": p.casing,
              "circle-stroke-width": 1,
              "circle-opacity": 0.95,
            },
          });
          /*
           * The invisible target the pointer actually hits.
           *
           * The bead above is sized against the route line on purpose — 3.2px
           * of radius at world zoom, 6.4px zoomed in — and that is right for
           * the drawing and hopeless for aiming at. A 3px target needs the
           * cursor placed to within three pixels of a dot that sits ON a line
           * you may also be trying to read; on a phone a fingertip covers the
           * whole neighbourhood and can still miss every stop on the route.
           *
           * So the dot keeps its drawn size and something bigger does the
           * listening. Nothing here is visible (opacity 0 still answers hit
           * tests, unlike `visibility: none`), so the route looks exactly as
           * it did and stops behave like real controls.
           */
          addLayer(map, {
            id: "fs_hit", type: "circle", source: "focus-stops",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 12, 8, 18],
              "circle-color": "#000",
              "circle-opacity": 0,
              "circle-stroke-width": 0,
            },
          });
          // Held back a zoom level: below z5 the dot is ~3.5px and a numeral
          // inside it is illegible anyway, so it was only adding clutter.
          addLayer(map, {
            id: "fs_num", type: "symbol", source: "focus-stops",
            minzoom: 5,
            layout: {
              "text-field": ["get", "n"],
              "text-size": 9,
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
            const showStop = (e: MBEvent) => {
              const hits = e.features ?? [];
              if (!hits.length) return;
              /*
               * Nearest wins, not topmost.
               *
               * Widening the target means neighbouring stops' targets now
               * overlap — three Society Islands calls sit within a thumb's
               * width at world zoom. Mapbox hands back everything under the
               * pointer in render order, so taking [0] would answer a tap on
               * Bora Bora with whichever stop happens to draw last. Longitude
               * is scaled by cos(lat) so the comparison is a real distance and
               * not a Mercator one.
               */
              const f = hits.length === 1 ? hits[0] : hits.reduce((best, cand) => {
                const d = (g: typeof cand) => {
                  const c = g.geometry?.coordinates;
                  if (!c) return Number.POSITIVE_INFINITY;
                  const dy = c[1] - e.lngLat.lat;
                  const dx = (c[0] - e.lngLat.lng) * Math.cos((e.lngLat.lat * Math.PI) / 180);
                  return dx * dx + dy * dy;
                };
                return d(cand) < d(best) ? cand : best;
              });
              if (!f) return;
              // Anchored on the STOP, not on the pointer. The target is now
              // much wider than the dot, so a label placed where the cursor
              // crossed its edge would float in open water next to the call it
              // names.
              const at = f.geometry?.coordinates;
              stopPopup
                .setLngLat(at ?? e.lngLat)
                .setHTML(
                  `<div class="iw"><div class="iwn">${escapeHtml(f.properties.label || "")}</div></div>`,
                )
                .addTo(map);
            };
            map.on("mouseenter", "fs_hit", (e: MBEvent) => {
              map.getCanvas().style.cursor = "pointer";
              showStop(e);
            });
            // mouseenter fires once for the whole layer, so walking the route
            // from stop to stop used to leave the first stop's label up over
            // every one after it. mousemove re-reads whichever stop is under
            // the cursor now.
            map.on("mousemove", "fs_hit", showStop);
            map.on("mouseleave", "fs_hit", () => {
              map.getCanvas().style.cursor = "";
              if (!stopPinned) stopPopup.remove();
            });
            // Touch has no hover at all: before this, tapping a stop on a phone
            // did nothing whatsoever — the numbered dots were decoration there.
            // A tap now names the call and holds it until you tap elsewhere.
            map.on("click", "fs_hit", (e: MBEvent) => {
              stopClickHandled = true;
              stopPinned = true;
              showStop(e);
            });
            // Registered after the delegated handler above, so it sees the flag
            // that click set and knows to leave the fresh label alone.
            map.on("click", () => {
              if (stopClickHandled) { stopClickHandled = false; return; }
              if (!stopPinned) return;
              stopPinned = false;
              stopPopup.remove();
            });
          }
        }

        function clearFocusRoute() {
          setAmbientMuted(false);
          stopRouteFlow(); // nothing traced → nothing to march along
          lastFocusLegs.current = [];
          lastFocusStops.current = [];
          const empty = { type: "FeatureCollection" as const, features: [] };
          if (map.getSource("focus-route")) map.getSource("focus-route")?.setData(empty);
          if (map.getSource("focus-stops")) map.getSource("focus-stops")?.setData(empty);
          stopPinned = false;
          stopPopup.remove();
        }

        /**
         * A wide route cannot be seen on a globe — part of it is always on the
         * far side, or smeared into the limb where a degree of longitude is a
         * pixel. Flatten to mercator for those; a Mediterranean voyage still
         * gets the globe.
         *
         * Measured from the geometry rather than a data flag, because the
         * voyages adapter sets `world: false` for every sailing (only journeys
         * carry the flag), so a world cruise would otherwise be missed.
         *
         * The threshold used to be 180°, i.e. "only flatten for a literal
         * circumnavigation". That is the wrong number twice over. A sphere shows
         * at most a hemisphere, and the outer ~30° of that hemisphere is edge-on
         * — so a grand voyage spanning 150° stayed on the globe, fitBounds gave
         * up trying to frame it, and the route ran off both sides of the disc.
         * This is exactly the "routes cut off on the edges" the world cruise
         * atlas showed and the jet atlas did not: jet expeditions are either
         * regional (comfortably under the gate) or true round-the-world (over
         * the old 180° gate), so they never landed in the broken middle.
         *
         * SPAN_FLAT_LNG is what a globe can actually frame with room to breathe.
         * Latitude gets its own gate for the same reason — a pole-to-pole
         * itinerary is just as unframeable on a sphere as an east-west one.
         */
        const SPAN_FLAT_LNG = 110;
        const SPAN_FLAT_LAT = 100;
        function flattenIfCircumnavigation(legs: { coordinates: [number, number][] }[]): boolean {
          let lo = Infinity, hi = -Infinity, latLo = Infinity, latHi = -Infinity;
          for (const l of legs) for (const c of l.coordinates) {
            if (c[0] < lo) lo = c[0];
            if (c[0] > hi) hi = c[0];
            if (c[1] < latLo) latLo = c[1];
            if (c[1] > latHi) latHi = c[1];
          }
          const wide = hi - lo > SPAN_FLAT_LNG || latHi - latLo > SPAN_FLAT_LAT;
          if (!wide || !projGlobe) return false;
          projGlobe = false;
          setIs3D(false);
          try { map.setProjection("mercator"); } catch { /* projection optional */ }
          return true;
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
          setAmbientMuted(true);
          lastFocusStops.current = stops;
          paintFocusStops(stops, routePalette());
        }

        function fitFocusRoute(rawLegs: { coordinates: [number, number][] }[]) {
          // Any deliberate camera move outranks the idle spin.
          stopSpin();
          /*
           * Frame the points before measuring them.
           *
           * The caller may hand us either a traced route (already framed by
           * paintFocusRoute) or a bare cloud of fallback points. Either way the
           * bounding box has to be computed over ONE longitude window, or a
           * Pacific itinerary measures 540° wide and the camera obediently
           * centres on Africa at minimum zoom. framePoints finds the tightest
           * window by cutting at the widest empty gap.
           */
          const all: [number, number][] = [];
          for (const l of rawLegs) for (const c of l.coordinates) all.push(c);
          const window = framePoints(all);
          const legs = [{ coordinates: window }];
          const flattened = flattenIfCircumnavigation(legs);
          const run = () => {
            try {
              const b = new (mapboxgl as MapboxModule).LngLatBounds();
              let n = 0;
              let only: [number, number] | null = null;
              for (const l of legs) for (const c of l.coordinates) { b.extend(c); only = c; n++; }
              // One point has no bounds. fitBounds on a degenerate box just
              // lands at maxZoom over open country, which for a hotel is the
              // wrong answer — you asked which building, so fly to the building.
              if (n === 1 && only) {
                // Street-level arrival: land at an angle. You asked which
                // building — a plan view of a roof does not answer that.
                map.flyTo({ center: only, zoom: 14, duration: REVEAL_POINT_MS, essential: true, pitch: TILT_PITCH });
                setTilted(true);
              } else if (n) {
                map.fitBounds(b, { padding: fitPad(), maxZoom: 9, duration: REVEAL_MS });
              }
            } catch { /* fit optional */ }
          };
          // A projection swap rebuilds the transform; fitting in the same tick
          // solves the framing for the projection we just left, which lands the
          // camera at the wrong zoom and clips the ends of the route. One frame
          // is enough and is invisible next to the long ease that follows.
          if (flattened) requestAnimationFrame(run);
          else run();
        }

        focusRouteRef.current = {
          paint: paintFocusRoute, clear: clearFocusRoute, fit: fitFocusRoute, mark: markFocusPlace,
          flatten: flattenIfCircumnavigation,
        };

        // Progressive zoom: load route lines on first crossing above ROUTE_ZOOM,
          // then toggle their visibility on subsequent zoom changes.
          map.on("zoomend", () => {
            const z = map.getZoom();
            if (ROUTES_ENABLED && ambientRoutes && z >= routeGate && !routesFetched) {
              loadRoutes();
            } else if (routesFetched) {
              overlayKeys.forEach((key) => {
                const vis = routeVis(z, key);
                ["r_" + key + "_shadow", "r_" + key + "_line"].forEach((id) => {
                  if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
                });
              });
            }
          });
        }

        /**
         * Trace the routes of whatever the Guide just plotted.
         *
         * The home globe shows plotted results as pins. For a hotel that is the
         * whole story; for a 14-night voyage a single dot is not — the itinerary
         * IS the product, and it was the one thing the chat could not show.
         *
         * Deliberately on demand: the ambient all-routes underlay is off (see
         * `ambientRoutes`), and this is the opposite of it — only the trips the
         * traveller was actually offered, drawn in the same visual language as a
         * traced route on a collection page. Geometry comes from D1's
         * precomputed files, fetched per collection only when a result of that
         * type appears, and cached by `loadSeaRoutes` thereafter.
         *
         * Jet is absent on purpose: it ships no precomputed geometry (its routes
         * are arced from stops the Guide result does not carry), so it stays
         * pins-only rather than getting an invented line.
         */
        /*
         * Routes are NOT drawn for plotted results.
         *
         * They were, briefly. On a dense coast — Sicily, the Aeolians, the
         * Tyrrhenian — a handful of voyages puts enough lines over the basemap
         * that the pins you came to read stop being findable, which is the same
         * complaint that turned the ambient underlay off. The home canvas shows
         * WHERE; a collection page shows the itinerary.
         *
         * The id→geometry lookup written for this was removed with it rather
         * than left behind as dead code with a passing test attached — the
         * collection pages resolve their own geometry through sea-geometry.ts
         * and rail-geometry.ts, which is where it belongs.
         */

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
          /*
           * Frame the shortlist on the photoreal engine too.
           *
           * Everything below this line moves the MAPBOX camera. A plot arriving
           * while photoreal is drawing would otherwise pin the results on a
           * hidden map and leave the visible one where it was — the same fault
           * the rail filters had, on the path that matters most, since a plot
           * is the Guide answering a question with specific places.
           */
          threeRef.current?.fit(
            features.map((f) => ({
              id: "",
              name: f.properties.name,
              lng: f.geometry.coordinates[0],
              lat: f.geometry.coordinates[1],
            })),
          );
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
          /*
           * Results are revealed on DAYLIGHT imagery, at whatever altitude the
           * shortlist happens to fit. The zoom rule that governs ordinary
           * browsing is deliberately not consulted here: a plot is the one
           * moment the map stops being ambience, because the traveller is being
           * shown specific places and asked to choose between them, and `dusk`
           * over a Caribbean basin is lit for a mood rather than for reading.
           *
           * Which repaint path runs depends on whether the basemap actually
           * RELOADS. Satellite and Satellite (day) share one Mapbox style URL,
           * so moving between them is a config change and style.load never
           * fires; only a vector basemap (Dark, the two 3D presets) reloads and
           * takes its repaint + re-fit from style.load. Every other case has to
           * paint and fit inline.
           *
           * `restyling` guard: a plot restored during boot could fire setStyle
           * while the FIRST style load was still in flight. Mapbox drops the
           * earlier load's completion, so `restyling` never cleared and every
           * later paint was skipped — a map that draws nothing and does not
           * spin. If a restyle is already running, paint into the current one.
           */
          const reloads = ATLAS_STYLES[styleKeyLocal].url !== ATLAS_STYLES.daylight.url;
          if (!restyling && styleKeyLocal !== "daylight") {
            // "auto": revealing results is the shell's own doing, so it neither
            // counts as the traveller choosing a basemap nor gets remembered.
            // Only when the style actually reloads: otherwise style.load never
            // fires, the fit runs inline below, and a flag left standing would
            // hand the reveal camera to the traveller's NEXT basemap switch.
            restyleIsReveal = reloads;
            api.setStyle("daylight", "auto");
          }
          if (restyling || !reloads) {
            paintFeatured();
            fitFeatured();
          }
        }
        function flushPendingPlot() {
          if (!ready || !pendingPlotRef.current) return;
          const pending = pendingPlotRef.current;
          pendingPlotRef.current = null;
          plotResults(pending);
        }
        /** The trip that arrived while the globe was still loading. */
        function flushPendingRoute() {
          const pending = pendingRouteRef.current;
          if (!ready || !pending) return;
          pendingRouteRef.current = null;
          applyRouteRef.current?.(pending);
        }
        function fitFeatured(ms: number = REVEAL_MS) {
          if (!featuredFC || !featuredFC.features.length) return;
          // Same treatment a traced route gets: one longitude window, then
          // decide whether a globe can hold it. A shortlist straddling the
          // antimeridian is otherwise measured as the whole planet.
          const window = framePoints(
            featuredFC.features.map(
              (f) => [f.geometry.coordinates[0], f.geometry.coordinates[1]] as [number, number],
            ),
          );
          const flattened = focusRouteRef.current?.flatten([{ coordinates: window }]) ?? false;
          const run = () => {
            try {
              const b = new (mapboxgl as MapboxModule).LngLatBounds();
              window.forEach((c) => b.extend(c));
              map.fitBounds(b, { padding: fitPad(), maxZoom: showsHotel ? 10 : 4.8, duration: ms });
            } catch { /* fit optional */ }
          };
          if (flattened) requestAnimationFrame(run);
          else run();
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
        // "click" gets its own line rather than joining the list above. A click
        // that lands on nothing is not a request to stop the idle spin — the
        // globe has always kept turning through one — but it IS unambiguously a
        // visitor with their own intent, which is the whole trigger for the
        // ambient tour standing down. Same reasoning for a keyboard pan: the
        // map is focusable, and arrowing it is interaction the pointer events
        // never see.
        ["click", "keydown"].forEach((ev) => map.on(ev, () => abortTour()));

        // Publish the view so the page can build a Share link from it.
        const reportView = () => {
          try {
            const c = map.getCenter();
            const v = {
              style: styleKeyLocal,
              globe: projGlobe,
              center: { lng: c.lng, lat: c.lat },
              zoom: map.getZoom(),
              // Pitch and bearing ride along so the Share link can reproduce a
              // tilted, rotated view rather than flattening it to plan north-up.
              pitch: map.getPitch(),
              bearing: map.getBearing(),
              // What is actually on screen, as [west, south, east, north].
              // The camera alone cannot answer "which properties am I looking
              // at?" — that depends on the viewport's aspect ratio and pitch —
              // so "Search this area" needs the box, not the centre and zoom.
              bounds: (() => {
                const b = map.getBounds?.();
                return b
                  ? ([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as [number, number, number, number])
                  : null;
              })(),
            };
            viewRef.current = v;
            onViewChangeRef.current?.(v);
          } catch { /* view reporting is never load-bearing */ }
        };
        map.on("moveend", reportView);
        map.on("zoomend", reportView);
        // Pitch and rotation are their own axes — neither fires moveend when
        // changed alone (ctrl-drag, two-finger twist, the Tilt button), so
        // without these the reported view kept a stale camera and the Share
        // link quietly described the previous one.
        map.on("pitchend", reportView);
        map.on("rotateend", reportView);

        // The Tilt button reflects the camera, not just its own clicks: Mapbox
        // also pitches on ctrl-drag and two-finger drag, and a toggle that
        // disagrees with what you're looking at is worse than no toggle.
        // pitchend cannot fire from zooming (pitch is a separate axis), so this
        // stays clear of the zoom loop that broke the earlier attempt.
        map.on("pitchend", () => {
          try { setTilted(map.getPitch() > 5); } catch { /* noop */ }
        });

        ro = new ResizeObserver(() => {
          try {
            map.resize();
            // `!tourActive` matters more than it looks. The tour holds the
            // camera AT homeZoom, so every other clause here passes while it
            // runs — and this observer fires on a panel drag or a sheet
            // detent change, which would re-frame the globe to world centre
            // between two pins. The tour recovers its own framing on finish.
            if (ready && !focused && !subsetActive && !tourActive && projGlobe && map.getZoom() <= homeZoom + 0.4) fitGlobe();
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
            routeReadyRef.current = true;
            clearTimeout(loadTimeout);
            wireHandlers();
            setMapReady(true);
            bootData();
            flushPendingPlot();
            // Last, so the trip a deep link asked for is painted and framed on
            // top of the boot framing rather than under it. bootData's own
            // rest-and-idle stands down while this is still queued.
            flushPendingRoute();
          } else if (restyling) {
            restyling = false;
            // Keep any plotted results in view after a manual basemap switch.
            const reveal = restyleIsReveal;
            restyleIsReveal = false;
            if (subsetActive) fitFeatured(reveal ? REVEAL_MS : REFRAME_MS);
          }
        });

        // First-load boot: the globe fits (and readies its spin) immediately —
        // the feeds were kicked off at mount and each paints the moment it
        // lands, so nothing network-bound holds the camera hostage.
        /**
         * The resting state: world framing plus idle spin.
         *
         * A no-op while the ambient tour owns the camera. bootData reaches the
         * rest-and-idle decision TWICE — once immediately, once after the
         * region feed resolves — and on a slow connection the second pass lands
         * mid-tour, where re-framing would snap the globe home between pins.
         * The tour restores this framing itself when it finishes.
         *
         * Same reasoning, one beat earlier, for the other two guards. The
         * SECOND pass runs when the region feed resolves — a second or two in,
         * by which time a "See on the map" hand-off has usually already traced
         * its trip — so resting there threw the camera off the route and set it
         * spinning. And a route still sitting in the queue is a claim that has
         * not been honoured yet, which is why it counts as one.
         */
        function restAndIdle() {
          if (tourActive || cameraClaimed) return;
          if (pendingRouteRef.current) return;
          fitGlobe();
          spinWhenRevealed();
        }

        async function bootData() {
          ambientPadding(); // camera lives right of the floating Guide panel
          // Restore the last framed subset on the home Living Atlas after a
          // re-mount (Back from a full atlas), so it re-opens on the results the
          // persisted chat still shows rather than the resting globe. A ?region=
          // deep link still wins — that's an explicit destination request.
          const restored = !region && allInventory ? readStoredPlot() : null;
          if (!region && !restored) restAndIdle();

          // A shared link's exact camera wins over any default framing.
          if (arrivedCamera) {
            focused = true;
            try {
              map.flyTo({
                center: [arrivedCamera.lng, arrivedCamera.lat],
                zoom: arrivedCamera.zoom,
                speed: 1.4,
                // Undefined, not 0, when the link omits them: flyTo treats an
                // explicit 0 as "flatten and face north", which would override
                // the collection's own opening pitch on every legacy 3-part
                // link. Absent means "leave this axis alone".
                pitch: arrivedCamera.pitch,
                bearing: arrivedCamera.bearing,
              });
              // Keep the Tilt button honest about the camera it just landed on
              // — pitchend fires from a user gesture, not from this flyTo.
              if (arrivedCamera.pitch != null) setTilted(arrivedCamera.pitch > 5);
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
            else restAndIdle();
          } else {
            // Nothing claimed the camera: no ?region=, no stored plot, no
            // initialCamera. This branch did not exist, so the map came to rest
            // wherever init happened to leave it with no idle motion — which is
            // exactly what "the home map is frozen" looks like. Most reliably
            // hit coming BACK from an atlas, where sessionStorage may hold no
            // plot and the region param is gone.
            restAndIdle();
          }
        }

        // Imperative API the control buttons drive.
        const api: AtlasApi = {
          setStyle(key, source = "user") {
            // Already known bad this session — don't spend another 4s finding
            // out. plotResults asks for Satellite (day) on every plot. Resolved
            // before the pick is recorded, so a broken style is never the thing
            // we remember and re-break on at the next atlas.
            if (failedStyles.has(key)) key = STYLE_FALLBACK_KEY;
            if (source === "user") {
              // Picking a basemap by hand ends the automatic light switching for
              // the session, and is remembered across atlases (STYLE_STORAGE_KEY).
              // Both recorded before the no-op return below, so choosing the
              // style you are already on still counts as choosing it.
              autoLight = false;
              writeStoredStyle(key);
            }
            if (key === styleKeyLocal) return;
            const from = ATLAS_STYLES[styleKeyLocal];
            const to = ATLAS_STYLES[key];
            styleKeyLocal = key;
            setStyleKey(key);
            /*
             * Two basemaps can share a style URL and differ only in config —
             * Satellite / Satellite (Day) are one Mapbox style under two light
             * presets, as are Dusk / 3D Buildings (Day). setStyle with the URL
             * already loaded is a no-op, so style.load never fires and the new
             * preset is never applied: the menu ticks the new entry and the map
             * doesn't change. Reconfigure in place instead.
             */
            if (to.url === from.url) {
              const cfg = map as unknown as {
                setConfigProperty(s: string, k: string, v: string | boolean): void;
              };
              setFog(map, to.fog);
              try { if (to.light) cfg.setConfigProperty("basemap", "lightPreset", to.light); } catch { /* not Standard */ }
              try { if (to.theme) cfg.setConfigProperty("basemap", "theme", to.theme); } catch { /* unsupported */ }
              try { cfg.setConfigProperty("basemap", "show3dObjects", to.objects3d !== false); } catch { /* not Standard */ }
              // The route palette keys off the basemap; repaint what's traced.
              if (lastFocusLegs.current.length) {
                focusRouteRef.current?.paint(lastFocusLegs.current, lastFocusStops.current);
              }
              reportView();
              return;
            }
            restyling = true;
            try { map.setStyle(to.url); } catch { restyling = false; }
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
              /*
               * Switching projection is not a request to go home.
               *
               * This used to call fitGlobe() on every switch back to the globe,
               * so a traveller looking at a hotel in Kyoto who flipped flat and
               * back was thrown out to the whole planet — the toggle silently
               * doubled as a reset, and there was no way to see the same place
               * on a sphere. Only re-fit when the camera is ALREADY at rest at
               * world scale (nothing framed, nothing focused, still at home
               * zoom), which is the one case where re-fitting changes nothing
               * the traveller chose and simply restores the idle spin.
               */
              const atRest = !subsetActive && !focused && map.getZoom() <= homeZoom + 0.4;
              if (atRest) { fitGlobe(); startSpin(); }
            } else {
              stopSpin();
            }
          },
          setTilt(on) {
            setTilted(on);
            try {
              map.easeTo({ pitch: on ? TILT_PITCH : 0, duration: 550, essential: true });
            } catch { /* pitch optional */ }
          },
          resize() {
            setTimeout(() => { try { map.resize(); } catch { /* noop */ } }, 60);
          },
          plot(meta) {
            if (!ready) {
              pendingPlotRef.current = meta;
              return;
            }
            plotResults(meta);
          },
          refit() {
            ambientPadding(); // panel opened/closed/resized — recenter ambient camera
            if (subsetActive) fitFeatured(REFRAME_MS);
          },
          resetView() {
            subsetActive = false;
            featuredFC = null;
            // Any traced route belongs to what is being cleared.
            focusRouteRef.current?.clear();
            try { sessionStorage.removeItem(PLOT_STORAGE_KEY); } catch { /* storage optional */ }
            setBadge(null);
            stopPulse();
            if (map.getSource("featured")) {
              ["featured-pulse", "featured-glow", "featured-dot"].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
              try { (map as MBMap).removeSource("featured"); } catch { /* noop */ }
            }
            paintHotel(); // restore full ambient opacity
            ambientPadding();
            // Starting the session over hands the camera back to the ambience —
            // the one path that releases the claim stopSpin latched.
            cameraClaimed = false;
            pendingRouteRef.current = null;
            if (projGlobe) { focused = false; fitGlobe(); startSpin(); }
          },
          applyLayers() {
            const z = map.getZoom();
            for (const { key } of LEGEND) {
              const off = hiddenRef.current.has(key);
              for (const id of layerIdsFor(key)) {
                if (!map.getLayer(id)) continue;
                // Route layers answer to the zoom gate as well as the legend;
                // point layers answer to the legend alone.
                const vis = id.startsWith("r_")
                  ? routeVis(z, key)
                  : off ? "none" : "visible";
                try { map.setLayoutProperty(id, "visibility", vis); }
                catch { /* mid-restyle: layers momentarily gone */ }
              }
            }
          },
        };
        apiRef.current = api;

        /*
         * Auto daylight, driven by altitude. See AUTO_DAYLIGHT_IN / _OUT.
         *
         * On `zoomend`, not `zoom`: the preset swap should land once, on a
         * camera at rest, rather than strobe through the middle of a wheel
         * gesture or a flyTo. That also makes this free for the case it was
         * asked for — the Guide plots a shortlist, fitFeatured flies to it, and
         * the single zoomend at the end of that ease brings the lights up.
         *
         * Both guards matter. `autoLight` is off once the traveller has used
         * the Style menu. The SATELLITE_KEYS check keeps this off the vector
         * basemaps entirely: Dark and the two 3D presets have their own
         * identities and are nobody's idea of "satellite, but lit".
         */
        const syncAutoLight = () => {
          if (!autoLight || restyling || !ready) return;
          // While a Guide shortlist is framed, the light belongs to the plot and
          // not to the camera. plotResults puts the map on daylight at whatever
          // altitude the results fit, so without this the zoomend at the end of
          // its own fit would immediately drag a basin-wide shortlist back to
          // dusk. resetView clears subsetActive and hands the camera back.
          if (subsetActive) return;
          if (!SATELLITE_KEYS.has(styleKeyLocal)) return;
          const z = map.getZoom();
          if (z >= AUTO_DAYLIGHT_IN && styleKeyLocal === "satellite") {
            api.setStyle("daylight", "auto");
          } else if (z <= AUTO_DAYLIGHT_OUT && styleKeyLocal === "daylight") {
            api.setStyle("satellite", "auto");
          }
        };
        map.on("zoomend", syncAutoLight);
      })
      .catch(() => setMapFailed(true));

    return () => {
      cancelled = true;
      cancelAnimationFrame(spinRAF);
      cancelAnimationFrame(pulseRAF);
      stopFlowRef.current?.();
      stopFlowRef.current = null;
      clearTimeout(loadTimeout);
      clearTimeout(styleWatchdog);
      clearTimeout(tourTimer);
      clearTimeout(tourPaintTimer);
      clearTimeout(settleTimer);
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
      if (!meta) return;
      const api = apiRef.current;
      if (api) api.plot(meta);
      else pendingPlotRef.current = meta;
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
    const applyRoute = (detail: RouteDetail | undefined) => {
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
    applyRouteRef.current = applyRoute;
    /**
     * Hold the route until the globe can draw it, instead of losing it.
     *
     * "Ready" means style.load has run: `focusRouteRef` is filled the moment
     * the Mapbox module resolves, but addSource/addLayer before the first
     * style.load throws, so the api existing is not the same as the map being
     * paintable. Both gates, one queue, flushed from the ready block.
     *
     * Later wins, with one exception: a queued fit (the deep link that opened
     * the page) is not demoted by a hover preview that happens to land while
     * the map is still booting. The traveller asked for this trip; a pointer
     * crossing the card grid on the way to it did not un-ask.
     */
    /**
     * The same camera instruction, for the photoreal engine.
     *
     * `applyRoute` above moves the MAPBOX camera, and it is gated on
     * `focusRouteRef` — which needs style.load. Neither fact is true of the
     * photoreal engine, so while it was drawing, every re-framing the page
     * asked for (a rail filter, a search, "Search this area", a deep link)
     * moved a hidden map and left the visible one exactly where it was: pins
     * updated underneath a camera that never went to them.
     *
     * Self-gating: `threeRef.current` is non-null only while Atlas3DLayer is
     * mounted, which is precisely when photoreal is on.
     *
     * A single point is NOT special-cased away. It is tempting, because a
     * selection also flies the camera and would override this — but a filter
     * that narrows to one property (searching a hotel by name) has no
     * selection, and that is the case the traveller reported.
     */
    const applyRouteTo3D = (detail: RouteDetail | undefined) => {
      const three = threeRef.current;
      if (!three || !detail?.fit) return;
      const pts: Point3D[] = [];
      const add = (lng: number, lat: number) => {
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          pts.push({ id: "", name: "", lng, lat });
        }
      };
      if (detail.fitPoints?.length) {
        for (const [lng, lat] of detail.fitPoints) add(lng, lat);
      } else {
        for (const leg of detail.legs ?? []) {
          for (const [lng, lat] of leg.coordinates ?? []) add(lng, lat);
        }
      }
      if (!pts.length) return;
      /*
       * A framing for something being SELECTED is not ours to fly.
       *
       * Selecting a hotel emits this route and then flies the engine to the
       * building, in that order — so framing here first teleported the camera
       * onto the property at 3.4 km and left the arrival flight with nowhere to
       * come from. Two flights the traveller reads as one clipped move, and the
       * arrival, which times itself by how far it has to travel, measured zero
       * distance every time and so always took the shortest flight there is.
       *
       * The page says which it is, rather than this inferring it from
       * `selectedId`: the route is dispatched in the same tick as the selection
       * state is set, so the ref still holds the PREVIOUS selection when this
       * runs, and every comparison against it misses.
       *
       * Still framed when nothing is being selected: a filter that narrows to
       * one property (searching a hotel by name) has no arrival flight coming,
       * and that is the case the traveller reported.
       */
      if (detail.selecting) return;
      three.fit(pts);
    };

    const onRoute = (e: Event) => {
      const detail = ((e as CustomEvent).detail ?? undefined) as RouteDetail | undefined;
      // Independent of the Mapbox path and of its readiness gate: the photoreal
      // engine can be the one on screen while Mapbox has not finished (or has
      // failed) loading at all.
      applyRouteTo3D(detail);
      if (routeReadyRef.current && focusRouteRef.current) {
        applyRoute(detail);
        return;
      }
      const empty =
        !detail?.legs?.length && !detail?.stops?.length && !detail?.fitPoints?.length;
      if (empty) return; // a clear with nothing painted yet is a no-op
      const queued = pendingRouteRef.current;
      if (queued?.fit && !detail?.fit) return;
      pendingRouteRef.current = detail ?? null;
    };
    // The popup's "See it in 3D" is injected HTML, so it has no React handler.
    // Delegate once rather than re-wiring on every popup open.
    const on3d = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-hotel3d]");
      const id = el?.getAttribute("data-hotel3d");
      if (id) hotel3dOpened(id, "popup");
    };
    /*
     * "Ask The Guide" in a popup, by the same delegation.
     *
     * Popups are injected HTML, so the question is carried on the element as
     * `data-ask` and sent from here. It goes to the chat mounted on this page
     * when there is one, and falls back to the home page's `?ask=` otherwise —
     * so the same markup works on the atlas (chat present) and on the home
     * globe (chat present in the split) without either knowing which it is.
     */
    /*
     * A popup's "Property details & 3D" where the engine is on this page.
     *
     * Selecting rather than navigating is the whole point: the pin, the card
     * list and the dossier share one selection, so opening a property from the
     * map lands in the same state as pressing details on its card. This is the
     * disclosing path — a tap on the pin itself only selects.
     */
    const onOpenProperty = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-hotel-open]");
      const id = el?.getAttribute("data-hotel-open");
      const wiring = photorealRef.current;
      if (!id || !wiring) return;
      e.preventDefault();
      wiring.onEngineChange("photoreal");
      wiring.onOpenDetail(id);
    };
    const onAsk = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-ask]");
      const text = el?.getAttribute("data-ask");
      if (!text) return;
      e.preventDefault();
      if (!askGuide(text, "pin")) window.location.assign(askGuideHref(text, `${type}-pin`));
    };
    document.addEventListener("click", on3d);
    document.addEventListener("click", onOpenProperty);
    document.addEventListener("click", onAsk);
    window.addEventListener("bevvip:atlas-route", onRoute as EventListener);
    window.addEventListener("bevvip:atlas-plot", onPlot as EventListener);
    window.addEventListener("bevvip:atlas-reset", onReset as EventListener);
    window.addEventListener("bevvip:atlas-refit", onRefit);
    return () => {
      applyRouteRef.current = null;
      document.removeEventListener("click", on3d);
      document.removeEventListener("click", onOpenProperty);
      document.removeEventListener("click", onAsk);
      window.removeEventListener("bevvip:atlas-route", onRoute as EventListener);
      window.removeEventListener("bevvip:atlas-plot", onPlot as EventListener);
      window.removeEventListener("bevvip:atlas-reset", onReset as EventListener);
      window.removeEventListener("bevvip:atlas-refit", onRefit);
    };
    // allInventory is no longer read here, but the effect stays keyed to it so
    // a scope change re-registers cleanly.
  }, [allInventory, type]);

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

  /**
   * Share this view. Home globe only — see `selfShare`.
   *
   * Writes the live basemap, projection and camera onto the URL the traveller
   * is already on, preserving anything else in the query string.
   *
   * Native sheet where there is one (phones), clipboard otherwise, and the URL
   * bar as the last resort when the clipboard is blocked — the same ladder
   * VillaAtlas uses, so the gesture matches across surfaces.
   */
  async function shareView() {
    const url = new URL(window.location.href);
    const v = viewRef.current;
    if (v) {
      setViewParams(url.searchParams, {
        style: v.style,
        flat: !v.globe,
        camera: { lng: v.center.lng, lat: v.center.lat, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing },
      });
    }
    const href = url.toString();
    const confirmCopied = () => {
      setShared(true);
      window.setTimeout(() => setShared(false), 2000);
    };
    if (navigator.share) {
      try { await navigator.share({ title: document.title || "Atlas", url: href }); }
      catch { /* user dismissed the sheet */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(href);
      confirmCopied();
    } catch {
      // Clipboard blocked: put it where it can still be copied by hand, and
      // don't push a history entry for what is not a navigation.
      window.history.replaceState(null, "", href);
      confirmCopied();
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

  // Resize the globe after the panel grows/shrinks for fullscreen. Two frames,
  // not one: on iOS the CSS fill is the only fullscreen we get, and 100dvh
  // settles a frame after the class lands (URL bar / safe areas), so a single
  // synchronous resize measures the old box and leaves a letterboxed canvas.
  useEffect(() => {
    const a = requestAnimationFrame(() => {
      apiRef.current?.resize();
      requestAnimationFrame(() => apiRef.current?.resize());
    });
    return () => cancelAnimationFrame(a);
  }, [isFull]);

  /**
   * The legend is a SOLO control, not seven independent switches.
   *
   * Hiding one collection out of seven barely changes a globe with 2,501
   * hotels on it — nobody browsing the home map wants "everything except the
   * jets". What they want is "just the yachts", and reaching that through
   * toggles cost six clicks. So a click isolates: the row you press stays, the
   * rest go. Pressing the isolated row again (or "Show all") brings them back,
   * which keeps the gesture reversible with the same finger that made it.
   *
   * `hidden` remains the single source of truth exactly as before — solo is
   * only a different way of computing it — so every repaint path that already
   * reads hiddenRef (style.load, the route gate, ambient muting) keeps working
   * untouched.
   */
  function soloLayer(key: string) {
    setHidden((prev) => {
      const isSolo = !prev.has(key) && prev.size === legendKeys.length - 1;
      return isSolo ? new Set() : new Set(legendKeys.filter((k) => k !== key));
    });
  }

  function showAllLayers() {
    setHidden(new Set());
  }

  // Push the legend's state onto the map. An effect rather than a call inside
  // the click handler because `hidden` is set functionally above — the handler
  // does not know what it produced, and the map must follow the state that
  // actually landed.
  useEffect(() => {
    apiRef.current?.applyLayers();
  }, [hidden]);

  const showFallback = !token || mapFailed;
  // Every collection, always — see the note on the legend below. On a
  // single-category atlas route only that category is plotted, so the legend
  // narrows to it; on the home globe it is the full canonical list.
  const legendRows = scope === "all" ? LEGEND : LEGEND.filter((it) => it.key === type);
  const legendKeys = legendRows.map((it) => it.key);
  /**
   * The one collection currently isolated, if any — derived from `hidden`
   * rather than stored, so there is still exactly one source of truth and no
   * way for a "soloed" highlight to disagree with what the globe is drawing.
   */
  const soloKey =
    legendKeys.length > 1 && hidden.size === legendKeys.length - 1
      ? legendKeys.find((k) => !hidden.has(k)) ?? null
      : null;

  return (
    <div ref={shellRef} className={`atlas-map${isFull ? " fs" : ""}${photorealOn ? " photoreal" : ""}`}>
      {token && !mapFailed && <div ref={mapEl} className="atlas-canvas" />}
      {/*
        The photoreal engine draws in the same box as the Mapbox canvas, which
        stays mounted (and hidden by .atlas-map.photoreal) underneath. Keyed on
        nothing: this mounts and unmounts with the engine choice, and the Google
        element owns its own tiles either way.
      */}
      {photorealOn && photoreal && (
        <Atlas3DLayer
          ref={threeRef}
          points={photoreal.points}
          selectedId={photoreal.selectedId}
          onSelect={photoreal.onSelect}
          initialCamera={threeCameraRef.current}
          onUnavailable={onThreeUnavailable}
          onReady={() => {
            setThreeReady(true);
            mapEngineChosen(type, "photoreal", true);
            /*
             * With no Mapbox map there was no camera to carry across, so the
             * engine opened on the default whole-earth view — which is the one
             * altitude photoreal tiles are worth nothing at. Frame what the
             * filters actually match instead.
             */
            if (!mapRef.current) threeRef.current?.fit(photoreal.points);
          }}
        />
      )}
      {photorealOn && !threeReady && (
        <div className="atlas-3d-boot">
          <span className="badge">Photoreal 3D</span>
          <p>Rendering the buildings themselves — a moment while the tiles arrive.</p>
        </div>
      )}
      {engineNote && (
        <div className="atlas-3d-note" role="status">
          {engineNote}
          <button type="button" onClick={() => setEngineNote(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {token && !mapFailed && !bootGone && (
        <div
          className={`atlas-boot${mapReady ? " out" : ""}`}
          onTransitionEnd={() => setBootGone(true)}
        >
          <span className="badge">
            {region ? `Region · ${region}` : allInventory ? "The Atlas" : ATLASES[type].label}
          </span>
          {/* The Guide is a guide, and every guide worth carrying says this on
              the cover — in large friendly letters. */}
          <p className="atlas-boot-hail">Don&rsquo;t Panic</p>
          {/* "atlas", not "globe": the jets and some regions open in mercator, and
              a line that promises a globe over a flat map is a small lie. */}
          <p>The Guide is spinning up the atlas. Your tour begins in a moment.</p>
        </div>
      )}

      {showFallback && photorealOn && (
        <div className="atlas-ctrls" onClick={(e) => e.stopPropagation()}>
          {/* Mapbox is unavailable, so the only honest control is the one that
              leaves this engine — and it goes back to the fallback panel, not
              to a map that is not there. */}
          <button
            type="button"
            className="actrl on"
            onClick={() => setEngineChoice("mapbox")}
            title="Leave the photoreal view"
          >
            ✕ Exit 3D
          </button>
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
              <i className="sw" style={{ background: photorealOn ? "#caa44e" : ATLAS_STYLES[styleKey].sw }} />{" "}
              {photorealOn ? "3D" : "Style"}
            </button>
            {menuOpen && (
              <div className="actrl-menu" role="menu">
                {(Object.keys(ATLAS_STYLES) as StyleKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitem"
                    className={!photorealOn && k === styleKey ? "active" : ""}
                    onClick={() => {
                      // Picking a basemap while photoreal is drawing means
                      // "show me that basemap" — so it comes back to Mapbox
                      // rather than silently restyling a hidden canvas.
                      if (photorealOn) setEngineChoice("mapbox");
                      apiRef.current?.setStyle(k);
                      setMenuOpen(false);
                    }}
                  >
                    <i className="sw" style={{ background: ATLAS_STYLES[k].sw }} />
                    {ATLAS_STYLES[k].label}
                  </button>
                ))}
                {/*
                  The engine, under its own heading.

                  It sits in the style menu because that is where someone looks
                  for "make the map look different", and it is separated because
                  it is not one of the choices above: the entries above change
                  what Mapbox paints, this changes which renderer is painting.
                  Real photogrammetry of the actual building is a different kind
                  of thing from a basemap, and the menu should not imply
                  otherwise.
                */}
                {photoreal && (
                  <>
                    <div className="actrl-menu-cap">Engine</div>
                    <button
                      type="button"
                      role="menuitem"
                      className={photorealOn ? "active" : ""}
                      onClick={() => setEngineChoice("photoreal")}
                      title="Google Photorealistic 3D — the real building, in photogrammetry mesh"
                    >
                      <i className="sw" style={{ background: "#caa44e" }} />
                      Photoreal 3D
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          {/*
            Two controls, two axes, each named for what it does.

            The old single button said "2D"/"3D" and toggled globe⇄flat. Both
            halves misled: "3D" bought you a sphere seen straight down, and
            pressing it threw the camera back out to the whole planet. Now the
            projection button names the shape it switches TO (Globe / Flat) and
            keeps your place, and tilt — the thing people actually mean by 3D —
            is its own toggle that lights up while it's on.
          */}
          {/*
            Projection and tilt act on the Mapbox camera, so they are hidden
            while photoreal is drawing — a globe⇄flat toggle over an engine
            that has neither projection is a control that lies. Photoreal gets
            the one control it needs instead: a way back.
          */}
          {photorealOn ? (
            <button
              type="button"
              className="actrl on"
              onClick={() => setEngineChoice("mapbox")}
              title="Back to the Mapbox map, keeping this view"
            >
              ◍ Exit 3D
            </button>
          ) : (
            <>
              <button
                type="button"
                className="actrl"
                onClick={() => apiRef.current?.setProjection(!is3D)}
                title={is3D ? "Show the world flat, keeping this view" : "Show the world as a globe, keeping this view"}
              >
                {is3D ? "▭ Flat" : "◍ Globe"}
              </button>
              <button
                type="button"
                className={`actrl${tilted ? " on" : ""}`}
                aria-pressed={tilted}
                onClick={() => apiRef.current?.setTilt(!tilted)}
                title={
                  tilted
                    ? "Look straight down"
                    : "Tilt the camera — zoom into a city on a 3D basemap to see buildings"
                }
              >
                ◮ Tilt
              </button>
            </>
          )}
          {/*
            Home globe only. Last in the stack, because it is the only control
            that acts on the view rather than changing it — everything above
            rearranges what you are looking at, this one sends it.

            The collection atlases deliberately have no Share here: theirs lives
            in the filter rail, next to the filters that make up most of what a
            shared link means. Two buttons for one link is one too many.
          */}
          {selfShare && (
            <button
              type="button"
              className="actrl"
              onClick={shareView}
              title="Share this view — the link carries the basemap and the camera"
            >
              {shared ? "✓ Link copied" : "Share"}
            </button>
          )}
        </div>
      )}

      {/* The legend used to render only the layers whose feed had finished
          loading, so it described a different product on every page load —
          five collections on a slow connection, seven on a fast one. It now
          always lists all of them; the ones still in flight read as loading
          rather than silently not existing. Caption was "Tap to hide", an
          instruction used as a heading that named one direction of a toggle;
          the pressed state carries that meaning now, for screen readers too. */}
      {!showFallback && showLegend && legendRows.length > 0 && (
        <>
          {/* Phones only (CSS hides it above 680px). The panel itself is worth
              the top-left corner on a desktop map and is not worth it on a
              360px one, so there it collapses to a pill that opens the same
              rows as a bottom sheet — the pattern the hotel atlas already
              uses for filters and details. */}
          {/* Only where there is a choice to make. A single-collection atlas's
              legend is one colour swatch — turning that into a pill you have
              to open is more chrome than the thing it hides. */}
          {legendRows.length > 1 && (
          <button
            type="button"
            className={`atlas-legend-pill${legendOpen ? " on" : ""}`}
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((v) => !v)}
            title="Collections on the map"
          >
            <i style={{ background: (legendRows.find((it) => it.key === soloKey) ?? legendRows[0]).color }} />
            {soloKey ? legendRows.find((it) => it.key === soloKey)!.label : "Layers"}
          </button>
          )}
          {legendOpen && (
            <div
              className="atlas-legend-scrim"
              onClick={() => setLegendOpen(false)}
              aria-hidden="true"
            />
          )}
          <div
            className={`atlas-legend${legendOpen ? " open" : ""}${legendRows.length > 1 ? " sheeted" : ""}`}
          >
            <div className="lgsheet-handle" aria-hidden="true"><span /></div>
            <div className="lgcap">Collections</div>
            {legendRows.map((it) => {
              const pending = !loaded.has(it.key);
              const off = hidden.has(it.key);
              const solo = soloKey === it.key;
              return (
                <button
                  key={it.key}
                  type="button"
                  className={`lgi${off ? " off" : ""}${solo ? " solo" : ""}${pending ? " pending" : ""}`}
                  aria-pressed={solo}
                  disabled={pending}
                  onClick={() => soloLayer(it.key)}
                  title={
                    pending
                      ? "Still loading"
                      : solo
                        ? "Show every collection again"
                        : `Show only ${it.label}`
                  }
                >
                  <i style={{ background: it.color }} />
                  <span>{it.label}</span>
                </button>
              );
            })}
            {/* The way back, always present rather than only while something is
                isolated: a control that appears and disappears is one people
                have to rediscover. Disabled when there is nothing to undo. */}
            {legendRows.length > 1 && (
              <button
                type="button"
                className="lgall"
                onClick={showAllLayers}
                disabled={!hidden.size}
              >
                Show all
              </button>
            )}
          </div>
        </>
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

      {showFallback && !photorealOn && (
        <div className="fallback">
          <span className="badge">{region ? `Region · ${region}` : "All inventory"}</span>
          <p>
            Map unavailable right now. The full {ATLASES[type].label.toLowerCase()} is one
            click away — your selection carries over.
          </p>
          {/*
            The two engines fail independently — Mapbox being down says nothing
            about Google's photoreal tiles — and this panel is the one place the
            map is actually missing. Hiding the working engine here because the
            broken one owns the toolbar would be the same mistake, one level
            down, that put photoreal behind an iframe in the first place.
          */}
          {photoreal && (
            <button
              type="button"
              className="atlas-cta"
              onClick={() => setEngineChoice("photoreal")}
            >
              Show it in photoreal 3D →
            </button>
          )}
          <a className="atlas-cta" href={externalLink}>
            Open the {ATLASES[type].label.toLowerCase()} →
          </a>
          <div className="region-chips">
            {ATLASES[type].sampleRegions.map((r) => (
              <a
                key={r}
                className="chip"
                href={internalAtlasLink(type, atlasRegionQuery(r))}
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
  // "sailings", not "charters": these are sold by the cabin like any other
  // cruise. See INTENTS in lib/atlas-config.ts.
  return `Luxury Hotel Yachts${count ? ` · ${count} sailings` : ""}`;
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
// Deep links are usually RELATIVE ("/atlas/hotel?hotel=h_001") because the
// atlas links default to in-app routes; only an external deploy makes them
// absolute.
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

/* ── Route flow: the direction of travel, drawn ────────────────────────────
 *
 * A traced itinerary is ordered — Southampton to Sydney, not "these ports" —
 * and a static line throws that away. It says where the voyage goes and not
 * which way along it you travel, so a round trip and a one-way crossing look
 * identical.
 *
 * Mapbox GL has no line-dash-offset, so the phase is animated the only way the
 * renderer allows: by swapping the dash array itself for one whose pattern
 * starts a little further along. Sliding the phase forward makes the breaks
 * march from the first coordinate toward the last, which IS the direction of
 * travel — the adapters emit stops in itinerary order.
 *
 * Units are line-width multiples, so the rhythm holds at every line weight.
 */
const TIE_DASH = 2.2; // the brighter travelling segment
const TIE_GAP = 11; // the line between marks — roughly five parts line to one mark
const FLOW_STEPS = 24; // phases per cycle; more is smoother and no cheaper
const FLOW_MS = 55; // ms per phase → a full period every ~1.3s

/**
 * The dash array for phase `step`, as an EVEN-length array.
 *
 * Even length matters: Mapbox repeats the array verbatim, so an odd-length one
 * inverts dash and gap on every other repeat and the line visibly flickers
 * between "mostly colour" and "mostly black".
 *
 * DIRECTION. `t` is how far into the pattern the line starts, and a dash then
 * sits at every `nP - t` along the path — so as t grows the marks slide BACK
 * toward the start. Running the phase forward therefore animates the route
 * backwards, which is what it did. Counting t down instead sends the marks the
 * way you travel. (The Leaflet atlases animate stroke-dashoffset negative,
 * which is already the forward direction — the sign convention is inverted
 * between the two, which is exactly how this went unnoticed.)
 */
function dashPhase(step: number): number[] {
  const period = TIE_DASH + TIE_GAP;
  const back = (FLOW_STEPS - (((step % FLOW_STEPS) + FLOW_STEPS) % FLOW_STEPS)) % FLOW_STEPS;
  const t = (back / FLOW_STEPS) * period;
  if (t <= TIE_DASH) {
    // Starting part-way through a tick: [partial tick, gap, tick, gap].
    return [TIE_DASH - t, TIE_GAP, TIE_DASH, TIE_GAP + t];
  }
  // Starting part-way through the colour: lead with a zero-length dash.
  const into = t - TIE_DASH;
  return [0, TIE_GAP - into, TIE_DASH, TIE_GAP, TIE_DASH, into];
}

/**
 * The VIP rate search URL for one hotel, or null.
 *
 * Memoised per id for the life of the page: the overlay it reads is a
 * build-time artifact, so re-clicking a pin must not re-hit the network. In-
 * flight promises are cached too, so double-clicking a pin makes one request.
 *
 * Failures resolve to null rather than rejecting — the caller's job is to
 * decide whether to render a link, not to handle transport errors.
 */
const RATE_LINKS = new Map<string, Promise<{ url: string; label: string; note?: string } | null>>();
function hotelRateLink(
  id: string,
  name: string,
): Promise<{ url: string; label: string; note?: string } | null> {
  const cached = RATE_LINKS.get(id);
  if (cached) return cached;
  const pending = fetch(`/api/hotel/tw?ids=${encodeURIComponent(id)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(
      (j: {
        tw?: Record<string, unknown>;
        bookUrl?: Record<string, string>;
        bookPassword?: Record<string, string>;
      }) => {
        const tw = j.tw?.[id];
        const portal = j.bookUrl?.[id];
        if (!tw && !portal) return null;
        // bookingLink picks the rate search when there's an identity to search
        // with, and the gated portal otherwise — and labels each honestly, so
        // the popup never promises a price it can't reach.
        const link = bookingLink(
          {
            type: "hotel",
            id,
            name,
            ...(tw ? { tw } : {}),
            ...(portal ? { bookUrl: portal } : {}),
            ...(j.bookPassword?.[id] ? { bookPassword: j.bookPassword[id] } : {}),
          },
          getTrip(),
        );
        return link?.url
          ? { url: link.url, label: link.label, ...(link.note ? { note: link.note } : {}) }
          : null;
      },
    )
    .catch(() => {
      RATE_LINKS.delete(id); // transient — let the next click try again
      return null;
    });
  RATE_LINKS.set(id, pending);
  return pending;
}

function featuredHtml(r: OfferingResult, kind: OfferingType, esc: (s: string) => string): string {
  const meta = [r.brand || r.operator, (r as { ship?: string }).ship, r.region].filter(Boolean).join(" · ");
  const when = [r.duration || r.country, r.dates || (r as { month?: string }).month].filter(Boolean).join("  ·  ");
  const href =
    toInternalAtlasHref(r.deepLink) ||
    internalAtlasLink(kind, atlasRegionQuery(r.region));
  /*
   * A plotted HOTEL gets the photoreal handoff, same as a hotel pin.
   *
   * These are two different popup renderers — this one for Guide results, the
   * hotel-dots handler for the ambient field — and only the latter had the 3D
   * button. So the most persuasive view in the product was reachable from a
   * hotel you found by browsing, and not from one the Guide recommended, which
   * is backwards: the recommended one is the one being sold.
   */
  const id = String((r as { id?: unknown }).id ?? "");
  const three =
    kind === "hotel" && id
      ? `<a class="iw3d" data-hotel3d="${esc(id)}" href="/atlas/hotel?hotel=${encodeURIComponent(id)}" target="_blank" rel="noopener" title="Full profile: description, ratings, address, VIP benefits and rates — with the photoreal 3D view">Property details &amp; 3D ↗</a>`
      : "";
  /*
   * And a way to ask about it.
   *
   * This popup is a property The Guide just recommended, and until now the only
   * things you could do with it were open an atlas or (for hotels) the photoreal
   * view. Not "tell me more about this one" — on the pin for the thing being
   * SOLD, which is the likeliest question in the product.
   */
  const ask = esc(
    askAboutPin({
      name: r.name || "this",
      region: r.region,
      country: (r as { country?: string | null }).country ?? null,
      brand: r.brand || r.operator,
    }),
  );
  return (
    `<div class="iw"><div class="iwn">${esc(r.name || "Recommendation")}</div>` +
    `<div class="iwm">${esc([meta, when].filter(Boolean).join("  ·  "))}</div>` +
    three +
    `<a href="${esc(href)}">Open on the atlas →</a>` +
    `<button type="button" class="iwask" data-ask="${ask}">✦ Ask The Guide</button></div>`
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
        //
        // The SAME geodesic the traced route uses (see AtlasJet's routeFor).
        // These two paths draw the same flights — this one as the ambient
        // underlay, that one when a card is hovered — so a difference in
        // geometry here would show up as the route visibly jumping off its own
        // underlay the moment you pointed at it.
        const frame = unrollLine(pts);
        const out: LngLat[] = [];
        for (let i = 0; i < frame.length - 1; i++) {
          const seg = geodesicLine(frame[i], frame[i + 1]);
          for (let k = out.length ? 1 : 0; k < seg.length; k++) {
            out.push(seg[k]);
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
  on(type: string, cb: () => void): MBPopup;
  setLngLat(c: { lng: number; lat: number } | readonly [number, number]): MBPopup;
  setHTML(html: string): MBPopup;
  addTo(map: MBMap): MBPopup;
  isOpen(): boolean;
  remove(): void;
}
interface MBBounds {
  // readonly, so a branded LngLat from lib/atlas/geo.ts passes without a cast.
  extend(c: readonly [number, number]): MBBounds;
}
interface MBMap {
  on(type: string, layerOrCb: string | ((e: MBEvent) => void), cb?: (e: MBEvent) => void): void;
  once(type: string, cb: (e?: MBEvent) => void): void;
  /** False while any tile in the current view is still in flight. */
  areTilesLoaded?(): boolean;
  getZoom(): number;
  getMinZoom(): number;
  getCenter(): { lng: number; lat: number };
  /** Optional: absent on the fallback stubs, so every caller guards with `?.`. */
  getBounds?(): {
    getWest(): number; getSouth(): number; getEast(): number; getNorth(): number;
  } | null;
  setCenter(c: { lng: number; lat: number }): void;
  setZoom(z: number): void;
  flyTo(opts: {
    center: readonly [number, number];
    zoom: number;
    speed?: number;
    duration?: number;
    essential?: boolean;
    pitch?: number;
    bearing?: number;
  }): void;
  easeTo(opts: {
    center?: readonly [number, number];
    pitch?: number;
    zoom?: number;
    duration?: number;
    essential?: boolean;
  }): void;
  /**
   * Move the camera with no animation. Used by the engine switch, where the
   * traveller has already been flown somewhere by the other renderer and a
   * second flight to the same place would read as a bug.
   */
  jumpTo(opts: {
    center?: readonly [number, number];
    zoom?: number;
    pitch?: number;
    bearing?: number;
  }): void;
  /** Cancel any camera animation in flight, leaving the camera where it is. */
  stop(): void;
  getPitch(): number;
  setPitch(p: number): void;
  getBearing(): number;
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

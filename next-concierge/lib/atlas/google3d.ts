/**
 * The Google Photorealistic 3D engine, as a module the app can mount anywhere.
 *
 * Until now this engine existed only inside `public/maps/hotel/index.html` — a
 * standalone vanilla-JS page reachable through an iframe. That is why the most
 * persuasive view in the product sat a layer down: an iframe cannot share
 * filters, chrome or camera with the shell around it, so "browse" and "inspect"
 * could only ever be two pages.
 *
 * This module is the half of the port that has no React in it: loading the Maps
 * JS API, the camera arithmetic, and the types. `components/Atlas3DLayer.tsx`
 * mounts it; `AtlasShell` offers it as an engine beside the Mapbox basemaps.
 *
 * Everything here is ported behaviour, not new behaviour. Where a constant came
 * from the original it is named and cited, because the original's camera is
 * tuned — `DETAIL_RANGE` / `DETAIL_TILT` are what makes a property arrival feel
 * cinematic rather than like a zoom.
 */

/* ── Minimal types for the Maps 3D web components ───────────────────────────
 *
 * @types/google.maps does not ship `maps3d` (it is a `v=beta` library), so the
 * alternative to these is `any` at every call site. Only the surface this app
 * touches is declared — enough that a typo is a compile error rather than a
 * silent no-op at runtime.
 */

export interface Camera3D {
  center: { lat: number; lng: number; altitude: number };
  range: number;
  tilt: number;
  heading: number;
}

export interface Map3DElement extends HTMLElement {
  center: { lat: number; lng: number; altitude: number };
  range: number;
  tilt: number;
  heading: number;
  mode: string;
  gestureHandling?: string;
  defaultLabelsDisabled?: boolean;
  flyCameraTo?(opts: { endCamera: Camera3D; durationMillis: number }): void;
  flyCameraAround?(opts: { camera: Camera3D; durationMillis: number; rounds: number }): void;
  stopCameraAnimation?(): void;
}

export interface Marker3D extends HTMLElement {
  position: { lat: number; lng: number; altitude: number };
  altitudeMode: string;
}

interface PinElementLike extends HTMLElement {
  scale: number;
}

interface Maps3DLib {
  Map3DElement: new (opts: Record<string, unknown>) => Map3DElement;
  MapMode: { HYBRID: string; SATELLITE: string };
  Marker3DInteractiveElement: new (opts: Record<string, unknown>) => Marker3D;
  AltitudeMode: { RELATIVE_TO_MESH: string; ABSOLUTE: string; CLAMP_TO_GROUND: string };
}

interface MarkerLib {
  PinElement: new (opts: Record<string, unknown>) => PinElementLike;
}

interface ElevationResult {
  results?: { elevation?: number }[];
}

interface ElevationLib {
  ElevationService: new () => {
    getElevationForLocations(req: {
      locations: { lat: number; lng: number }[];
    }): Promise<ElevationResult>;
  };
}

interface GoogleMapsNamespace {
  importLibrary(name: "maps3d"): Promise<Maps3DLib>;
  importLibrary(name: "marker"): Promise<MarkerLib>;
  importLibrary(name: "elevation"): Promise<ElevationLib>;
}

declare global {
  interface Window {
    google?: { maps?: GoogleMapsNamespace & Record<string, unknown> };
  }
}

export interface Google3D {
  maps3d: Maps3DLib;
  marker: MarkerLib;
}

/* ── Loading ───────────────────────────────────────────────────────────────
 *
 * The key comes from /api/hotel/config, which reads GOOGLE_MAPS_API_KEY server
 * side and is same-origin from anywhere in this app. That route was written for
 * the iframe and is explicitly protected by the work order; it needs no change
 * to serve a React page, because the key's restriction is by HTTP referrer
 * (this domain), not by path.
 *
 * One caveat, learned the expensive way during the 2026-07-29 incident and
 * recorded in STATE.md: a `srcdoc` or sandboxed iframe has an opaque null
 * origin, so a referrer-restricted key fails there and the map looks broken
 * when it is not. Mount this in a real same-origin document.
 */

const CONFIG_URL = "/api/hotel/config";

let keyPromise: Promise<string> | null = null;

/** The Google Maps JS key, fetched once per session. "" when unconfigured. */
export function fetchMapsKey(): Promise<string> {
  if (keyPromise) return keyPromise;
  keyPromise = fetch(CONFIG_URL, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`config ${r.status}`))))
    .then((j: { apiKey?: string }) => String(j?.apiKey || ""))
    .catch(() => {
      // Let the next attempt retry rather than caching a transient failure —
      // the engine is chosen by hand, so a second try is one click away.
      keyPromise = null;
      return "";
    });
  return keyPromise;
}

/**
 * Google's official inline loader, verbatim in behaviour.
 *
 * It is idempotent by construction (it warns and ignores a second call), which
 * matters here in a way it did not in the standalone page: React remounts, and
 * the engine can be switched away from and back to several times in a session.
 */
let bootstrapped = false;
function bootstrapMapsApi(key: string): void {
  if (bootstrapped) return;
  bootstrapped = true;
  const w = window as unknown as Record<string, unknown>;
  const g = (w.google = (w.google || {}) as Record<string, unknown>);
  const maps = (g.maps = (g.maps || {}) as Record<string, unknown>);
  if (maps.importLibrary) return; // already loaded by another surface

  const libs = new Set<string>();
  let loading: Promise<void> | null = null;
  const params = new URLSearchParams({ key, v: "beta" });

  const start = () =>
    (loading ||= new Promise<void>((resolve, reject) => {
      const el = document.createElement("script");
      params.set("libraries", [...libs].join(","));
      params.set("callback", "google.maps.__ib__");
      el.src = `https://maps.googleapis.com/maps/api/js?${params}`;
      el.nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce || "";
      el.onerror = () => reject(new Error("The Google Maps JavaScript API could not load."));
      (maps as Record<string, unknown>).__ib__ = resolve;
      document.head.append(el);
    }));

  maps.importLibrary = (name: string, ...rest: unknown[]) => {
    libs.add(name);
    return start().then(() =>
      (maps.importLibrary as (n: string, ...r: unknown[]) => Promise<unknown>)(name, ...rest),
    );
  };
}

export class Google3DUnavailable extends Error {
  constructor(readonly reason: "nokey" | "load") {
    super(reason === "nokey" ? "No Google Maps key configured" : "Google Maps failed to load");
    this.name = "Google3DUnavailable";
  }
}

let libsPromise: Promise<Google3D> | null = null;

/**
 * Load the photoreal engine's libraries. Cached — the second engine switch in a
 * session costs nothing.
 */
export function loadGoogle3D(): Promise<Google3D> {
  if (libsPromise) return libsPromise;
  libsPromise = (async () => {
    const key = await fetchMapsKey();
    if (!key) throw new Google3DUnavailable("nokey");
    bootstrapMapsApi(key);
    const ns = window.google?.maps;
    if (!ns?.importLibrary) throw new Google3DUnavailable("load");
    const [maps3d, marker] = await Promise.all([
      ns.importLibrary("maps3d"),
      ns.importLibrary("marker"),
    ]);
    return { maps3d, marker };
  })().catch((err) => {
    libsPromise = null; // a failed load must not poison the session
    throw err instanceof Google3DUnavailable ? err : new Google3DUnavailable("load");
  });
  return libsPromise;
}

/* ── Ground elevation ──────────────────────────────────────────────────────
 *
 * Ported from the standalone atlas. Camera targets use ABSOLUTE altitude, so at
 * altitude 0 the look-at point in a mountain town (Aspen sits at ~2,400 m) is
 * underground and a close fly-in drives the camera through the terrain.
 */

const ELEV_CACHE = new Map<string, number>();
let elevSvc: InstanceType<ElevationLib["ElevationService"]> | null = null;

export async function groundAltitude(lat: number, lng: number): Promise<number> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = ELEV_CACHE.get(key);
  if (hit !== undefined) return hit;
  let alt = 0;
  try {
    if (!elevSvc) {
      const lib = await window.google!.maps!.importLibrary("elevation");
      elevSvc = new lib.ElevationService();
    }
    const r = await elevSvc.getElevationForLocations({ locations: [{ lat, lng }] });
    const e = r?.results?.[0];
    if (e && Number.isFinite(e.elevation)) alt = Math.max(0, Number(e.elevation));
  } catch {
    // Sea level is the original's fallback too — a wrong altitude is a slightly
    // odd approach angle, not a broken map.
  }
  ELEV_CACHE.set(key, alt);
  return alt;
}

/* ── Camera arithmetic ─────────────────────────────────────────────────────
 *
 * DETAIL_RANGE / DETAIL_TILT and the tilt easing are the standalone atlas's
 * own constants, and they are the reason arriving at a property reads as
 * cinema. The work order quotes this camera logic as the seam between the two
 * engines: photoreal is worthless at globe zoom and unbeatable at property
 * zoom, and these numbers are where "property zoom" is defined.
 */

export const DETAIL_RANGE = 2600;
export const DETAIL_TILT = 67;

/**
 * Where a property is INSPECTED, as opposed to where the detail camera begins.
 *
 * DETAIL_RANGE frames a property in its setting — the block, the beach, the
 * ridge behind it — which is the right arrival for a map you are still
 * browsing. It is the wrong distance for the thing this engine is actually for:
 * at 2.6 km the photogrammetry mesh of the building is a shape, and the
 * traveller opening a card wants the façade, the terraces, the pool deck, how
 * the wings sit against the water. Opening a card is not browsing, so it gets
 * its own distance.
 *
 * 450 m is chosen against the mesh, not by taste: Google's tiles hold real
 * detail to roughly 150–300 m and this leaves headroom above that, while still
 * containing a large resort's grounds at DETAIL_TILT. Closer than ~250 m and a
 * tall property starts to overrun the frame; further than ~800 m and you are
 * back to looking at a block.
 *
 * Tilt deliberately stays DETAIL_TILT. `maxTiltForRange` caps everything below
 * TILT_RESET_START_RANGE at that angle, and the debounced tilt sync in
 * Atlas3DLayer would flatten anything steeper back down within 160 ms — so a
 * steeper inspection tilt is not a tuning choice here, it is a fight.
 */
export const INSPECT_RANGE = 450;
const TILT_RESET_START_RANGE = 4200;
const TILT_RESET_END_RANGE = 220000;

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const eased01 = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/** The most tilt this range can carry before the horizon stops making sense. */
export function maxTiltForRange(range: number): number {
  const r = Number(range);
  if (!Number.isFinite(r) || r <= 0) return 0;
  if (r <= TILT_RESET_START_RANGE) return DETAIL_TILT;
  if (r >= TILT_RESET_END_RANGE) return 0;
  const t =
    (Math.log(r) - Math.log(TILT_RESET_START_RANGE)) /
    (Math.log(TILT_RESET_END_RANGE) - Math.log(TILT_RESET_START_RANGE));
  return DETAIL_TILT * (1 - eased01(t));
}

export function tiltForRange(tilt: number, range: number): number {
  const t = Number(tilt);
  if (!Number.isFinite(t)) return 0;
  return Math.min(t, maxTiltForRange(range));
}

/* ── Flight timing ─────────────────────────────────────────────────────────
 *
 * How long the camera takes to move from one property to the next.
 *
 * It was a flat 1,800 ms, inherited from the standalone atlas, where nearly
 * every flight started from a wide framing and ended at one hotel — a single
 * descent, and 1.8s is a fine descent. Here the common move is a different
 * one: the traveller is at 450 m over one building and clicks the next card, so
 * the camera TRAVELS. At a flat 1.8s that reads as a cut, not a move — the
 * building is replaced rather than left behind.
 *
 * So the duration follows the distance, and it is linear in the LOG of it,
 * because that is how the move reads rather than how far it is: crossing a city
 * and crossing an ocean are both one gesture, and an ocean is not two thousand
 * times as much of one. A hop across town lands at ~2.6s, a hop across the
 * country around 4.5s, and the far side of the world at 5.2s — slow enough to
 * be a journey, short enough that nobody clicking through a shortlist is
 * waiting on the camera to finish before they can click again (they can: a new
 * flight supersedes the one in the air, and measures its own distance from
 * wherever the camera has got to).
 */

export const FLIGHT_MS_NEAR = 2600;
export const FLIGHT_MS_FAR = 5200;
/** Where the curve tops out: 10,000 km, near enough the far side of the earth. */
const FLIGHT_FAR_KM = 10000;

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function greatCircleKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  if (![aLat, aLng, bLat, bLng].every((n) => Number.isFinite(n))) return NaN;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The flight time for a move between two points on the globe.
 *
 * An unknown origin — no camera yet, at mount or before the first frame —
 * takes the long end deliberately: the only camera the engine can be at then is
 * the wide one it opened on, which is the longest descent there is.
 */
export function flightDuration(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const km = greatCircleKm(fromLat, fromLng, toLat, toLng);
  if (!Number.isFinite(km)) return FLIGHT_MS_FAR;
  const t = clamp(Math.log10(1 + km) / Math.log10(1 + FLIGHT_FAR_KM), 0, 1);
  return Math.round(FLIGHT_MS_NEAR + (FLIGHT_MS_FAR - FLIGHT_MS_NEAR) * t);
}

/* ── Mapbox ⇄ photoreal handoff ────────────────────────────────────────────
 *
 * The two engines describe a camera differently: Mapbox by zoom level over a
 * Web Mercator tile pyramid, Google 3D by metres of range from the look-at
 * point. Switching engines has to preserve "where I am and how close I am", or
 * the choice reads as a teleport and nobody uses it twice.
 *
 * Mapbox's ground resolution at zoom z and latitude φ is
 *   metres/pixel = 156543.03392 · cos φ / 2^z
 * so the visible ground height is that times the viewport height in pixels. A
 * perspective camera at distance `range` with vertical field of view θ sees
 *   height = 2 · range · tan(θ/2)
 * and equating the two gives the conversion below.
 *
 * VERTICAL_FOV_DEG is empirical: Google does not document the 3D camera's field
 * of view, and 45° is the value that makes a switch at city zoom land on the
 * same rooftops. It is a named constant precisely so it can be re-tuned by eye
 * without hunting through arithmetic.
 */

const VERTICAL_FOV_DEG = 45;
const FOV_FACTOR = 2 * Math.tan((VERTICAL_FOV_DEG * Math.PI) / 360);
const EQUATOR_METRES_PER_PIXEL = 156543.03392;

/** Guard rails: Google clamps hard, and NaN in the camera blanks the element. */
const MIN_RANGE = 120;
const MAX_RANGE = 20_000_000;

export function rangeFromZoom(zoom: number, lat: number, viewportHeightPx: number): number {
  const z = Number.isFinite(zoom) ? zoom : 2;
  const φ = clamp(Number.isFinite(lat) ? lat : 0, -85, 85);
  const height = Math.max(viewportHeightPx || 0, 320);
  const mpp = (EQUATOR_METRES_PER_PIXEL * Math.cos((φ * Math.PI) / 180)) / Math.pow(2, z);
  return clamp((mpp * height) / FOV_FACTOR, MIN_RANGE, MAX_RANGE);
}

export function zoomFromRange(range: number, lat: number, viewportHeightPx: number): number {
  const r = clamp(Number.isFinite(range) ? range : MAX_RANGE, MIN_RANGE, MAX_RANGE);
  const φ = clamp(Number.isFinite(lat) ? lat : 0, -85, 85);
  const height = Math.max(viewportHeightPx || 0, 320);
  const mpp = (r * FOV_FACTOR) / height;
  const z = Math.log2((EQUATOR_METRES_PER_PIXEL * Math.cos((φ * Math.PI) / 180)) / mpp);
  return clamp(Number.isFinite(z) ? z : 2, 0, 22);
}

/**
 * Mapbox pitch is capped at 85° and photoreal tilt at DETAIL_TILT-ish angles;
 * carrying a pitch across unchanged is fine downward but has to be re-limited
 * upward, since a tilt legal at 2 km is not legal at 2,000 km.
 */
export function tiltFromPitch(pitch: number, range: number): number {
  return tiltForRange(Number.isFinite(pitch) ? pitch : 0, range);
}

/* ── Category colours ───────────────────────────────────────────────────────
 * The standalone atlas's `catColor`, so a pin means the same thing in both
 * engines. Falls back to the hotel accent for anything unrecognised.
 */
const CATEGORY_COLORS: Record<string, string> = {
  "City Hotel": "#5b8dd6",
  "Resort / Leisure": "#caa44e",
  "Spa / Wellness Resort": "#6fb38a",
  "Beach Resort": "#e0a96d",
  "Lodge / Safari": "#b07a45",
  "Villas / Residences": "#c178a6",
  "Island Resort": "#4fb0b0",
  "Mountain / Ski": "#9fb1c8",
};

export const HOTEL_ACCENT = "#caa44e";

export function categoryColor(category?: string | null): string {
  return CATEGORY_COLORS[String(category || "")] || HOTEL_ACCENT;
}

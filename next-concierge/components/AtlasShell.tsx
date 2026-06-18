"use client";

// Map shell for the unified Living Atlas. When NEXT_PUBLIC_MAPBOX_TOKEN is
// set, it loads Mapbox GL (same v3.7.0 the legacy page uses) and renders the
// dark globe; otherwise it degrades to an elegant fallback panel with the
// external-atlas handoff, so the test app works with zero configuration.
//
// VR layer: BeVvip's own LuxuryTravelVR 360° videos plotted as a cross-cutting
// "see the real place" overlay (feed: /api/vr-points). Thumbnails are HTML
// markers — not GL images — so cross-origin YouTube stills never taint the WebGL
// canvas. They scale with zoom (small dots far out, full thumbnails up close).
//
// Videos are grouped by location: 77 videos sit on 51 spots (Raivavae alone has
// 7, Kokomo/North Island have 4 each), so one pin per place carries a count
// badge and opens a gallery; single-video pins play straight away. The 360°
// plays in-app via the embed iframe — no YouTube round-trip. A future "Photos"
// toggle slots beside this one once the owned 360° photospheres are importable.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { OfferingType } from "@/lib/types";
import { ATLASES } from "@/lib/atlas-config";

const MAPBOX_JS = "https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js";
const MAPBOX_CSS = "https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css";

// Zoom→thumbnail-scale ramp. Globe sits at ~1.4; thumbnails bloom as you fly in.
const ZOOM_MIN = 1.4;
const ZOOM_MAX = 6;
const SCALE_MIN = 0.42;
const SCALE_MAX = 1.5;

interface VrProps {
  id: string;
  kind: string;
  name: string;
  place: string | null;
  region: string | null;
  embed: string;
  watch: string;
  thumb: string;
  thumbGrid: string;
  duration: string | null;
}
interface VrFeature {
  geometry: { coordinates: [number, number] };
  properties: VrProps;
}

interface Props {
  type: OfferingType;
  region: string | null;
  externalLink: string;
}

export default function AtlasShell({ type, region, externalLink }: Props) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | undefined>(undefined);
  const markersRef = useRef<MapboxMarker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [vrOn, setVrOn] = useState(true);
  const [vrCount, setVrCount] = useState(0);
  // The place the user clicked (one or more co-located videos), and which one
  // of that group is currently playing.
  const [openGroup, setOpenGroup] = useState<VrProps[] | null>(null);
  const [playing, setPlaying] = useState<VrProps | null>(null);

  useEffect(() => {
    if (!token || !mapEl.current) return;
    let map: MapboxMap | undefined;
    let cancelled = false;

    const openPlace = (group: VrProps[]) => {
      setOpenGroup(group);
      setPlaying(group.length === 1 ? group[0] : null);
    };

    loadMapbox()
      .then((mapboxgl) => {
        if (cancelled || !mapEl.current) return;
        mapboxgl.accessToken = token;
        map = new mapboxgl.Map({
          container: mapEl.current,
          style: "mapbox://styles/mapbox/dark-v11",
          projection: "globe",
          zoom: ZOOM_MIN,
          center: [10, 25],
        });
        mapRef.current = map;
        map.on("load", () => {
          if (cancelled || !map) return;
          map.resize();
          setMapReady(true);
          // Scale all thumbnails together via one CSS var on the map container.
          const applyScale = () => {
            const z = map!.getZoom();
            const t = Math.min(1, Math.max(0, (z - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)));
            const scale = SCALE_MIN + t * (SCALE_MAX - SCALE_MIN);
            map!.getContainer().style.setProperty("--vr-scale", scale.toFixed(3));
          };
          applyScale();
          map.on("zoom", applyScale);
          void loadVrLayer(map, mapboxgl, markersRef, setVrCount, openPlace);
        });
        map.on("error", () => setMapFailed(true));
      })
      .catch(() => setMapFailed(true));

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map?.remove();
      mapRef.current = undefined;
    };
  }, [token]);

  // Toggle the VR layer by hiding/showing the marker container — markers stay
  // attached so the globe never re-fetches or re-lays-out on flip.
  useEffect(() => {
    const c = mapRef.current?.getContainer();
    if (c) c.classList.toggle("vr-hidden", !vrOn);
  }, [vrOn, mapReady]);

  const closeModal = () => {
    setOpenGroup(null);
    setPlaying(null);
  };

  const showFallback = !token || mapFailed;

  return (
    <div className="atlas-map">
      <style>{VR_CSS}</style>
      {token && !mapFailed && (
        <div ref={mapEl} style={{ position: "absolute", inset: 0 }} />
      )}

      {/* VR layer toggle — only meaningful once the globe is live. */}
      {token && !mapFailed && mapReady && (
        <button
          type="button"
          className={`vr-toggle${vrOn ? " on" : ""}`}
          onClick={() => setVrOn((v) => !v)}
          aria-pressed={vrOn}
        >
          <span className="vr-dot" /> 360° VR
          {vrCount > 0 && <span className="vr-count">{vrCount}</span>}
        </button>
      )}

      {token && !mapFailed && !mapReady && (
        <div className="fallback">
          <span className="badge">{region ? `Region · ${region}` : "All inventory"}</span>
          <p>Charting the Atlas…</p>
        </div>
      )}

      {showFallback && (
        <div className="fallback">
          <span className="badge">{region ? `Region · ${region}` : "All inventory"}</span>
          <p>
            {token
              ? "Map unavailable right now."
              : "Set NEXT_PUBLIC_MAPBOX_TOKEN to render the Living Atlas globe here."}{" "}
            The full {ATLASES[type].label} is one click away — your selection carries over.
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

      {/* Place modal: a gallery when several videos share a spot, else the
          in-app 360° player (magic-window pan, no leaving the globe). */}
      {openGroup && (
        <div className="vr-player" role="dialog" aria-label={openGroup[0].place || "360° VR"}>
          <div className="vr-player-card">
            <button type="button" className="vr-close" onClick={closeModal} aria-label="Close">
              ✕
            </button>

            {playing ? (
              <>
                {openGroup.length > 1 && (
                  <button type="button" className="vr-back" onClick={() => setPlaying(null)}>
                    ‹ All {openGroup.length} here
                  </button>
                )}
                <div className="vr-frame">
                  <iframe
                    src={`${playing.embed}?autoplay=1&rel=0&playsinline=1`}
                    title={playing.name}
                    allow="accelerometer; autoplay; gyroscope; encrypted-media; fullscreen"
                    allowFullScreen
                  />
                </div>
                <div className="vr-meta">
                  <strong>{playing.name}</strong>
                  <span>
                    {playing.place || playing.region}
                    {playing.duration ? ` · ${playing.duration}` : ""}
                  </span>
                </div>
              </>
            ) : (
              <div className="vr-gallery">
                <div className="vr-gallery-head">
                  <strong>{openGroup[0].place || openGroup[0].region}</strong>
                  <span>{openGroup.length} 360° videos here</span>
                </div>
                <div className="vr-gallery-grid">
                  {openGroup.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="vr-gallery-item"
                      onClick={() => setPlaying(v)}
                    >
                      <img src={v.thumbGrid || v.thumb} alt="" loading="lazy" />
                      <span className="vr-gallery-play">
                        <span className="vr-play-icon">▶</span>
                        {v.duration && <em>{v.duration}</em>}
                      </span>
                      <span className="vr-gallery-title">{v.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ----- VR layer wiring -------------------------------------------------------

async function loadVrLayer(
  map: MapboxMap,
  mapboxgl: MapboxModule,
  markersRef: React.MutableRefObject<MapboxMarker[]>,
  setVrCount: (n: number) => void,
  onOpen: (group: VrProps[]) => void
) {
  try {
    const res = await fetch("/api/vr-points");
    if (!res.ok) return;
    const fc = (await res.json()) as { features?: VrFeature[] };
    const features = fc.features ?? [];

    // Group co-located videos so stacked pins don't hide each other.
    const groups = new Map<string, { coords: [number, number]; items: VrProps[] }>();
    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates;
      const key = `${lng.toFixed(4)},${lat.toFixed(4)}`;
      const g = groups.get(key);
      if (g) g.items.push(f.properties);
      else groups.set(key, { coords: f.geometry.coordinates, items: [f.properties] });
    }

    for (const { coords, items } of groups.values()) {
      const head = items[0];
      const el = document.createElement("button");
      el.type = "button";
      el.className = `vr-marker vr-marker-${head.kind}`;
      el.title = items.length > 1 ? `${items.length} videos · ${head.place ?? ""}` : head.name;
      const img = document.createElement("img");
      img.src = head.thumbGrid || head.thumb;
      img.alt = "";
      img.loading = "lazy";
      el.appendChild(img);
      if (items.length > 1) {
        const badge = document.createElement("span");
        badge.className = "vr-badge";
        badge.textContent = String(items.length);
        el.appendChild(badge);
      }
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onOpen(items);
      });
      const marker = new mapboxgl.Marker({ element: el }).setLngLat(coords).addTo(map);
      markersRef.current.push(marker);
    }
    setVrCount(features.length);
  } catch {
    // A missing VR feed just means no overlay — the globe is unaffected.
  }
}

// ----- styles ----------------------------------------------------------------

const VR_CSS = `
.atlas-map .vr-marker {
  position: relative; padding: 0; border: 0; background: none; cursor: pointer; line-height: 0;
  transform: scale(var(--vr-scale, 0.6)); transform-origin: center bottom;
  transition: transform 120ms ease-out;
}
.atlas-map .vr-marker img {
  width: 46px; height: 46px; object-fit: cover; border-radius: 8px;
  border: 2px solid #f4c95d; box-shadow: 0 2px 10px rgba(0,0,0,0.55); display: block;
}
.atlas-map .vr-marker:hover { z-index: 5; }
.atlas-map .vr-marker:hover img { border-color: #ffe39a; }
.atlas-map .vr-badge {
  position: absolute; top: -7px; right: -7px; min-width: 19px; height: 19px;
  padding: 0 5px; border-radius: 999px; background: #f4c95d; color: #1a1206;
  font: 700 11px/19px system-ui, sans-serif; text-align: center;
  border: 1.5px solid #0d0d0f;
}
.atlas-map.vr-hidden .vr-marker, .vr-hidden .vr-marker { display: none; }

.atlas-map .vr-toggle {
  position: absolute; top: 14px; right: 14px; z-index: 6;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 999px; cursor: pointer;
  font: 600 13px/1 system-ui, sans-serif; letter-spacing: 0.02em;
  color: #e9e3d5; background: rgba(18,18,20,0.78); backdrop-filter: blur(6px);
  border: 1px solid rgba(244,201,93,0.35);
}
.atlas-map .vr-toggle.on { border-color: #f4c95d; color: #fff; }
.atlas-map .vr-toggle .vr-dot { width: 9px; height: 9px; border-radius: 50%; background: #555; }
.atlas-map .vr-toggle.on .vr-dot { background: #f4c95d; box-shadow: 0 0 8px #f4c95d; }
.atlas-map .vr-toggle .vr-count { font-size: 11px; opacity: 0.75; padding-left: 2px; }

.atlas-map .vr-player {
  position: absolute; inset: 0; z-index: 20;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.66); backdrop-filter: blur(3px); padding: 18px;
}
.atlas-map .vr-player-card {
  position: relative; width: min(880px, 100%); max-height: 100%; overflow: auto;
  background: #0d0d0f; border: 1px solid rgba(244,201,93,0.35);
  border-radius: 14px; box-shadow: 0 18px 60px rgba(0,0,0,0.6);
}
.atlas-map .vr-frame { position: relative; aspect-ratio: 16 / 9; background: #000; }
.atlas-map .vr-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.atlas-map .vr-meta {
  display: flex; flex-direction: column; gap: 3px; padding: 12px 16px;
  color: #e9e3d5; font: 13px/1.35 system-ui, sans-serif;
}
.atlas-map .vr-meta strong { font-size: 15px; color: #fff; }
.atlas-map .vr-meta span { opacity: 0.7; }
.atlas-map .vr-close {
  position: absolute; top: 8px; right: 8px; z-index: 2;
  width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
  color: #fff; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25); font-size: 14px;
}
.atlas-map .vr-back {
  position: absolute; top: 8px; left: 8px; z-index: 2; cursor: pointer;
  padding: 5px 11px; border-radius: 999px; color: #fff;
  background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25);
  font: 600 12px/1 system-ui, sans-serif;
}
.atlas-map .vr-gallery { padding: 16px; }
.atlas-map .vr-gallery-head {
  display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; color: #e9e3d5;
  font: 13px/1.35 system-ui, sans-serif;
}
.atlas-map .vr-gallery-head strong { font-size: 16px; color: #fff; }
.atlas-map .vr-gallery-head span { opacity: 0.7; }
.atlas-map .vr-gallery-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;
}
.atlas-map .vr-gallery-item {
  position: relative; padding: 0; border: 0; background: none; cursor: pointer; text-align: left;
}
.atlas-map .vr-gallery-item img {
  width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px;
  border: 1px solid rgba(244,201,93,0.4); display: block;
}
.atlas-map .vr-gallery-item:hover img { border-color: #f4c95d; }
.atlas-map .vr-gallery-play {
  position: absolute; top: 6px; left: 8px; display: inline-flex; align-items: center; gap: 6px;
}
.atlas-map .vr-play-icon {
  width: 22px; height: 22px; border-radius: 50%; background: rgba(244,201,93,0.92);
  color: #0d0d0f; font-size: 10px; line-height: 22px; text-align: center;
}
.atlas-map .vr-gallery-play em {
  font-style: normal; font: 600 11px/1 system-ui, sans-serif; color: #fff;
  background: rgba(0,0,0,0.55); padding: 4px 6px; border-radius: 6px;
}
.atlas-map .vr-gallery-title {
  display: block; margin-top: 5px; color: #d9d4c8;
  font: 12px/1.3 system-ui, sans-serif;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
`;

// ----- minimal Mapbox typings (hand-rolled, as in the original shell) --------

interface MapboxMap {
  on(event: string, cb: () => void): void;
  resize(): void;
  remove(): void;
  getZoom(): number;
  getContainer(): HTMLElement;
}

interface MapboxMarker {
  setLngLat(coords: [number, number]): MapboxMarker;
  addTo(map: MapboxMap): MapboxMarker;
  remove(): void;
}

interface MapboxModule {
  accessToken: string;
  Map: new (opts: Record<string, unknown>) => MapboxMap;
  Marker: new (opts: { element: HTMLElement }) => MapboxMarker;
}

declare global {
  interface Window {
    mapboxgl?: MapboxModule;
  }
}

function loadMapbox(): Promise<MapboxModule> {
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  if (!document.querySelector(`link[href="${MAPBOX_CSS}"]`)) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = MAPBOX_CSS;
    document.head.appendChild(css);
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = MAPBOX_JS;
    s.onload = () =>
      window.mapboxgl ? resolve(window.mapboxgl) : reject(new Error("mapbox missing"));
    s.onerror = () => reject(new Error("mapbox failed to load"));
    document.head.appendChild(s);
  });
}

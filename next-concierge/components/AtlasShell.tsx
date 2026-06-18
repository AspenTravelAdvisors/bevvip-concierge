"use client";

// Map shell for the unified Living Atlas. When NEXT_PUBLIC_MAPBOX_TOKEN is
// set, it loads Mapbox GL (same v3.7.0 the legacy page uses) and renders the
// dark globe; otherwise it degrades to an elegant fallback panel with the
// external-atlas handoff, so the test app works with zero configuration.
//
// VR layer: BeVvip's own LuxuryTravelVR 360° videos plotted as a cross-cutting
// "see the real place" overlay (feed: /api/vr-points). Thumbnails are HTML
// markers — not GL images — so cross-origin YouTube stills never taint the WebGL
// canvas. They scale with zoom (small dots far out, full thumbnails up close)
// and open an in-app 360° player on click, no YouTube round-trip. The owned
// 360° photo stills (kind:"photo") will ride the same toggle once their pipeline
// lands.

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
  const [selected, setSelected] = useState<VrProps | null>(null);

  useEffect(() => {
    if (!token || !mapEl.current) return;
    let map: MapboxMap | undefined;
    let cancelled = false;

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
          void loadVrLayer(map, mapboxgl, markersRef, setVrCount, setSelected);
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

      {/* In-app 360° player — magic-window pan, no leaving the globe. */}
      {selected && (
        <div className="vr-player" role="dialog" aria-label={selected.name}>
          <div className="vr-player-card">
            <button type="button" className="vr-close" onClick={() => setSelected(null)} aria-label="Close">
              ✕
            </button>
            <div className="vr-frame">
              <iframe
                src={`${selected.embed}?autoplay=1&rel=0&playsinline=1`}
                title={selected.name}
                allow="accelerometer; autoplay; gyroscope; encrypted-media; fullscreen"
                allowFullScreen
              />
            </div>
            <div className="vr-meta">
              <strong>{selected.name}</strong>
              <span>
                {selected.place || selected.region}
                {selected.duration ? ` · ${selected.duration}` : ""}
              </span>
            </div>
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
  setSelected: (p: VrProps | null) => void
) {
  try {
    const res = await fetch("/api/vr-points");
    if (!res.ok) return;
    const fc = (await res.json()) as { features?: VrFeature[] };
    const features = fc.features ?? [];

    for (const f of features) {
      const p = f.properties;
      const el = document.createElement("button");
      el.type = "button";
      el.className = `vr-marker vr-marker-${p.kind}`;
      el.title = p.name;
      const img = document.createElement("img");
      img.src = p.thumbGrid || p.thumb;
      img.alt = "";
      img.loading = "lazy";
      el.appendChild(img);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelected(p);
      });
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(f.geometry.coordinates)
        .addTo(map);
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
  padding: 0; border: 0; background: none; cursor: pointer; line-height: 0;
  transform: scale(var(--vr-scale, 0.6)); transform-origin: center bottom;
  transition: transform 120ms ease-out;
}
.atlas-map .vr-marker img {
  width: 46px; height: 46px; object-fit: cover; border-radius: 8px;
  border: 2px solid #f4c95d; box-shadow: 0 2px 10px rgba(0,0,0,0.55);
  display: block;
}
.atlas-map .vr-marker:hover { z-index: 5; }
.atlas-map .vr-marker:hover img { border-color: #ffe39a; }
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
.atlas-map .vr-toggle .vr-dot {
  width: 9px; height: 9px; border-radius: 50%; background: #555;
}
.atlas-map .vr-toggle.on .vr-dot { background: #f4c95d; box-shadow: 0 0 8px #f4c95d; }
.atlas-map .vr-toggle .vr-count {
  font-size: 11px; opacity: 0.75; padding-left: 2px;
}

.atlas-map .vr-player {
  position: absolute; inset: 0; z-index: 20;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.66); backdrop-filter: blur(3px); padding: 18px;
}
.atlas-map .vr-player-card {
  position: relative; width: min(880px, 100%);
  background: #0d0d0f; border: 1px solid rgba(244,201,93,0.35);
  border-radius: 14px; overflow: hidden; box-shadow: 0 18px 60px rgba(0,0,0,0.6);
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
  color: #fff; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25);
  font-size: 14px;
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

"use client";

// Map shell for the unified Living Atlas. Renders the Mapbox dark globe and
// plots the live inventory the legacy app showed: the full hotel set as an
// ambient gold heatmap + dot field, plus colored region pins for cruise / jet
// / yacht. A legend toggles each layer. With no token configured it falls back
// to the public Aspen token so the globe still renders; if Mapbox truly fails
// to load it degrades to the external-atlas handoff panel.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { OfferingType } from "@/lib/types";
import { ATLASES } from "@/lib/atlas-config";
import {
  DEFAULT_MAPBOX_TOKEN,
  LEGEND_ITEMS,
  applyFog,
  flyToRegion,
  loadHotelField,
  loadTypeOverlays,
  setLayerVisibility,
  type MapboxMap,
  type MapboxModule,
  type MapboxPopup,
} from "@/lib/globe";

const MAPBOX_JS = "https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js";
const MAPBOX_CSS = "https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css";

interface Props {
  type: OfferingType;
  region: string | null;
  externalLink: string;
}

export default function AtlasShell({ type, region, externalLink }: Props) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || DEFAULT_MAPBOX_TOKEN;
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!mapEl.current) return;
    let map: MapboxMap | undefined;
    let popup: MapboxPopup | undefined;
    let cancelled = false;

    loadMapbox()
      .then((mapboxgl) => {
        if (cancelled || !mapEl.current) return;
        mapboxgl.accessToken = token;
        map = new mapboxgl.Map({
          container: mapEl.current,
          style: "mapbox://styles/mapbox/dark-v11",
          projection: "globe",
          center: [10, 20],
          zoom: 1.3,
          minZoom: 0.6,
        });
        mapRef.current = map;
        popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, offset: 12, maxWidth: "240px" });

        // style.load (not load) is when fog + custom layers can be added.
        map.on("style.load", () => {
          if (cancelled || !map) return;
          applyFog(map);
          map.resize();
          setMapReady(true);
          // Best-effort, independent: one feed failing never blocks the rest.
          void loadHotelField(map);
          void loadTypeOverlays(map, mapboxgl, popup!, ATLASES);
          flyToRegion(map, region);
        });
        map.on("error", () => setMapFailed(true));
      })
      .catch(() => setMapFailed(true));

    return () => {
      cancelled = true;
      popup?.remove();
      map?.remove();
      mapRef.current = null;
    };
  }, [token, region]);

  function toggleLayer(key: string) {
    const next = !hidden[key];
    setHidden((h) => ({ ...h, [key]: next }));
    if (mapRef.current) setLayerVisibility(mapRef.current, key, !next);
  }

  return (
    <div className="atlas-map">
      {/* Container stays mounted and sized; Mapbox must measure real
          dimensions at construction or the globe renders without tiles. */}
      {!mapFailed && <div ref={mapEl} style={{ position: "absolute", inset: 0 }} />}

      {!mapFailed && mapReady && (
        <div className="legend">
          <div className="lgcap">Tap to hide</div>
          {LEGEND_ITEMS.map((it) => (
            <button
              key={it.key}
              type="button"
              className={`lgi${hidden[it.key] ? " off" : ""}`}
              onClick={() => toggleLayer(it.key)}
              title={hidden[it.key] ? "Tap to show" : "Tap to hide"}
            >
              <i style={{ background: it.color }} />
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}

      {!mapFailed && !mapReady && (
        <div className="fallback">
          <span className="badge">{region ? `Region · ${region}` : "All inventory"}</span>
          <p>Charting the Atlas…</p>
        </div>
      )}

      {mapFailed && (
        <div className="fallback">
          <span className="badge">{region ? `Region · ${region}` : "All inventory"}</span>
          <p>
            Map unavailable right now. The full {ATLASES[type].label} is one click
            away — your selection carries over.
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

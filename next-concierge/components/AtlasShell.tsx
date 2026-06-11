"use client";

// Map shell for the unified Living Atlas. When NEXT_PUBLIC_MAPBOX_TOKEN is
// set, it loads Mapbox GL (same v3.7.0 the legacy page uses) and renders the
// dark globe; otherwise it degrades to an elegant fallback panel with the
// external-atlas handoff, so the test app works with zero configuration.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { OfferingType } from "@/lib/types";
import { ATLASES } from "@/lib/atlas-config";

const MAPBOX_JS = "https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js";
const MAPBOX_CSS = "https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css";

interface Props {
  type: OfferingType;
  region: string | null;
  externalLink: string;
}

export default function AtlasShell({ type, region, externalLink }: Props) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapEl = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

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
          zoom: 1.4,
          center: [10, 25],
        });
        // Flip ready only once tiles are actually painting, and resize so the
        // canvas matches the (now laid-out) container instead of 0×0.
        map.on("load", () => {
          if (cancelled) return;
          map?.resize();
          setMapReady(true);
        });
        map.on("error", () => setMapFailed(true));
      })
      .catch(() => setMapFailed(true));

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [token]);

  const showFallback = !token || mapFailed;

  return (
    <div className="atlas-map">
      {/* Container stays mounted and sized; Mapbox must measure real
          dimensions at construction or the globe renders without tiles. */}
      {token && !mapFailed && (
        <div ref={mapEl} style={{ position: "absolute", inset: 0 }} />
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
    </div>
  );
}

interface MapboxMap {
  on(event: string, cb: () => void): void;
  resize(): void;
  remove(): void;
}

interface MapboxModule {
  accessToken: string;
  Map: new (opts: Record<string, unknown>) => MapboxMap;
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

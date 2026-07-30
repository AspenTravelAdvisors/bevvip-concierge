"use client";

/**
 * Rail Journeys on the globe — the first collection off its Leaflet iframe.
 *
 * Deliberately thin: it knows how to fetch and adapt one feed, and hands
 * everything else to AtlasCollection. The other four collections should each be
 * a file this size; if one isn't, that is a signal the descriptor is missing an
 * axis rather than a reason to special-case the shared component.
 */

import { useCallback } from "react";
import AtlasCollection from "./AtlasCollection";
import { adaptTrain, TRAIN_DESCRIPTOR } from "@/lib/atlas/adapters/train";
import { loadRailGeometry, tripTrackLegs } from "@/lib/atlas/adapters/rail-geometry";
import type { RawJourneyAtlas } from "@/lib/atlas/adapters/journey";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";

export default function AtlasTrain() {
  const load = useCallback(async (): Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
    routeFor?: (o: AtlasOffering) => { mode: string; coordinates: [number, number][] }[] | null;
    brandMarks?: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null }>;
    logoBase?: string;
  }> => {
    // Same static feed the Leaflet atlas used — cached by the CDN, so this is
    // not new traffic, it is the same bytes without the iframe around them.
    // The itinerary and the track geometry load together, as the Leaflet atlas
    // did — it kicks loadRailGeo() alongside the map tiles rather than waiting
    // for a hover.
    const [raw, railGeo] = await Promise.all([
      fetch("/maps/train/itinerary.json", { cache: "force-cache" }).then((r) => {
        if (!r.ok) throw new Error(`train itinerary ${r.status}`);
        return r.json() as Promise<RawJourneyAtlas>;
      }),
      loadRailGeometry(),
    ]);

    const offerings = adaptTrain(raw);
    const regionLabels: Record<string, string> = {};
    for (const [key, r] of Object.entries(raw.REGIONS || {})) {
      regionLabels[key] = r?.name || key;
    }

    const ctx: ParseContext = {
      brands: Object.entries(raw.BRANDS || {}).map(([key, b]) => ({ key, short: b?.short })),
      regions: Object.entries(raw.REGIONS || {}).map(([key, r]) => ({
        key,
        name: r?.name,
        ab: r?.ab,
      })),
      // Journeys resolve `location=` against stop names, fuzzily.
      stopNames: [...new Set(offerings.flatMap((o) => o.stops.map((s) => s.name)))],
    };

    // Real track polylines: 269 legs, 23,541 points, covering 134 of 135 trips.
    // Trains follow tracks; anything without geometry falls back to straight
    // legs between stops rather than an invented curve.
    const routeFor = (o: AtlasOffering) => {
      const legs = tripTrackLegs(o.id, railGeo);
      return legs
        ? legs.map((l) => ({
            mode: l.mode,
            coordinates: l.points.map((p) => [p[0], p[1]] as [number, number]),
          }))
        : null;
    };

    // Brand marks drive the card logos: bundled asset → favicon services →
    // coloured initials. BRANDS carries the domain and the brand colour.
    const brandMarks: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null }> = {};
    for (const [key, b] of Object.entries(raw.BRANDS || {})) {
      brandMarks[key] = { key, short: b?.short, domain: b?.domain, color: b?.color };
    }

    return { offerings, ctx, regionLabels, routeFor, brandMarks, logoBase: "/maps/train/logos" };
  }, []);

  return <AtlasCollection type="train" descriptor={TRAIN_DESCRIPTOR} load={load} />;
}

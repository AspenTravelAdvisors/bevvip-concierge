"use client";

/**
 * Private Jet Journeys on the globe — second collection off its Leaflet iframe.
 *
 * Thin, as intended: the only thing jet knows that rail doesn't is how its own
 * geometry works.
 *
 * **Jets arc, trains don't.** Rail ships real track polylines and drawing a
 * bezier over Loch Lomond instead of the West Highland Line is a lie. An
 * aircraft genuinely does fly the arc, and a straight line between two cities
 * reads as a wire rather than a journey — so here `arcPts` (k = 0.16, the
 * constant that makes an arc read as a voyage) is the honest choice.
 *
 * Legs are unrolled before arcing, for the same reason the sea router unrolls:
 * arcing a raw Tokyo → Los Angeles pair sweeps west across Asia and Africa
 * instead of east across the Pacific.
 */

import { useCallback } from "react";
import AtlasCollection from "./AtlasCollection";
import { adaptJet, JET_DESCRIPTOR } from "@/lib/atlas/adapters/jet";
import type { RawJourneyAtlas } from "@/lib/atlas/adapters/journey";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";
import { unrollLine } from "@/lib/atlas/geo";
import { arcPts } from "@/lib/atlas/sea-router.mjs";

export default function AtlasJet() {
  const load = useCallback(async (): Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
    routeFor?: (o: AtlasOffering) => { mode: string; coordinates: [number, number][] }[] | null;
    brandMarks?: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null }>;
    logoBase?: string;
  }> => {
    const raw: RawJourneyAtlas = await fetch("/maps/jet/itinerary.json", {
      cache: "force-cache",
    }).then((r) => {
      if (!r.ok) throw new Error(`jet itinerary ${r.status}`);
      return r.json();
    });

    const offerings = adaptJet(raw);
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
      stopNames: [...new Set(offerings.flatMap((o) => o.stops.map((s) => s.name)))],
    };

    const routeFor = (o: AtlasOffering) => {
      const located = o.stops.filter((s) => s.at).map((s) => s.at!);
      if (located.length < 2) return null;
      // Unroll the whole sequence first, then arc within that frame.
      const frame = unrollLine(located);
      const coordinates: [number, number][] = [];
      for (let i = 0; i < frame.length - 1; i++) {
        // 0.01 → ~101 points per leg rather than the default 26. A Tokyo →
        // Los Angeles arc at 26 points renders as visible straight chords.
        const seg = arcPts(
          [frame[i][1], frame[i][0]],
          [frame[i + 1][1], frame[i + 1][0]],
          0.01,
        ) as [number, number][];
        for (let k = coordinates.length ? 1 : 0; k < seg.length; k++) {
          coordinates.push([seg[k][1], seg[k][0]]);
        }
      }
      // "primary" — the collection's own route line in platinum, NOT the faint
      // ferry-hop connector. That connector is dashed 2/9 and reads as sparse
      // scaffolding when it is carrying the whole journey.
      return coordinates.length >= 2 ? [{ mode: "primary", coordinates }] : null;
    };

    // Brand marks drive the card logos: bundled asset → favicon services →
    // coloured initials. BRANDS carries the domain and the brand colour.
    const brandMarks: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null }> = {};
    for (const [key, b] of Object.entries(raw.BRANDS || {})) {
      brandMarks[key] = { key, short: b?.short, domain: b?.domain, color: b?.color };
    }

    return { offerings, ctx, regionLabels, routeFor, brandMarks, logoBase: "/maps/jet/logos" };
  }, []);

  return (
    <AtlasCollection
      type="jet"
      descriptor={JET_DESCRIPTOR}
      load={load}
      // Platinum, from the jet atlas's own --accent: #dfe5f2.
      accent="#dfe5f2"
      // Satellite, flat. Platinum used to disappear on photoreal terrain, which
      // is why this was Dark — the fix belonged in the palette (lightened line
      // over a heavy near-black casing), not in avoiding the basemap.
      // Still flat: long-haul arcs distort badly on a globe.
      initialStyle="satellite"
      initialGlobe={false}
    />
  );
}

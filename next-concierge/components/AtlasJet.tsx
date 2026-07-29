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
        const seg = arcPts(
          [frame[i][1], frame[i][0]],
          [frame[i + 1][1], frame[i + 1][0]],
        ) as [number, number][];
        for (let k = coordinates.length ? 1 : 0; k < seg.length; k++) {
          coordinates.push([seg[k][1], seg[k][0]]);
        }
      }
      // "arc" mode draws the dashed connector rather than track symbology —
      // correct for flight, which is not a railway.
      return coordinates.length >= 2 ? [{ mode: "arc", coordinates }] : null;
    };

    return { offerings, ctx, regionLabels, routeFor };
  }, []);

  return <AtlasCollection type="jet" descriptor={JET_DESCRIPTOR} load={load} />;
}

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
import type { RawJourneyAtlas } from "@/lib/atlas/adapters/journey";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";

export default function AtlasTrain() {
  const load = useCallback(async (): Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
  }> => {
    // Same static feed the Leaflet atlas used — cached by the CDN, so this is
    // not new traffic, it is the same bytes without the iframe around them.
    const raw: RawJourneyAtlas = await fetch("/maps/train/itinerary.json", {
      cache: "force-cache",
    }).then((r) => {
      if (!r.ok) throw new Error(`train itinerary ${r.status}`);
      return r.json();
    });

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

    return { offerings, ctx, regionLabels };
  }, []);

  return <AtlasCollection type="train" descriptor={TRAIN_DESCRIPTOR} load={load} />;
}

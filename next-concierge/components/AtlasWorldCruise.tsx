"use client";

/**
 * World Cruises on the globe — fourth collection off its Leaflet iframe.
 *
 * The prediction held: worldcruise is config. Its adapter is `voyage.ts`
 * unchanged, its predicate is byte-identical to yacht's apart from the `wc_`
 * prefix, and this file differs from AtlasYacht only in the feed paths, the
 * accent, and the fact that it has no bundled logo assets.
 *
 * Feature-checked before porting, per D3-FEATURE-INVENTORY.md:
 *
 *   geometry  Deliverable 1's precompute covers ALL 250 voyages — 3,017 legs,
 *             the densest of the three sea files. No live A*, no land mask.
 *   accent    #3fc1b0, the atlas's own --accent. Differs from AtlasShell's
 *             OVERLAYS entry (#45d6c2); the atlas's own value wins, as with
 *             yacht (#caa44e vs #e0b84a). Worth assuming this holds for cruise
 *             too rather than trusting OVERLAYS.
 *   logos     no bundled assets — the favicon services and the coloured-initials
 *             fallback in BrandLogo carry all 13 lines on their own.
 *   ports     971, resolved EXACTLY (voyage family), so the type-ahead matters
 *             more here than anywhere except cruise.
 */

import { useCallback } from "react";
import AtlasCollection from "./AtlasCollection";
import { adaptWorldCruise, WORLDCRUISE_DESCRIPTOR } from "@/lib/atlas/adapters/worldcruise";
import { loadSeaRoutes } from "@/lib/atlas/adapters/sea-geometry";
import type { RawVoyageAtlas } from "@/lib/atlas/adapters/voyage";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";

export default function AtlasWorldCruise() {
  const load = useCallback(async (): Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
    routeFor?: (o: AtlasOffering) => { mode: string; coordinates: [number, number][] }[] | null;
    brandMarks?: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null }>;
    logoBase?: string;
  }> => {
    const [raw, seaRoutes] = await Promise.all([
      fetch("/maps/worldcruise/itinerary.json", { cache: "force-cache" }).then((r) => {
        if (!r.ok) throw new Error(`worldcruise itinerary ${r.status}`);
        return r.json() as Promise<RawVoyageAtlas>;
      }),
      loadSeaRoutes("worldcruise"),
    ]);

    const offerings = adaptWorldCruise(raw);
    const regionLabels: Record<string, string> = {};
    for (const [key, r] of Object.entries(raw.REGIONS || {})) {
      regionLabels[key] = r?.name || key;
    }

    const ctx: ParseContext = {
      brands: Object.entries(raw.BRANDS || {}).map(([key, b]) => ({ key, short: b?.short })),
      regions: Object.entries(raw.REGIONS || {}).map(([key, r]) => ({ key, name: r?.name, ab: r?.ab })),
      // Exact port matching, as the original does. 971 of them.
      stopNames: Object.keys(raw.PORTS || {}),
    };

    // Full coverage: every one of the 250 voyages has precomputed legs.
    const routeFor = (o: AtlasOffering) => seaRoutes.get(o.id) ?? null;

    const brandMarks: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null }> = {};
    for (const [key, b] of Object.entries(raw.BRANDS || {})) {
      brandMarks[key] = { key, short: b?.short, domain: b?.domain, color: b?.color };
    }

    // No bundled logo assets for this collection; BrandLogo falls straight
    // through to the favicon services and then coloured initials.
    return { offerings, ctx, regionLabels, routeFor, brandMarks, logoBase: "/maps/worldcruise/logos" };
  }, []);

  return (
    <AtlasCollection
      type="worldcruise"
      descriptor={WORLDCRUISE_DESCRIPTOR}
      load={load}
      // Teal, from the world-cruise atlas's own --accent.
      accent="#3fc1b0"
      initialStyle="satellite"
    />
  );
}

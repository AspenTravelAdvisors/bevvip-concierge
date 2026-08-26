"use client";

/**
 * Luxury Hotel Yachts on the globe — first of the voyages family.
 *
 * Checked against D3-FEATURE-INVENTORY.md before porting, not after:
 *
 *   geometry  the Leaflet atlas runs the sea router live (land mask + A*) on
 *             hover. Deliverable 1 already precomputed exactly that into
 *             sea-routes-yacht.json — 1,045 deduplicated legs covering 368 of
 *             374 voyages — so this reads geometry instead of shipping a
 *             765 KB mask and an A* implementation to the browser.
 *   accent    #caa44e, the yacht atlas's own --accent. NOTE this differs from
 *             AtlasShell's OVERLAYS entry (#e0b84a); the atlas's own value wins,
 *             because that is the colour the collection is recognised by.
 *   logos     same 3-tier chain, assets under /maps/yacht/logos.
 *   filters   ports and ships, no region exclusion — all descriptor-driven.
 */

import { useCallback } from "react";
import AtlasCollection from "./AtlasCollection";
import { adaptYacht, YACHT_DESCRIPTOR } from "@/lib/atlas/adapters/yacht";
import { loadSeaRoutes } from "@/lib/atlas/adapters/sea-geometry";
import type { RawVoyageAtlas } from "@/lib/atlas/adapters/voyage";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";

export default function AtlasYacht() {
  const load = useCallback(async (): Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
    routeFor?: (o: AtlasOffering) => { mode: string; coordinates: [number, number][] }[] | null;
    brandMarks?: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null; glyph?: string | null }>;
    logoBase?: string;
  }> => {
    // Itinerary and precomputed routes together, as the Leaflet atlas loads its
    // land mask alongside the tiles rather than waiting for a hover.
    const [raw, seaRoutes] = await Promise.all([
      fetch("/maps/yacht/itinerary.json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`yacht itinerary ${r.status}`);
        return r.json() as Promise<RawVoyageAtlas>;
      }),
      loadSeaRoutes("yacht"),
    ]);

    const offerings = adaptYacht(raw);
    const regionLabels: Record<string, string> = {};
    for (const [key, r] of Object.entries(raw.REGIONS || {})) {
      regionLabels[key] = r?.name || key;
    }

    const ctx: ParseContext = {
      brands: Object.entries(raw.BRANDS || {}).map(([key, b]) => ({ key, short: b?.short })),
      regions: Object.entries(raw.REGIONS || {}).map(([key, r]) => ({ key, name: r?.name, ab: r?.ab })),
      // Voyages resolve `port=` EXACTLY against the PORTS map — no
      // normalisation, matching the original. See D3-FILTER-INVENTORY.md.
      stopNames: Object.keys(raw.PORTS || {}),
    };

    // Land-avoiding legs from the build-time router. The six voyages with no
    // precomputed geometry fall back to straight port-to-port legs, which is
    // honest rather than an invented curve.
    const routeFor = (o: AtlasOffering) => seaRoutes.get(o.id) ?? null;

    const brandMarks: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null; glyph?: string | null }> = {};
    for (const [key, b] of Object.entries(raw.BRANDS || {})) {
      brandMarks[key] = { key, short: b?.short, domain: b?.domain, color: b?.color, glyph: b?.glyph };
    }

    return { offerings, ctx, regionLabels, routeFor, brandMarks, logoBase: "/maps/yacht/logos" };
  }, []);


  /*
   * The supplier's photograph, at the card's top edge.
   *
   * AtlasCollection only takes `cardMedia` from a collection whose feed really
   * carries images — a grid of grey rectangles is worse than none. The Virtuoso
   * sync filled 467 of 467 voyages, so the slot opens here the same way it did for hotels,
   * with the brand mark riding on the photograph instead of the head row.
   */
  const cardMedia = useCallback((o: AtlasOffering) => {
    const src = typeof o.thumb === "string" ? o.thumb : null;
    return (
      <span className="ac-media">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" />
        ) : (
          <span className="ac-media-empty" />
        )}
      </span>
    );
  }, []);

  return (
    <AtlasCollection
      cardMedia={cardMedia}
      // The brand mark rides on the photograph, as it does on the hotel cards.
      markOverMedia
      type="yacht"
      descriptor={YACHT_DESCRIPTOR}
      load={load}
      // Gold, from the yacht atlas's own --accent.
      accent="#caa44e"
      // Sea routes read well on satellite — ocean is a calm, dark backdrop,
      // unlike the bright terrain that made rail and jet a contrast problem.
      initialStyle="satellite"
    />
  );
}

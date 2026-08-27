"use client";

/**
 * Rail Journeys on the globe — the first collection off its Leaflet iframe.
 *
 * Deliberately thin: it knows how to fetch and adapt one feed, and hands
 * everything else to AtlasCollection. The other four collections should each be
 * a file this size; if one isn't, that is a signal the descriptor is missing an
 * axis rather than a reason to special-case the shared component.
 */

import { useCallback, useRef } from "react";
import AtlasCollection from "./AtlasCollection";
import JourneyDossier, { type JourneyRecord } from "./JourneyDossier";
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
    brandMarks?: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null; glyph?: string | null }>;
    logoBase?: string;
  }> => {
    // Same static feed the Leaflet atlas used — cached by the CDN, so this is
    // not new traffic, it is the same bytes without the iframe around them.
    // The itinerary and the track geometry load together, as the Leaflet atlas
    // did — it kicks loadRailGeo() alongside the map tiles rather than waiting
    // for a hover.
    const [raw, railGeo] = await Promise.all([
      fetch("/maps/train/itinerary.json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`train itinerary ${r.status}`);
        return r.json() as Promise<RawJourneyAtlas>;
      }),
      loadRailGeometry(),
    ]);

    const offerings = adaptTrain(raw);

    // Keep the raw journeys for the dossier.
    recordsRef.current = new Map((raw.TRIPS ?? []).map((t, i) => [
      String(t.id ?? i),
      {
        title: t.n ?? "Journey",
        operator: raw.BRANDS?.[t.b ?? ""]?.short ?? null,
        ship: t.train ?? null,
        dates: t.win ?? t.d ?? null,
        days: t.days ?? null,
        from: t.from ?? null,
        to: t.to ?? null,
        description: t.description ?? null,
        itinerary: (t.itin ?? []).map((s) => ({ day: s.d ?? null, name: s.n ?? null, sea: false })),
        included: t.included ?? [],
        offers: t.promotions ?? [],
        href: t.u ?? null,
      } as JourneyRecord,
    ]));
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
    const brandMarks: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null; glyph?: string | null }> = {};
    for (const [key, b] of Object.entries(raw.BRANDS || {})) {
      brandMarks[key] = { key, short: b?.short, domain: b?.domain, color: b?.color, glyph: b?.glyph };
    }

    return { offerings, ctx, regionLabels, routeFor, brandMarks, logoBase: "/maps/train/logos" };
  }, []);

  // Copper, from the rail atlas's own --accent.
  /*
   * The operator's photograph, at the card's top edge.
   *
   * AtlasCollection only takes `cardMedia` from a feed that really carries
   * images; the Virtuoso sync filled 126 of 127 rail journeys, so the slot opens
   * here as it did for hotels, with the brand mark on the photograph.
   */
  const cardMedia = useCallback((o: AtlasOffering) => {
    const src = typeof o.thumb === "string" ? o.thumb : null;
    return (
      <span className="ac-media">
        {/* A live supplier offer, flagged on the feed. The terms are in the
            dossier; on a card the badge only has to be worth the click. */}
        {o.hasPromotion && <span className="ac-offer-badge">✦ Offer</span>}
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" />
        ) : (
          <span className="ac-media-empty" />
        )}
      </span>
    );
  }, []);


  /*
   * Records for the dossier, captured while the feed is already in hand.
   *
   * The atlas downloads the whole itinerary to draw the map, so the file for a
   * voyage is in memory before anyone asks for it.
   */
  const recordsRef = useRef<Map<string, JourneyRecord>>(new Map());

  const detailFor = useCallback((o: AtlasOffering, { close }: { close: () => void }) => {
    const rec = recordsRef.current.get(String(o.id));
    if (!rec) return null;
    return <JourneyDossier record={rec} close={close} />;
  }, []);

  return (
    <AtlasCollection
      detailFor={detailFor}
      type="train"
      descriptor={TRAIN_DESCRIPTOR}
      load={load}
      accent="#e08d5f"
      cardMedia={cardMedia}
      markOverMedia
    />
  );
}

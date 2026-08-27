"use client";

/**
 * Safari Journeys on the globe.
 *
 * Deliberately thin, like the rail and jet collections it sits beside: it knows
 * how to fetch and adapt one feed and hands everything else to AtlasCollection.
 *
 * The one thing it does differently is the route. Rail draws real track
 * polylines and the sea atlases draw routed lanes, because a train and a ship
 * are constrained to a network. A safari is not: the leg from the Mara to the
 * Serengeti is a light aircraft, and the leg from camp to camp is a Land
 * Cruiser on tracks no map has. Drawing an invented road would be a lie with a
 * confident line on it, so the stops are joined directly — the same honesty the
 * rail atlas applies to its own gaps.
 */

import { useCallback, useRef } from "react";
import AtlasCollection from "./AtlasCollection";
import JourneyDossier, { type JourneyRecord } from "./JourneyDossier";
import { adaptSafari, SAFARI_DESCRIPTOR } from "@/lib/atlas/adapters/safari";
import type { RawJourneyAtlas } from "@/lib/atlas/adapters/journey";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";

export default function AtlasSafari() {
  /** Journey files, held from the feed the map already loaded. */
  const recordsRef = useRef<Map<string, JourneyRecord>>(new Map());
  const routesRef = useRef<RawJourneyAtlas["ROUTES"]>({});

  const load = useCallback(async (): Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
    routeFor?: (o: AtlasOffering) => { mode: string; coordinates: [number, number][] }[] | null;
    brandMarks?: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null; glyph?: string | null }>;
    logoBase?: string;
  }> => {
    const raw: RawJourneyAtlas = await fetch("/maps/safari/itinerary.json", { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`safari itinerary ${r.status}`);
      return r.json() as Promise<RawJourneyAtlas>;
    });

    const offerings = adaptSafari(raw);
    routesRef.current = raw.ROUTES ?? {};

    recordsRef.current = new Map((raw.TRIPS ?? []).map((t, i) => [
      String(t.id ?? i),
      {
        title: t.n ?? "Safari",
        operator: raw.BRANDS?.[t.b ?? ""]?.short ?? null,
        ship: null,
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
    for (const [key, r] of Object.entries(raw.REGIONS || {})) regionLabels[key] = r?.name || key;

    const ctx: ParseContext = {
      brands: Object.entries(raw.BRANDS || {}).map(([key, b]) => ({ key, short: b?.short })),
      regions: Object.entries(raw.REGIONS || {}).map(([key, r]) => ({ key, name: r?.name, ab: r?.ab })),
      stopNames: [...new Set(Object.values(raw.ROUTES || {}).flatMap((stops) => (stops ?? []).map((s) => s?.n).filter(Boolean)))] as string[],
    };

    // Stop to stop, straight. See the note at the top of the file.
    const routeFor = (o: AtlasOffering) => {
      const stops = routesRef.current?.[String(o.id)] ?? [];
      const points = stops
        .map((s) => s?.ll)
        .filter((ll): ll is [number, number] => Array.isArray(ll) && Number.isFinite(ll[0]) && Number.isFinite(ll[1]));
      if (points.length < 2) return null;
      return [{ mode: "primary", coordinates: points.map((p) => [p[0], p[1]] as [number, number]) }];
    };

    const brandMarks: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null; glyph?: string | null }> = {};
    for (const [key, b] of Object.entries(raw.BRANDS || {})) {
      brandMarks[key] = { key, short: b?.short, domain: b?.domain, color: b?.color, glyph: b?.glyph };
    }

    return { offerings, ctx, regionLabels, routeFor, brandMarks, logoBase: "/maps/safari/logos" };
  }, []);

  const detailFor = useCallback((o: AtlasOffering, { close }: { close: () => void }) => {
    const rec = recordsRef.current.get(String(o.id));
    if (!rec) return null;
    return <JourneyDossier record={rec} close={close} />;
  }, []);

  const cardMedia = useCallback((o: AtlasOffering) => {
    const src = typeof o.thumb === "string" ? o.thumb : null;
    return (
      <span className="ac-media">
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

  return (
    <AtlasCollection
      type="safari"
      descriptor={SAFARI_DESCRIPTOR}
      load={load}
      // Ochre, distinct from rail's copper and the jet atlas's gold.
      accent="#c9812f"
      cardMedia={cardMedia}
      markOverMedia
      detailFor={detailFor}
    />
  );
}

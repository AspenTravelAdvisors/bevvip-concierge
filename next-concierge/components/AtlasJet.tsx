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
 * reads as a wire rather than a journey.
 *
 * But it flies a SPECIFIC arc. The sea router's `arcPts` bezier is a fine
 * chart convention for a short coastal hop and the wrong thing here, because a
 * flight path is a great circle and anyone who has watched a seat-back map
 * knows what one looks like. Worse, the bezier's bulge follows the leg's
 * direction, so a return leg bowed south — Los Angeles → Tokyo dipped past
 * Hawaii, and an out-and-back itinerary drew a lens rather than a path.
 * `geodesicLine` draws the track the aircraft actually flies.
 *
 * Legs are unrolled before arcing, for the same reason the sea router unrolls:
 * arcing a raw Tokyo → Los Angeles pair sweeps west across Asia and Africa
 * instead of east across the Pacific.
 */

import { useCallback, useRef } from "react";
import AtlasCollection from "./AtlasCollection";
import JourneyDossier, { type JourneyRecord } from "./JourneyDossier";
import { adaptJet, JET_DESCRIPTOR } from "@/lib/atlas/adapters/jet";
import type { RawJourneyAtlas } from "@/lib/atlas/adapters/journey";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";
import { geodesicLine, unrollLine } from "@/lib/atlas/geo";
import { indexGateways, NO_GATEWAYS, type GatewayIndex } from "@/lib/atlas/gateway-hotels";

export default function AtlasJet() {
  /*
   * The hotels at either end, from the other half of the collection.
   *
   * Held in a ref for the same reason the journey records are: the dossier
   * reads it for a list that does not change after load. See
   * lib/atlas/gateway-hotels.ts for what the join does and does not claim.
   */
  const gatewaysRef = useRef<GatewayIndex>(NO_GATEWAYS);

  const load = useCallback(async (): Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
    routeFor?: (o: AtlasOffering) => { mode: string; coordinates: [number, number][] }[] | null;
    brandMarks?: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null; glyph?: string | null }>;
    logoBase?: string;
  }> => {
    /*
     * Two files, one round trip's worth of latency.
     *
     * The gateways file is 140 KB against the itinerary's 330 KB and is not on
     * the critical path — the map draws without it — so it is fetched alongside
     * rather than after, and a failure to load it degrades to a dossier with no
     * stays block rather than an atlas that does not load.
     */
    const [raw, gateways] = await Promise.all([
      fetch("/maps/jet/itinerary.json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`jet itinerary ${r.status}`);
        return r.json() as Promise<RawJourneyAtlas>;
      }),
      fetch("/maps/jet/gateways.json", { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    const offerings = adaptJet(raw);
    gatewaysRef.current = indexGateways(gateways);

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
        stays: gatewaysRef.current.forTrip(String(t.id ?? i)),
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
      stopNames: [...new Set(offerings.flatMap((o) => o.stops.map((s) => s.name)))],
    };

    const routeFor = (o: AtlasOffering) => {
      const located = o.stops.filter((s) => s.at).map((s) => s.at!);
      if (located.length < 2) return null;
      // Unroll the whole sequence first, then arc within that frame.
      const frame = unrollLine(located);
      const coordinates: [number, number][] = [];
      for (let i = 0; i < frame.length - 1; i++) {
        // geodesicLine densifies by the leg's own angular length, so a Tokyo →
        // Los Angeles crossing gets the ~100 points it needs to avoid visible
        // chords and a Nice → Athens hop stops paying for them.
        const seg = geodesicLine(frame[i], frame[i + 1]);
        for (let k = coordinates.length ? 1 : 0; k < seg.length; k++) {
          coordinates.push([seg[k][0], seg[k][1]]);
        }
      }
      // "primary" — the collection's own route line in platinum, NOT the faint
      // ferry-hop connector. That connector is dashed 2/9 and reads as sparse
      // scaffolding when it is carrying the whole journey.
      return coordinates.length >= 2 ? [{ mode: "primary", coordinates }] : null;
    };

    // Brand marks drive the card logos: bundled asset → favicon services →
    // coloured initials. BRANDS carries the domain and the brand colour.
    const brandMarks: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null; glyph?: string | null }> = {};
    for (const [key, b] of Object.entries(raw.BRANDS || {})) {
      brandMarks[key] = { key, short: b?.short, domain: b?.domain, color: b?.color, glyph: b?.glyph };
    }

    return { offerings, ctx, regionLabels, routeFor, brandMarks, logoBase: "/maps/jet/logos" };
  }, []);


  /*
   * The supplier's photograph, at the card's top edge.
   *
   * AtlasCollection only takes `cardMedia` from a collection whose feed really
   * carries images — a grid of grey rectangles is worse than none. The Virtuoso
   * sync filled 95 of 122 journeys, so the slot opens here the same way it did for hotels,
   * with the brand mark riding on the photograph instead of the head row.
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
      cardMedia={cardMedia}
      // The brand mark rides on the photograph, as it does on the hotel cards.
      markOverMedia
      type="jet"
      descriptor={JET_DESCRIPTOR}
      load={load}
      // Platinum, from the jet atlas's own --accent: #dfe5f2.
      accent="#dfe5f2"
      // Satellite, and back on the GLOBE. Flat was a blanket fix for a problem
      // only round-the-world itineraries have, and those no longer ask the
      // frame to hold them at all: a traced jet route too wide to fit turns the
      // globe until its departure is in view instead of trying to fit the whole
      // itinerary onto a rectangle (see framesFromDeparture). The sphere is the
      // point there, not a compromise. A Mediterranean jet tour keeps the same
      // globe, framed end to end.
      initialStyle="satellite"
    />
  );
}

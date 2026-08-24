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

import { useCallback } from "react";
import AtlasCollection from "./AtlasCollection";
import { adaptJet, JET_DESCRIPTOR } from "@/lib/atlas/adapters/jet";
import type { RawJourneyAtlas } from "@/lib/atlas/adapters/journey";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";
import { geodesicLine, unrollLine } from "@/lib/atlas/geo";

export default function AtlasJet() {
  const load = useCallback(async (): Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
    routeFor?: (o: AtlasOffering) => { mode: string; coordinates: [number, number][] }[] | null;
    brandMarks?: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null; glyph?: string | null }>;
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

  return (
    <AtlasCollection
      type="jet"
      descriptor={JET_DESCRIPTOR}
      load={load}
      // Platinum, from the jet atlas's own --accent: #dfe5f2.
      accent="#dfe5f2"
      // Satellite, and back on the GLOBE. Flat was a blanket fix for a problem
      // only round-the-world itineraries have; those now flatten themselves
      // when traced (see flattenIfCircumnavigation), so a Mediterranean jet
      // tour keeps the globe it deserves.
      initialStyle="satellite"
    />
  );
}

"use client";

/**
 * VIP Hotels — browse on the shared surface, inspect in Google Photorealistic 3D.
 *
 * Deliverable 2, and a SPLIT rather than a port. The work order is emphatic
 * that the Google 3D view stays:
 *
 *   > Mapbox has no equivalent (its "3D buildings" are extruded footprints — a
 *   > grey block where the hotel is). For a luxury travel product this is the
 *   > single most persuasive thing the app does. It stays.
 *
 * So each engine gets the job it is good at, split along the hotel atlas's own
 * camera logic (DETAIL_TILT engages at DETAIL_RANGE = 2,600 m and eases flat by
 * 220 km): photoreal 3D is worthless at globe zoom and unbeatable at property
 * zoom.
 *
 *   BROWSE   here — 2,501 hotels on the Mapbox globe, filtered by category,
 *            program, country and macro-region.
 *   INSPECT  "See it in 3D" opens /maps/hotel/index.html?hotel=<id>, which
 *            lands on the open detail panel and flies to the building. That
 *            deep link only became reliable after the camera-race fix in
 *            STATE.md — before it, a shared property orbited forever.
 *
 * Hotels are the first collection whose filter grammar genuinely differs from
 * the five retired atlases; every divergence is documented in
 * lib/atlas/adapters/hotel.ts and asserted by scripts/verify-hotels.mjs
 * (1.75M comparisons against the original predicate).
 *
 * Nothing here touches GOOGLE_MAPS_API_KEY, /api/hotel/config, or the
 * /maps/hotel/api/* rewrite — all three must survive, per the work order's
 * "three things that will look like cleanup and are not".
 */

import { useCallback } from "react";
import AtlasCollection from "./AtlasCollection";
import { adaptHotels, HOTEL_DESCRIPTOR, type RawHotelPoints } from "@/lib/atlas/adapters/hotel";
import { REGION_ORDER } from "@/lib/atlas/adapters/hotel-regions";
import { programDomain } from "@/lib/atlas/adapters/hotel-programs";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";
import type { BrandMark } from "./BrandLogo";
import { hotel3dOpened } from "@/lib/analytics";

export default function AtlasHotel() {
  const load = useCallback(async () => {
    // The same point feed the home globe already fetches — no new payload.
    const raw: RawHotelPoints = await fetch("/maps/hotel/hotel-points.json", {
      cache: "force-cache",
    }).then((r) => {
      if (!r.ok) throw new Error(`hotel points ${r.status}`);
      return r.json();
    });

    const offerings = adaptHotels(raw);

    // Macro-regions in the original's geographic display order, not alphabetical
    // — "North America, Caribbean, … Polar" reads as a journey outward.
    const present = new Set(offerings.flatMap((o) => o.regions));
    const ordered = REGION_ORDER.filter((r) => present.has(r));
    const regionLabels: Record<string, string> = {};
    for (const r of ordered) regionLabels[r] = r;

    // Marks are keyed by PROGRAM (see AtlasOffering.logoKey): every one of the
    // 38 programs has a domain, so each card gets a real logo.
    const brandMarks: Record<string, BrandMark> = {};
    for (const o of offerings) {
      const key = o.logoKey;
      if (!key || brandMarks[key]) continue;
      brandMarks[key] = { key, short: key, domain: programDomain(key) };
    }

    const ctx: ParseContext = {
      brands: [],
      regions: ordered.map((key) => ({ key, name: key })),
      // Hotels have no itinerary, so no stop filter — see the descriptor.
      stopNames: [],
    };

    return {
      offerings,
      ctx,
      regionLabels,
      // A hotel has no route. Returning null lets AtlasCollection fall through
      // to framing its single located stop: click a card, fly to the property.
      routeFor: () => null,
      brandMarks,
      logoBase: "",
    };
  }, []);

  /**
   * Hand off to the photoreal view. `hotel=` is the param the original uses for
   * "a shared selected hotel: opens its detail panel and starts the orbit on
   * load" — which is exactly this gesture, so the same link a Share button
   * produces is the one this button opens.
   */
  const openIn3D = useCallback((o: AtlasOffering) => {
    hotel3dOpened(o.id, "card");
    window.open(`/maps/hotel/index.html?hotel=${encodeURIComponent(o.id)}`, "_blank", "noopener");
  }, []);

  return (
    <AtlasCollection
      type="hotel"
      descriptor={HOTEL_DESCRIPTOR}
      load={load}
      // The hotel atlas's own accent.
      accent="#caa44e"
      initialStyle="satellite"
      cardAction={{ label: "See it in 3D ↗", onSelect: openIn3D }}
    />
  );
}

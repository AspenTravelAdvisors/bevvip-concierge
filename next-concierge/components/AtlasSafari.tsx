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

import { useCallback, useRef, useState } from "react";
import { fromLatLngPair, isFinitePair, unrollLine } from "@/lib/atlas/geo";
import { ATLASES } from "@/lib/atlas-config";
import { indexCamps, NO_CAMPS, ALL_LODGES_HREF, type SafariCampIndex } from "@/lib/atlas/safari-camps";
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
  /*
   * The camps, from the other half of the collection.
   *
   * Held in a ref for the same reason the journey files are: the card note and
   * the dossier both read it, on every render, for a list that does not change
   * after load. See lib/atlas/safari-camps.ts for what the join does and does
   * not claim.
   */
  const campsRef = useRef<SafariCampIndex>(NO_CAMPS);
  /*
   * The lodge count, in state rather than the ref, because the collection-level
   * link renders it and a ref cannot wake a render. It is the only thing about
   * the camps file that changes what this component returns.
   */
  const [lodgeCount, setLodgeCount] = useState(0);

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
     * The camps file is 48 KB against the itinerary's 890 KB and is not on the
     * critical path — the map draws without it — so it is fetched alongside
     * rather than after, and a failure to load it degrades to an atlas with no
     * camps block rather than an atlas that does not load. The itinerary is
     * still allowed to throw: without it there is nothing to show.
     */
    const [raw, camps] = await Promise.all([
      fetch("/maps/safari/itinerary.json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`safari itinerary ${r.status}`);
        return r.json() as Promise<RawJourneyAtlas>;
      }),
      fetch("/maps/safari/camps.json", { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    const offerings = adaptSafari(raw);
    routesRef.current = raw.ROUTES ?? {};
    campsRef.current = indexCamps(camps);
    setLodgeCount(campsRef.current.lodgesInSafariCountries);

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
        camps: campsRef.current.forTrip(String(t.id ?? i)),
        campRadiusKm: campsRef.current.radiusKm,
      } as JourneyRecord,
    ]));

    const regionLabels: Record<string, string> = {};
    for (const [key, r] of Object.entries(raw.REGIONS || {})) regionLabels[key] = r?.name || key;

    const ctx: ParseContext = {
      brands: Object.entries(raw.BRANDS || {}).map(([key, b]) => ({ key, short: b?.short })),
      regions: Object.entries(raw.REGIONS || {}).map(([key, r]) => ({ key, name: r?.name, ab: r?.ab })),
      stopNames: [...new Set(Object.values(raw.ROUTES || {}).flatMap((stops) => (stops ?? []).map((s) => s?.n).filter(Boolean)))] as string[],
    };

    /*
     * Stop to stop, straight. See the note at the top of the file.
     *
     * The points come from the ADAPTED offering, not from raw ROUTES. That is
     * the whole correctness of this function: the feed stores every stop as
     * `ll: [lat, lng]` — the convention every atlas's REGIONS and ROUTES use —
     * while the map, like GeoJSON, wants [lng, lat]. Reading `ll` and handing
     * it straight to the renderer silently transposes the continent: the
     * Namibia circuit, [-22.57, 17.08], drew as lat 17 / lng -22, a triangle
     * in the Atlantic off Cape Verde, and every other journey landed somewhere
     * equally wrong. `o.path` is `fromLatLngPair()`'d by journey.ts, in
     * itinerary order, so it is already in the frame the map reads.
     *
     * unrollLine only matters for a leg that would cross the antimeridian.
     * Nothing in Africa does, and no safari journey ever will — but it is one
     * call, it is what every other journey atlas does, and it costs nothing to
     * be right if the collection ever reaches beyond the continent.
     */
    const routeFor = (o: AtlasOffering) => {
      const path = o.path.length >= 2
        ? o.path
        : (routesRef.current?.[String(o.id)] ?? [])
            .filter((s): s is { ll: [number, number] } & typeof s => isFinitePair(s?.ll))
            .map((s) => fromLatLngPair(s.ll));
      if (path.length < 2) return null;
      const coordinates = unrollLine(path).map((p) => [p[0], p[1]] as [number, number]);
      return [{ mode: "primary", coordinates }];
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

  /*
   * The camps line on the card.
   *
   * Names rather than a bare count: "3 camps" is a number a traveller has to
   * open the card to understand, while "Singita Sabi Sand · Royal Malewane"
   * IS the reason to open it. Two names and an overflow, because the row is one
   * line and four Sabi Sand lodges would fill it with a reserve rather than a
   * journey.
   */
  const cardNote = useCallback((o: AtlasOffering) => {
    const camps = campsRef.current.forTrip(String(o.id));
    if (!camps.length) return null;
    const names = camps.slice(0, 2).map((c) => c.name);
    const rest = camps.length - names.length;
    return (
      <>
        <span className="sf-camp-flag">Our camps</span>
        {names.join(" · ")}
        {rest > 0 ? ` +${rest}` : ""}
      </>
    );
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
      // Read from the registry — the colour is argued in lib/atlas-config.ts,
      // where it can be compared against the other seven. A literal here is how
      // it drifts.
      accent={ATLASES.safari.color}
      cardMedia={cardMedia}
      cardNote={cardNote}
      markOverMedia
      detailFor={detailFor}
      /*
       * The other half of the collection, named and counted from the data.
       *
       * The count is derived rather than typed. The last hand-kept safari
       * figure in this repo said 166 and shipped a link to an unfiltered atlas
       * of 2,240 hotels; the category has held 72 since deriveCategory() stopped
       * filing Ecotourism hotels as lodges, of which 32 are in countries these
       * journeys actually visit. That 32 is the honest number for a link
       * offered on the safari atlas, and it now comes from the same build that
       * produced the camps.
       */
      aside={
        lodgeCount > 0 ? (
          <a className="sf-lodges" href={ALL_LODGES_HREF}>
            {lodgeCount} safari lodges ↗
          </a>
        ) : null
      }
    />
  );
}

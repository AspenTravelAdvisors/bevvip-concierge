"use client";

/**
 * Expedition Cruises on the globe — the fifth and last collection, and the one
 * that shares no adapter family.
 *
 * Feature-checked against D3-FEATURE-INVENTORY.md before porting:
 *
 *   source    THREE files, not one. `sailings.json` is columnar
 *             (`{schema, rows}`, 3,542 rows), `atlas-meta.json` carries
 *             OPERATORS/REGIONS, and `data/itinerary-routes.json` the day-by-day
 *             ports. Hence `adaptCruise(sailings, meta, routes)` rather than the
 *             single-argument adapters the other four use.
 *   geometry  Deliverable 1's precompute covers 2,829 of 3,542 sailings — the
 *             gap is exactly the 712 whose route ports are all un-geocoded, so
 *             there is nothing to draw for them and nothing missing.
 *   accent    #5aa9e6 — and here it MATCHES AtlasShell's OVERLAYS entry. The
 *             mismatch was yacht and worldcruise only; cruise is consistent.
 *   ships     filtered from the sailings dataset's own `ship` column, which is
 *             what WORKORDER-expedition-ship-data.md Deliverable 4 asks for:
 *             "a true per-sailing filter … sourced from the sailings, not from
 *             ships.json". The port satisfies that by construction —
 *             AtlasFilterRail derives ship options from the offerings.
 *             `ships.json` stays enrichment-only, as that work order intends.
 */

import { useCallback, useRef } from "react";
import AtlasCollection from "./AtlasCollection";
import JourneyDossier, { type JourneyRecord } from "./JourneyDossier";
import { indexGateways, NO_GATEWAYS, type GatewayIndex } from "@/lib/atlas/gateway-hotels";
import {
  adaptCruise,
  CRUISE_DESCRIPTOR,
  type RawCruiseMeta,
  type RawCruiseRegionOverrides,
  type RawCruiseRoutes,
  type RawCruiseSailings,
} from "@/lib/atlas/adapters/cruise";
import { loadSeaRoutes } from "@/lib/atlas/adapters/sea-geometry";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";

export default function AtlasCruise() {
  /* The hotels at either end — see lib/atlas/gateway-hotels.ts. */
  const gatewaysRef = useRef<GatewayIndex>(NO_GATEWAYS);

  const load = useCallback(async (): Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
    routeFor?: (o: AtlasOffering) => { mode: string; coordinates: [number, number][] }[] | null;
    brandMarks?: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null }>;
    logoBase?: string;
  }> => {
    const [sailings, meta, routes, regionOverrides, seaRoutes, gateways] = await Promise.all([
      fetch("/maps/cruise/sailings.json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`cruise sailings ${r.status}`);
        return r.json() as Promise<RawCruiseSailings>;
      }),
      fetch("/maps/cruise/atlas-meta.json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`cruise meta ${r.status}`);
        return r.json() as Promise<RawCruiseMeta>;
      }),
      fetch("/maps/cruise/data/itinerary-routes.json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`cruise routes ${r.status}`);
        return r.json() as Promise<RawCruiseRoutes>;
      }),
      // The geographic region correction (see scripts/build-cruise-regions.mjs).
      // Non-fatal: without it the atlas falls back to the feed's own buckets and
      // the title rules, which is worse but still a working map.
      fetch("/maps/cruise/region-overrides.json", { cache: "no-cache" })
        .then((r) => (r.ok ? (r.json() as Promise<RawCruiseRegionOverrides>) : {}))
        .catch(() => ({} as RawCruiseRegionOverrides)),
      loadSeaRoutes("cruise"),
      // The hotels at either end of the sailing — the collection where the
      // night before is least optional and hardest to place. Where the gateway
      // is a city it is answered well (Reykjavík, Vancouver, Lisbon, Papeete);
      // where it is Longyearbyen or Puerto Baquerizo Moreno the hotel atlas
      // holds nothing within reach, and 668 sailings get no block rather than a
      // wrong one. Non-fatal: without the file the block simply does not render.
      fetch("/maps/cruise/gateways.json", { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    const offerings = adaptCruise(sailings, meta, routes, regionOverrides);
    gatewaysRef.current = indexGateways(gateways);

    /*
     * Records for the dossier, from the columnar feed.
     *
     * sailings.json is `{schema, rows}` rather than objects, so the columns are
     * resolved by name once and the day-by-day stops come from the routes file
     * the map is already using.
     */
    const col: Record<string, number> = {};
    (sailings.schema ?? []).forEach((n: string, i: number) => { col[n] = i; });
    // The supplier's own listing, built the way adaptCruise builds the card's:
    // `urlBase` + id + slug. The dossier needs it for the same reason the card
    // does, and for one more — the description arrives clipped, and the cut
    // wants somewhere to go.
    const urlBase = String(sailings.urlBase ?? "");
    recordsRef.current = new Map((sailings.rows ?? []).map((r: unknown[]) => {
      const cell = (i: number) => (r[i] == null ? "" : String(r[i]));
      const id = String(r[col.id] ?? "");
      // `itinerary-routes.json` is `{ _meta, routes }`, not a bare map.
      const days = routes.routes?.[id] ?? [];
      let offers: JourneyRecord["offers"] = [];
      try { offers = JSON.parse(cell(col.offers) || "[]"); } catch { offers = []; }
      return [id, {
        title: cell(col.name) || "Sailing",
        operator: cell(col.operator) || null,
        ship: cell(col.ship) || null,
        dates: cell(col.start) || null,
        days: Number(cell(col.nights)) || null,
        description: cell(col.description) || null,
        itinerary: days.map((d) => ({
          day: d.d ?? null,
          name: (d.p ?? []).map((p) => p[0]).filter(Boolean).join(", ") || null,
          sea: !(d.p ?? []).length,
        })),
        included: [],
        offers,
        href: (() => {
          const slug = cell(col.slug);
          return urlBase && slug ? `${urlBase}${id}/${slug}` : null;
        })(),
        stays: gatewaysRef.current.forTrip(id),
      } as JourneyRecord];
    }));

    // cruise's region is a SCALAR display name already ("Hawaii & Tahiti"),
    // corrected from the itinerary's ports by the overlay — so it is its own
    // label and needs no key→name map.
    const regionLabels: Record<string, string> = {};
    for (const o of offerings) for (const r of o.regions) regionLabels[r] = r;

    // Operators stand in for brands throughout this collection.
    const operators = [...new Set(offerings.map((o) => o.operator).filter(Boolean))] as string[];

    const ctx: ParseContext = {
      brands: operators.map((op) => ({ key: op, short: op })),
      regions: Object.keys(regionLabels).map((key) => ({ key, name: key })),
      // Exact port matching (voyage family). Only geocoded ports exist here.
      stopNames: [...new Set(offerings.flatMap((o) => o.stops.map((s) => s.name)))],
    };

    const routeFor = (o: AtlasOffering) => seaRoutes.get(o.id) ?? null;

    // Operator name → logo domain, from atlas-meta's OPERATORS map.
    const brandMarks: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null }> = {};
    for (const [name, info] of Object.entries(meta.OPERATORS || {})) {
      const m = info as { domain?: string; color?: string; short?: string } | undefined;
      brandMarks[name] = { key: name, short: m?.short || name, domain: m?.domain, color: m?.color };
    }

    return { offerings, ctx, regionLabels, routeFor, brandMarks, logoBase: "/maps/cruise/logos" };
  }, []);


  /*
   * The supplier's photograph, at the card's top edge.
   *
   * AtlasCollection only takes `cardMedia` from a collection whose feed really
   * carries images — a grid of grey rectangles is worse than none. The Virtuoso
   * sync filled every one of 3,662 sailings, so the slot opens here the same way it did for hotels,
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


  /** Sailing files, held from the feed the map already loaded. */
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
      type="cruise"
      descriptor={CRUISE_DESCRIPTOR}
      load={load}
      // Expedition blue, from the cruise atlas's own --accent (which agrees
      // with OVERLAYS here, unlike yacht and worldcruise).
      accent="#5aa9e6"
      initialStyle="satellite"
    />
  );
}

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

import { useCallback } from "react";
import AtlasCollection from "./AtlasCollection";
import {
  adaptCruise,
  CRUISE_DESCRIPTOR,
  type RawCruiseMeta,
  type RawCruiseRoutes,
  type RawCruiseSailings,
} from "@/lib/atlas/adapters/cruise";
import { loadSeaRoutes } from "@/lib/atlas/adapters/sea-geometry";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";

export default function AtlasCruise() {
  const load = useCallback(async (): Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
    routeFor?: (o: AtlasOffering) => { mode: string; coordinates: [number, number][] }[] | null;
    brandMarks?: Record<string, { key: string; short?: string | null; domain?: string | null; color?: string | null }>;
    logoBase?: string;
  }> => {
    const [sailings, meta, routes, seaRoutes] = await Promise.all([
      fetch("/maps/cruise/sailings.json", { cache: "force-cache" }).then((r) => {
        if (!r.ok) throw new Error(`cruise sailings ${r.status}`);
        return r.json() as Promise<RawCruiseSailings>;
      }),
      fetch("/maps/cruise/atlas-meta.json", { cache: "force-cache" }).then((r) => {
        if (!r.ok) throw new Error(`cruise meta ${r.status}`);
        return r.json() as Promise<RawCruiseMeta>;
      }),
      fetch("/maps/cruise/data/itinerary-routes.json", { cache: "force-cache" }).then((r) => {
        if (!r.ok) throw new Error(`cruise routes ${r.status}`);
        return r.json() as Promise<RawCruiseRoutes>;
      }),
      loadSeaRoutes("cruise"),
    ]);

    const offerings = adaptCruise(sailings, meta, routes);

    // cruise's region is a SCALAR display name already ("Hawaii & Tahiti"),
    // rewritten from the sailing title by correctedRegionName — so it is its
    // own label and needs no key→name map.
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

  return (
    <AtlasCollection
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

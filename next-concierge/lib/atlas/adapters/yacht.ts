/**
 * Luxury Hotel Yachts — public/maps/yacht/itinerary.json
 *
 * First of the voyages family. Unlike jet, the feed is complete: all 374 trips
 * carry id, monthKey, ship, brand and g, so there is no load-time normalisation
 * to reproduce. The shape work lives in voyage.ts.
 *
 * Introduces two things the journeys family has no equivalent for — a ship
 * filter (`ships=`) and a port filter with the embark/disembark/call role
 * vocabulary — and drops region exclusion.
 */

import { adaptVoyage, type RawVoyageAtlas } from "./voyage";
import type { AtlasFilterDescriptor, AtlasOffering } from "./types";

export const YACHT_DESCRIPTOR: AtlasFilterDescriptor = {
  collection: "yacht",
  stopParam: "port",
  stopRoleParam: "portrole",
  // NB: no "any" in this vocabulary — yacht and worldcruise accept only
  // embark/disembark/call, while cruise additionally accepts "any". Anything
  // unrecognised still falls through to "touches at all", matching the
  // original's trailing `return r.all.has(port)`.
  roles: "voyage",
  brandField: "brand",
  brandParam: "brand",
  supportsRegionExclusion: false, // no exRegions= on voyages
  supportsVesselFilter: true, // ships=
  // Live Virtuoso offers ride on these records since the migration.
  supportsPromotionFilter: true,
  idPrefix: "yc_",
};

export type RawYachtAtlas = RawVoyageAtlas;

export function adaptYacht(raw: RawYachtAtlas): AtlasOffering[] {
  return adaptVoyage(raw, YACHT_DESCRIPTOR);
}

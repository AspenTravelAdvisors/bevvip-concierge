/**
 * World Cruises — public/maps/worldcruise/itinerary.json
 *
 * The work order predicted this one would be "a config entry, not code", and it
 * is: diffing worldcruise/index.html against yacht/index.html, `textMatches`,
 * `tripPortRoles`, `tripMatchesPort`, `isPastTrip` and `matchesNonRegion` are
 * byte-identical apart from the `wc_` id prefix and one comment word
 * ("voyages" where yacht says "sailings"). All 250 trips carry id, monthKey,
 * ship, brand and g, so there is no load-time normalisation either.
 *
 * If a future refresh makes this file need real code, that is a signal the two
 * feeds have diverged — worth checking rather than papering over.
 */

import { adaptVoyage, type RawVoyageAtlas } from "./voyage";
import type { AtlasFilterDescriptor, AtlasOffering } from "./types";

export const WORLDCRUISE_DESCRIPTOR: AtlasFilterDescriptor = {
  collection: "worldcruise",
  stopParam: "port",
  stopRoleParam: "portrole",
  roles: "voyage", // embark | disembark | call — no "any", same as yacht
  brandField: "brand",
  brandParam: "brand",
  supportsRegionExclusion: false,
  supportsVesselFilter: true,
  idPrefix: "wc_",
};

export type RawWorldCruiseAtlas = RawVoyageAtlas;

export function adaptWorldCruise(raw: RawWorldCruiseAtlas): AtlasOffering[] {
  return adaptVoyage(raw, WORLDCRUISE_DESCRIPTOR);
}

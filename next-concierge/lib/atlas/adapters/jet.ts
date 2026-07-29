/**
 * Private Jet Journeys — public/maps/jet/itinerary.json
 *
 * Same family as rail, and the real test of whether AtlasFilterDescriptor
 * parameterises the differences or just relocated them. It does: this file is
 * config only. But jet's feed is materially thinner than rail's, and the
 * atlas's load-time pass does much more work as a result:
 *
 *   - No `mks` anywhere: all 107 dated trips get their month computed from `d`.
 *   - 39 trips carry no usable `g` and take their regions from the route.
 *   - 65 trips resolve their route by SLUGGED TITLE, not `t.route`; 33 have no
 *     route at all.
 *   - No `id` field whatsoever — see idStrategy below.
 *
 * The work order notes jet's itinerary data has no aircraft field, so the
 * "vessel" is left null and the programme is identified by brand.
 */

import { adaptJourney, type RawJourneyAtlas } from "./journey";
import type { AtlasFilterDescriptor, AtlasOffering } from "./types";

export const JET_DESCRIPTOR: AtlasFilterDescriptor = {
  collection: "jet",
  stopParam: "location",
  stopRoleParam: "locationrole",
  roles: "journey",
  brandField: "brand",
  brandParam: "brand",
  supportsRegionExclusion: true,
  supportsVesselFilter: false,
  idPrefix: "jt_",
  // An explicit route OVERRIDES the curated g[] here, unlike rail.
  regionDerivation: "whenRouted",
  /**
   * WARNING, preserved deliberately. The jet feed has no id field, so the
   * atlas assigns `guideId = 'jt_' + arrayIndex`. Every `ids=` deep link ever
   * shared for a jet journey therefore encodes a POSITION, not a product:
   * reorder or insert a trip upstream and `jt_7` silently resolves to a
   * different journey. Reproduced because changing it would break every link
   * already in the wild — but this is a data problem worth fixing at the
   * source, and it should be flagged before jet's links are advertised further.
   */
  idStrategy: "index",
};

export type RawJetAtlas = RawJourneyAtlas;

export function adaptJet(raw: RawJetAtlas): AtlasOffering[] {
  return adaptJourney(raw, JET_DESCRIPTOR);
}

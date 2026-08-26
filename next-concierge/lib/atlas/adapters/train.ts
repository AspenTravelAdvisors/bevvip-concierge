/**
 * Rail Journeys — public/maps/train/itinerary.json
 *
 * Ported first because it carries the hardest region model (include AND
 * exclude) and the only array-valued month field, on the smallest dataset
 * (135 trips). The shape work lives in journey.ts, shared with jet; this file
 * is the collection's configuration and nothing else.
 */

import { adaptJourney, type RawJourneyAtlas } from "./journey";
import type { AtlasFilterDescriptor, AtlasOffering } from "./types";

export const TRAIN_DESCRIPTOR: AtlasFilterDescriptor = {
  collection: "train",
  stopParam: "location",
  stopRoleParam: "locationrole",
  roles: "journey",
  brandField: "brand",
  brandParam: "brand",
  supportsRegionExclusion: true, // exRegions= — journeys only
  // rail's world=1 is the named-train view, not a round-the-world one
  worldLabel: "Legendary Trains",
  supportsVesselFilter: false, // rail has no ship filter
  idPrefix: "rj_",
  // Only back-fill regions when the curated g[] is empty (jet overrides more
  // aggressively). No current trip needs it, but a feed refresh could.
  regionDerivation: "whenEmpty",
  idStrategy: "field", // real product ids, unlike jet
};

export type RawTrainAtlas = RawJourneyAtlas;

export function adaptTrain(raw: RawTrainAtlas): AtlasOffering[] {
  return adaptJourney(raw, TRAIN_DESCRIPTOR);
}

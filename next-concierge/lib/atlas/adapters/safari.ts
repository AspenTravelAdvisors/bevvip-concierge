/**
 * Safari Journeys — public/maps/safari/itinerary.json
 *
 * The seventh collection, and the second built on the Virtuoso tours endpoint
 * rather than harvested. Shape work lives in journey.ts, shared with jet and
 * rail; this file is the collection's configuration and nothing else.
 *
 * Why it is a journeys collection and not a hotels one: a safari is sold as an
 * itinerary — Nairobi, then the Mara, then the Serengeti, then out through
 * Kilimanjaro — and the camps along it are the stops, not the product. The 166
 * safari lodges in the hotel atlas are the other half of the same holiday and
 * stay where they are.
 */

import { adaptJourney, type RawJourneyAtlas } from "./journey";
import type { AtlasFilterDescriptor, AtlasOffering } from "./types";

export const SAFARI_DESCRIPTOR: AtlasFilterDescriptor = {
  collection: "safari",
  stopParam: "location",
  stopRoleParam: "locationrole",
  roles: "journey",
  brandField: "brand",
  brandParam: "brand",
  // Journeys cross borders constantly here — a Kenya/Tanzania migration trip is
  // the normal case, not the exception — so both halves of the region model earn
  // their keep.
  supportsRegionExclusion: true,
  supportsVesselFilter: false,
  supportsPromotionFilter: true,
  idPrefix: "sf_",
  // The merge tags every journey from its own stops, so the curated list is
  // authoritative and never needs back-filling.
  regionDerivation: "whenEmpty",
  idStrategy: "field",
};

export type RawSafariAtlas = RawJourneyAtlas;

export function adaptSafari(raw: RawSafariAtlas): AtlasOffering[] {
  return adaptJourney(raw, SAFARI_DESCRIPTOR);
}

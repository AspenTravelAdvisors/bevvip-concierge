/**
 * Safari Journeys — public/maps/safari/itinerary.json
 *
 * The seventh collection, and the second built on the Virtuoso tours endpoint
 * rather than harvested. Shape work lives in journey.ts, shared with jet and
 * rail; this file is the collection's configuration and nothing else.
 *
 * Why it is a journeys collection and not a hotels one: a safari is sold as an
 * itinerary — Nairobi, then the Mara, then the Serengeti, then out through
 * Kilimanjaro — and the camps along it are the stops, not the product. The
 * safari lodges in the hotel atlas are the other half of the same holiday and
 * stay where they are; scripts/build-safari-camps.mjs joins the two by
 * coordinate so a journey's file can name the camps along it and link out to
 * the dossiers that already exist.
 *
 * That count used to read "166" here, which was the pre-fix figure: the
 * category held 166 only while deriveCategory() was also filing every
 * Ecotourism hotel — a palazzo on the Grand Canal among them — as a lodge. It
 * has held 72 since, 32 of them in countries these journeys visit. Nothing in
 * the UI types either number any more; both are derived by the camps build.
 */

import { adaptJourney, type RawJourneyAtlas } from "./journey";
import { WILDLIFE_FACET } from "@/lib/atlas/wildlife";
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
  /*
   * ── The axis this collection exists for ─────────────────────────────────
   *
   * Region, brand, month and length are the four axes every journey atlas
   * shares, and none of them is the question a safari traveller actually
   * arrives with. That question is WHAT WILL I SEE — the gorillas, the river
   * crossings, the Kalahari meerkats — and it cuts across all four: gorillas
   * are Rwanda and Uganda in any month, the migration is one ecosystem across
   * two countries in a moving window.
   *
   * One declared facet is the whole feature. journey.ts sees the key, runs the
   * shared detector over the supplier's own prose, and the rail control, the
   * live counts, the phone drawer, the `?wildlife=` deep link and its place in
   * a shared link all follow — the same way `city` was added to the hotel rail.
   */
  facets: [WILDLIFE_FACET],
};

export type RawSafariAtlas = RawJourneyAtlas;

export function adaptSafari(raw: RawSafariAtlas): AtlasOffering[] {
  return adaptJourney(raw, SAFARI_DESCRIPTOR);
}

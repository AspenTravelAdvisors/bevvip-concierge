// lib/virtuoso/safari-selector.mjs — what qualifies for the safari atlas.
//
// ── The question, and the answer that changed ───────────────────────────────
//
// The first rule was three tests, ALL of which had to pass:
//
//   1. a country in a list of thirteen African ones, AND
//   2. a `Wildlife & Nature` experience or a safari-ish word in the name, AND
//   3. an operator we sell.
//
// Test 1 was wrong, and it was wrong in a way that quietly capped the
// collection. A safari is a way of travelling — you go where the animals are,
// you sleep near them, a guide takes you out at dawn — and Africa is where it
// is most famous, not where it is defined. Natural Habitat sells twenty-one
// journeys on Virtuoso and this atlas held FOUR of them: the three Botswana
// itineraries and the Kenya migration. The Alaska grizzly camp, the Churchill
// polar bears, the Galápagos, Yellowstone in winter, the Indian tiger parks —
// every one of them is the same product, sold by the same house, to the same
// traveller, and every one was excluded for being in the wrong hemisphere.
// White Desert's Antarctic camps are the same story: a fly-in camp, a guide,
// and animals you cannot see anywhere else.
//
// So the country test is gone, and its job — keeping out the things that
// merely use the word — is now done properly by the other two:
//
//   1. The journey is ABOUT wildlife: `isWildlifeJourney()` in
//      lib/atlas/wildlife-terms.js, which is the same vocabulary the atlas
//      filter tags with. It wants the supplier's own `Wildlife & Nature`
//      classification, or a product name that says what the trip is, or prose
//      naming at least two different animals.
//   2. A house we sell it from. This is the quality bar the original rule
//      leaned on and it still carries the weight: the catalogue's wildlife
//      tours run from coach operators up to andBeyond and Wilderness, and this
//      atlas sits with the other seven, not below them.
//
// The gate is visible in the shipped feed, in both directions.
//
// Refused: "Tiger Express, Eastern & Oriental Express, a Belmond Train" passes
// the wildlife-name test on a train named after a tiger, and Belmond Trains is
// not a wildlife house. "Classic Rocky Mountain Rail Circle Tour" advertises
// "wildlife viewing of Grizzly bears, moose, elk and more" and is a scenic
// train that passes animals, sold by a Rocky Mountaineer reseller — the case
// the operator bar exists for, and the reason that reseller is not on the list
// even though one of its products is named after bears.
//
// Admitted, and all four were being thrown away: "In Search of the Royal
// Bengal Tiger" (Remote Lands), "Wildlife Kingdoms of Brazil" and "Wildlife &
// Natural Wonders: The Americas" (TCS, Blue Parallel), and — the one that
// makes the point best — andBeyond's "Rovos Rail: Pretoria-Durban", whose own
// description opens "This safari between Pretoria and Durban ... includes game
// drives" and visits a Big Five conservancy. It stays a rail journey too; a
// tour carries as many kinds as it earns.
//
// ── Why this is a module ────────────────────────────────────────────────────
//
// Two callers, and they see different data. `sync-virtuoso-tours.mjs` applies
// it at crawl time, where the API row still carries `experiences` — the
// strongest signal, and the one that admits a Nat Hab Alaska itinerary whose
// title is just "Alaska Bear Camp". `merge-virtuoso-journeys.mjs` applies it
// again to the feed already on disk, so a widened rule reaches the tours we
// already hold without waiting for a crawl.
//
// Those two views are NOT equivalent, and the merge's use is additive for that
// reason — see admitsStoredTour() below.

import { isWildlifeJourney } from "../atlas/wildlife-terms.js";

/**
 * The houses this atlas sells wildlife from.
 *
 * Kept in step with BRANDS in data/atlas/safari/itinerary.base.json, and the
 * two move together in that order: this pattern decides what the crawl KEEPS,
 * and the BRANDS table decides what the merge can then place. A tour selected
 * here whose company matches no brand key is counted as `unmatchedBrand` and
 * dropped — selected, downloaded, and thrown away.
 *
 * Three groups, and the grouping is the argument for each name:
 *
 *   · African safari houses — the original list, unchanged.
 *   · Worldwide wildlife specialists — houses whose whole catalogue is this,
 *     wherever it happens. Natural Habitat is the reason this rule changed;
 *     White Desert is the Antarctic case the same argument reaches.
 *   · Houses already in this feed selling a wildlife journey. Every one of
 *     these has a real itinerary in the shipped 505 that the old rule refused,
 *     which is why they are here rather than speculatively.
 *
 * A name earns a place here by selling wildlife journeys we would put in front
 * of a client — not by having the word "safari" in its marketing.
 */
export const SAFARI_OPERATOR = new RegExp(
  [
    // African safari houses.
    "abercrombie", "wilderness", "andbeyond", "and beyond", "ker & downey",
    "ker and downey", "artisans of leisure", "african travel", "singita",
    "great plains", "micato", "roar africa", "extraordinary journeys",
    "journeys by design", "tauck", "giltedge", "gilt edge",
    // Worldwide wildlife specialists.
    "natural habitat", "nat hab", "white desert", "lindblad",
    "national geographic", "frontiers north", "churchill wild",
    "natural world safaris", "bushtracks",
    // Already in the feed, already selling this.
    "remote lands", "tcs world travel", "blue parallel",
  ].join("|"),
  "i",
);

/**
 * Does this journey belong in the safari atlas?
 *
 * @param {{ name?: string|null, company?: string|null, description?: string|null,
 *           experiences?: string[]|null }} row
 */
export function isSafari(row) {
  if (!SAFARI_OPERATOR.test(row?.company ?? "")) return false;
  return isWildlifeJourney(row);
}

/**
 * Should the merge admit a tour the crawl did not mark `safari`?
 *
 * ── Why this is additive, and never subtractive ────────────────────────────
 *
 * The stored feed cannot reproduce the crawl's decision, because the crawl
 * reads a field the feed does not keep. `experiences` — the supplier's own
 * `Wildlife & Nature` classification — is tested on the API row and then
 * discarded, so of the 281 tours the crawl filed as safari, only ~178 can be
 * re-derived from disk. Re-running the selector as a REPLACEMENT would throw
 * away a hundred real journeys on the strength of a field we chose not to save.
 *
 * (`sync-virtuoso-tours.mjs` now stores `experiences`, so this asymmetry
 * shrinks with every crawl and this function's `kinds` fallback eventually
 * becomes redundant. Until then it is load-bearing.)
 *
 * So: the crawl's own verdict stands, and this only ever ADDS — a tour already
 * on disk that the widened rule now recognises. That is what lets "safari is
 * not only Africa" reach the inventory we already hold instead of waiting for
 * `api.virtuoso.com` to come off the blocklist.
 *
 * @param {{ kinds?: string[] }} tour a record from data/atlas/shared/virtuoso-tours.json
 */
export function admitsStoredTour(tour) {
  if ((tour?.kinds ?? []).includes("safari")) return true;
  return isSafari(tour);
}

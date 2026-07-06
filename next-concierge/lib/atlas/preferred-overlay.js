// lib/atlas/preferred-overlay.js — Base Camp T2 ranking overlay
//
// Turns data/atlas/hotel/preferred-partner-overlay.json into a per-hotel
// ranking signal. This is the metric that supersedes the old hotel-fit score
// for ordering: a hotel's preferred-partner relationship and its Forbes/AAA
// star rating decide placement, and the weak, compressed overallFitScore no
// longer participates (see lib/atlas/hotels.js).
//
// Two things co-lead the score (per product direction):
//   - a preferred partner that upgrades the room AT TIME OF BOOKING
//     (Dorchester, Oetker, Peninsula, Shangri-La, plus the independents the
//     overlay flags), and
//   - a Forbes/AAA five-star rating.
// A booking-upgrade brand that is also five-star sits at the very top; a bare
// five-star still edges out a preferred relationship that carries no benefit.
//
// Join strategy (mirrors the overlay _meta.matchingPrecedence):
//   1. exact property override — strict folded-name / alias equality
//   2. preferred program or brand — hotel.program matched to a program
//      name/alias
//   3. no overlay
// Program matching carries the bulk of the inventory reliably; the strict
// property layer adds the named independents and the exact-partner bonus
// without the false positives a fuzzy match would invite.

const overlay = require("../../data/atlas/hotel/preferred-partner-overlay.json");

// --- weights (data-driven, tunable in the JSON rankingPolicy) --------------
const POLICY = overlay.rankingPolicy || {};
const PREFERRED_PROGRAM_BOOST = num(POLICY.preferredProgramBoost, 12);
const EXACT_PARTNER_BONUS = num(POLICY.exactIndividualPartnerBonus, 4);
const AMENITY = POLICY.amenityBoosts || {};
const BOOKING_UPGRADE_BOOST = num(AMENITY.upgradeAtBooking, 8);
const AUTOMATIC_UPGRADE_BOOST = num(AMENITY.automaticUpgrade, 5);
const ARRIVAL_UPGRADE_BOOST = num(AMENITY.upgradeAtArrivalOrCheckIn, 3);
const RATING = POLICY.ratingBoosts || {};
const FIVE_STAR_BOOST = num(RATING.fiveStar, 14);
const FOUR_STAR_BOOST = num(RATING.fourStar, 5);

function num(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

// --- normalization ---------------------------------------------------------
// A tight key for program names (join must be exact): drop accents, fold
// ampersands, strip everything non-alphanumeric so "Shangri-La The Luxury
// Circle" and "Oetker Collection" match their overlay entries regardless of
// punctuation drift.
const progKey = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

// Property names keep word boundaries and drop the noise word "hotel" so
// "Le Bristol Paris" / "The Lanesborough London" line up with inventory names.
const nameKey = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bhotel\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// --- indexes (built once) --------------------------------------------------
const programById = new Map();
const programByKey = new Map();
for (const p of overlay.programs || []) {
  programById.set(p.id, p);
  programByKey.set(progKey(p.name), p);
  for (const a of p.aliases || []) programByKey.set(progKey(a), p);
}

// A program is a usable ranking signal only when it is an actual hotel program
// (tour operators and non-hotel partners are flagged hotelRankingEligible:false
// and must not lend a boost).
const programEligible = (p) => !!(p && p.hotelRankingEligible);

const propertyByName = new Map();
for (const prop of overlay.properties || []) {
  for (const label of [prop.name, ...(prop.aliases || [])]) {
    const k = nameKey(label);
    if (!k) continue;
    // First writer wins; duplicates across same-named entries are rare and the
    // benefit flags are equivalent when they collide.
    if (!propertyByName.has(k)) propertyByName.set(k, prop);
  }
}

// A property override inherits eligibility from the program(s) it participates
// in; if none is resolvable we still treat a listed property as preferred,
// since its presence in the overlay is itself the relationship.
function propertyEligible(prop) {
  const ids = Array.isArray(prop.programIds) ? prop.programIds : [];
  if (!ids.length) return true;
  return ids.some((id) => programEligible(programById.get(id)));
}

const UPGRADE_ON_ARRIVAL = new Set(["arrival", "check-in", "checkin", "arrival-or-check-in"]);

// --- resolution ------------------------------------------------------------
// Returns the resolved overlay signal for a hotel, or null when it carries no
// preferred relationship. Property override (exact) beats program match.
function overlayFor(hotel) {
  if (!hotel) return null;

  const prop = propertyByName.get(nameKey(hotel.name));
  if (prop && propertyEligible(prop)) {
    return {
      source: "property",
      programId: (prop.programIds && prop.programIds[0]) || null,
      eligible: true,
      exactProperty: true,
      upgradeAtBooking: !!prop.upgradeAtBooking,
      automaticUpgrade: !!prop.automaticUpgrade,
      upgradeTiming: prop.upgradeTiming || null,
    };
  }

  const prog = programByKey.get(progKey(hotel.program));
  if (programEligible(prog)) {
    return {
      source: "program",
      programId: prog.id,
      eligible: true,
      exactProperty: false,
      upgradeAtBooking: !!prog.upgradeAtBooking,
      automaticUpgrade: !!prog.automaticUpgrade,
      upgradeTiming: prog.upgradeTiming || null,
    };
  }

  return null;
}

// --- scoring ---------------------------------------------------------------
// ratingLevel is passed in (owned by hotels.js, which reads the Forbes/AAA
// values off the fit row) so the two modules agree on what "five-star" means
// without this file taking a dependency on the fit data.
function preferredScore(hotel, ratingLevel) {
  let s = 0;
  const m = overlayFor(hotel);
  if (m) {
    if (m.eligible) s += PREFERRED_PROGRAM_BOOST;
    if (m.exactProperty) s += EXACT_PARTNER_BONUS;
    if (m.upgradeAtBooking) s += BOOKING_UPGRADE_BOOST;
    else if (m.automaticUpgrade) s += AUTOMATIC_UPGRADE_BOOST;
    else if (UPGRADE_ON_ARRIVAL.has(String(m.upgradeTiming))) s += ARRIVAL_UPGRADE_BOOST;
  }
  const rating = Number(ratingLevel) || 0;
  if (rating >= 5) s += FIVE_STAR_BOOST;
  else if (rating >= 4) s += FOUR_STAR_BOOST;
  return s;
}

// Coarse tier for the intent path, where fine intent-fit ordering should still
// operate WITHIN a preferred/rating band rather than being flattened by the raw
// score. 3 = booking-upgrade or five-star (foremost); 2 = otherwise-benefitted
// preferred or four-star; 1 = bare preferred; 0 = no overlay, no rating.
function preferredTier(hotel, ratingLevel) {
  const m = overlayFor(hotel);
  const rating = Number(ratingLevel) || 0;
  const booking = !!(m && m.upgradeAtBooking);
  if (booking || rating >= 5) return 3;
  const benefitted = !!(m && (m.automaticUpgrade || UPGRADE_ON_ARRIVAL.has(String(m.upgradeTiming))));
  if ((m && benefitted) || rating >= 4) return 2;
  if (m && m.eligible) return 1;
  return 0;
}

module.exports = {
  overlayFor,
  preferredScore,
  preferredTier,
  _weights: {
    PREFERRED_PROGRAM_BOOST,
    EXACT_PARTNER_BONUS,
    BOOKING_UPGRADE_BOOST,
    AUTOMATIC_UPGRADE_BOOST,
    ARRIVAL_UPGRADE_BOOST,
    FIVE_STAR_BOOST,
    FOUR_STAR_BOOST,
  },
};

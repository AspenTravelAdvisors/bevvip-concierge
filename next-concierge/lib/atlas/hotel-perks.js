// lib/atlas/hotel-perks.js — the VIP benefit line on a hotel card.
//
// `luxury-hotels.json` carries `vipUpgrades`: the property's Virtuoso (or other
// preferred-partner) amenity block, as the supplier wrote it. 2,338 of 2,475
// hotels have one, averaging 5.3 lines, and the lines are prose —
//
//   "For 2026:"
//   "Upgrade on arrival, subject to availability"
//   "Daily Buffet breakfast for up to two guests per bedroom, served in the
//    restaurant"
//   "$100 USD equivalent Resort or Hotel credit to be utilized during stay (not
//    combinable, not redeemable for cash)"
//   "Complimentary Wi-Fi"
//
// — which is right for the dossier, where the traveller is reading the offer,
// and hopeless on a card, where there is room for one line. This reduces the
// block to at most three short tags in the order a traveller values them:
//
//   Daily breakfast · $100 credit · Room upgrade
//
// WHY TAGS AND NOT THE FIRST LINE. The most common first line is "Upgrade on
// arrival, subject to availability" (1,962 properties), so a card built from it
// would say the same unremarkable thing everywhere while the $100 credit and
// the breakfast — the two things that actually decide a booking — stayed buried
// three lines down. Ranking beats truncating.
//
// The classifier is deliberately conservative: a line that matches nothing
// contributes nothing, and a property that matches nothing gets no benefit line
// rather than a wrong one. 2,270 of 2,475 currently produce three tags, 205
// produce none.

/**
 * Rules in priority order — and the priority IS the card order, so the tags
 * read the way the offer is worth reading rather than the way the supplier
 * happened to type it. First match per source line wins.
 */
const RULES = [
  { re: /\bbreakfast\b/i, tag: () => "Daily breakfast" },
  // The amount, when the line names one. `$45 per person` breakfast credits are
  // caught by the breakfast rule above and never reach here.
  { re: /\$\s?(\d{2,4})[^.]{0,40}\bcredit\b/i, tag: (m) => `$${m[1]} credit` },
  { re: /\bcredit\b/i, tag: () => "Property credit" },
  // "Upgrade not applicable for this property" is a disclaimer, not a benefit,
  // and printing it as one would be a lie on a card.
  { re: /\bupgrade\b/i, skip: /not applicable|no upgrade/i, tag: () => "Room upgrade" },
  { re: /\bmassage\b|\bspa\b/i, tag: () => "Spa treatment" },
  { re: /\btransfers?\b/i, tag: () => "Airport transfer" },
  { re: /early check|late check/i, tag: () => "Early check-in" },
  { re: /\bwi-?fi\b/i, tag: () => "Wi-Fi" },
];

/**
 * Lines that are not benefits: the year header the blocks open with, and the
 * boilerplate about contacting an advisor (which is the page's whole premise,
 * not this property's amenity).
 */
const NOISE = /^for\s+\d{4}|virtuoso (travel )?advisor|contact your/i;

/**
 * Up to `max` benefit tags for one hotel record, most valuable first.
 *
 * @param {{vipUpgrades?: unknown[]}} hotel
 * @param {number} [max]
 * @returns {string[]} e.g. ["Daily breakfast", "$100 credit", "Room upgrade"]
 */
function hotelPerks(hotel, max = 3) {
  const found = new Map();
  for (const raw of (hotel && hotel.vipUpgrades) || []) {
    const line = String(raw || "").trim();
    if (!line || NOISE.test(line)) continue;
    for (let rank = 0; rank < RULES.length; rank++) {
      const rule = RULES[rank];
      if (!rule.re.test(line) || (rule.skip && rule.skip.test(line))) continue;
      const tag = rule.tag(line.match(rule.re));
      // One entry per family, so a block naming a $50 and a $100 credit yields
      // one credit tag — the larger, which is the one worth reading.
      const family = /credit$/.test(tag) ? "credit" : tag;
      const amount = Number((tag.match(/\$(\d+)/) || [])[1] || 0);
      const prev = found.get(family);
      if (!prev || amount > prev.amount) found.set(family, { tag, rank, amount });
      break; // one tag per source line
    }
  }
  return [...found.values()]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, max)
    .map((v) => v.tag);
}

// CJS, like its siblings in this directory: the only consumer is
// scripts/build-hotel-points.mjs, which runs under plain Node where a bare .js
// file is CommonJS (next-concierge/package.json declares no "type").
module.exports = { hotelPerks };

/**
 * Villa card contract — the four things that must stay true of every record the
 * villa surfaces show, checked against the whole 3,902-villa dataset rather
 * than a sample.
 *
 * Each of these is a rule that already broke once, quietly, and would break the
 * same way after any re-scrape:
 *
 *   1. PRICE SAYS WHAT THE SUPPLIER SAYS. The feed carries two rates.
 *      `rate_from_usd` is a base rate; `price_low` / `price_string` is what
 *      VillaInfo publishes. Formatting from the base rate quoted $1,700/nt for a
 *      villa listed at $2,258 (798 records diverge), and printed a rate for 425
 *      villas whose `price_string` is "Call for Pricing" — the supplier
 *      withholding a number and us supplying one anyway.
 *   2. THE FILTER AGREES WITH THE DISPLAY. Whatever number a card shows is the
 *      number `priceMax` compares. A cap that admits a villa priced above it, or
 *      one whose displayed price the cap never saw, is worse than no cap.
 *   3. BEDROOMS MEAN BOOKABLE BEDROOMS. `capacity.bedrooms` is the villa's size;
 *      `available_bedrooms` is what the supplier will rent, and they disagree in
 *      45 records in both directions.
 *   4. INTERNAL FIELDS STOP AT THE SERVER. `searchVillas` feeds the search API,
 *      the atlas's SSR payload and the Guide's cards — every one of them ends up
 *      in a browser, so the supplier deep link, the agency-side rate and the
 *      undocumented availability flag must not be in its output.
 *
 *   node scripts/verify-villas.mjs
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// The shipped module and the raw feed, so both sides of every rule are real.
const villaLib = require(join(ROOT, "lib/villas.js"));
const source = require(join(ROOT, "data/villas-of-distinction.json"));

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`);
  }
};
const sample = (list, n = 3) =>
  list.slice(0, n).map((s) => `- ${s}`).join("\n       ") + (list.length > n ? `\n       …and ${list.length - n} more` : "");

const villas = villaLib.loadVillas().villas;
const rawById = new Map(source.villas.map((v) => [v.id, v]));

console.log(`\nVilla card contract — ${villas.length} records\n`);

// ── 1. price says what the supplier says ────────────────────────────────────
console.log("Price");

const zeroPriced = villas.filter((v) => /\$0(\b|\/)/.test(v.priceDisplay));
check("no villa displays $0", zeroPriced.length === 0, zeroPriced.length && sample(zeroPriced.map((v) => `${v.name}: ${v.priceDisplay}`)));

const quotedDespiteCFP = villas.filter((v) => {
  const raw = rawById.get(v.id);
  const cfp = String(raw?.pricing?.price_string || "").trim().toLowerCase() === "call for pricing";
  return cfp && v.nightlyFromUsd != null;
});
check(
  'no rate shown where the supplier says "Call for Pricing"',
  quotedDespiteCFP.length === 0,
  quotedDespiteCFP.length && sample(quotedDespiteCFP.map((v) => `${v.name}: ${v.priceDisplay}`)),
);

const underquoted = villas.filter((v) => {
  const raw = rawById.get(v.id);
  const published = Number(raw?.pricing?.price_low) || 0;
  return published > 0 && v.nightlyFromUsd != null && Math.round(v.nightlyFromUsd) < Math.round(published);
});
check(
  "no villa displays less than the supplier's published price",
  underquoted.length === 0,
  underquoted.length &&
    sample(underquoted.map((v) => `${v.name}: shows ${v.priceDisplay}, supplier ${rawById.get(v.id).pricing.price_string}`)),
);

const cfpCount = villas.filter((v) => v.nightlyFromUsd == null).length;
check(
  "every price-on-request villa says so in its display string",
  villas.filter((v) => v.nightlyFromUsd == null && !/call for pricing/i.test(v.priceDisplay)).length === 0,
);
console.log(`       (${cfpCount} villas price on request)`);

// ── 2. the filter agrees with the display ───────────────────────────────────
console.log("\nPrice cap");

for (const cap of [500, 1500, 5000]) {
  const capped = villaLib.searchVillas({ priceMax: cap, perPage: 50 });
  const over = capped.results.filter((v) => v.nightlyFromUsd != null && v.nightlyFromUsd > cap);
  const unpriced = capped.results.filter((v) => v.nightlyFromUsd == null);
  check(
    `priceMax=${cap} returns nothing above the cap`,
    over.length === 0,
    over.length && sample(over.map((v) => `${v.name}: ${v.priceDisplay}`)),
  );
  check(
    `priceMax=${cap} excludes price-on-request villas (they cannot be verified against a budget)`,
    unpriced.length === 0,
  );
  // The displayed string is built from the same number the cap filtered on, so
  // a card under a cap can never read higher than the cap.
  const displayOverCap = capped.results.filter((v) => {
    const shown = Number(String(v.priceDisplay).replace(/[^0-9]/g, ""));
    return Number.isFinite(shown) && shown > cap;
  });
  check(`priceMax=${cap} shows no card reading above the cap`, displayOverCap.length === 0);
}

// ── 3. bedrooms mean bookable bedrooms ──────────────────────────────────────
console.log("\nBedrooms");

const badOptions = villas.filter(
  (v) =>
    !Array.isArray(v.bedroomOptions) ||
    v.bedroomOptions.some((n) => !Number.isFinite(n) || n <= 0) ||
    v.bedroomOptions.some((n, i) => i > 0 && n <= v.bedroomOptions[i - 1]),
);
check("bedroomOptions is ascending, positive and de-duplicated everywhere", badOptions.length === 0,
  badOptions.length && sample(badOptions.map((v) => `${v.name}: ${JSON.stringify(v.bedroomOptions)}`)));

const badMax = villas.filter(
  (v) => v.bedroomOptions.length && v.bedroomsMax !== v.bedroomOptions[v.bedroomOptions.length - 1],
);
check("bedroomsMax is the largest bookable count", badMax.length === 0);

// The 45 records where the supplier's bookable counts disagree with the size
// field are the whole reason the filter reads bedroomsMax. Both directions.
const disagreeing = villas.filter((v) => v.bedroomOptions.length && v.bedroomsMax !== v.bedrooms);
check("the disagreeing records still exist to be tested", disagreeing.length > 0, `found ${disagreeing.length}`);

const rentsMore = disagreeing.filter((v) => v.bedroomsMax > v.bedrooms);
const rentsFewer = disagreeing.filter((v) => v.bedroomsMax < v.bedrooms);
// Scoped by `ids` so this tests the bedrooms filter itself: a destination-wide
// search would let pagination hide a match on page six and read as a filter bug.
const admits = (v, bedrooms) =>
  villaLib.searchVillas({ ids: String(v.id), bedrooms, perPage: 1 }).total === 1;

for (const v of rentsMore.slice(0, 5)) {
  check(
    `${v.name} (rents ${v.bedroomsMax}, size says ${v.bedrooms}) is returned by a ${v.bedroomsMax}-bedroom search`,
    admits(v, v.bedroomsMax),
  );
}
for (const v of rentsFewer.slice(0, 5)) {
  check(
    `${v.name} (rents only ${v.bedroomsMax}, size says ${v.bedrooms}) is NOT returned by a ${v.bedrooms}-bedroom search`,
    !admits(v, v.bedrooms),
  );
  // …and is still reachable at the size it does rent.
  check(`${v.name} is returned by a ${v.bedroomsMax}-bedroom search`, admits(v, v.bedroomsMax));
}

// ── 4. internal fields stop at the server ───────────────────────────────────
console.log("\nClient projection");

const INTERNAL = ["supplierDeepLink", "baseRateUsd", "liveAvailability", "geoPrecision", "bedroomsMax"];
// An open search plus the shapes most likely to carry a stray field through.
const projections = [
  villaLib.searchVillas({ perPage: 50 }),
  villaLib.searchVillas({ region: "Caribbean", sleeps: 10, perPage: 50 }),
  villaLib.searchVillas({ featured: "1", perPage: 50 }),
  villaLib.searchVillas({ specials: "1", perPage: 50 }),
];
for (const field of INTERNAL) {
  const leaked = projections.flatMap((p) => p.results.filter((v) => field in v));
  check(`searchVillas never returns ${field}`, leaked.length === 0, leaked.length && sample(leaked.map((v) => v.name)));
}
// The same guarantee stated against the serialized payload, which is what a
// browser actually receives.
const serialized = JSON.stringify(projections.map((p) => p.results));
check(
  "no supplier URL appears in a serialized search payload",
  !serialized.includes("villainfo.villasofdistinction.com"),
);
// …while the server-side record keeps them, because the detail page renders the
// supplier reference from it.
const oneId = villas[0].id;
check(
  "getVillaById still carries the internal fields for server-side callers",
  INTERNAL.every((f) => f in villaLib.getVillaById(oneId)),
);

// Fields a card actually reads must survive the projection.
const CARD_FIELDS = [
  "id", "name", "slug", "destinationSlug", "region", "destination", "location",
  "lat", "lon", "exactLocation", "sleeps", "bedrooms", "bedroomOptions", "bathrooms",
  "nightlyFromUsd", "priceDisplay", "featured", "hasSpecials", "specialCategory",
  "specials", "summary", "imageUrl",
];
const missing = CARD_FIELDS.filter((f) => !(f in projections[0].results[0]));
check("every field the cards render survives the projection", missing.length === 0, missing.join(", "));

console.log(
  failures === 0
    ? `\nThe villa cards say what the feed says\n`
    : `\n${failures} failure(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);

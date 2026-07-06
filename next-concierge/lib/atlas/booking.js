// lib/atlas/booking.js — the single booking-link seam (BOOKING-SPEC §4).
// Every booking CTA in the app calls these helpers; no component builds a
// TravelWits URL by hand. mode: "off" | "portal" | "deep" from
// NEXT_PUBLIC_BOOKING_MODE (default "deep").
//
// TravelWits deep links (aspentraveladvisors.travelwits.com) are a
// DESTINATION + DATES search priced at the preferred VIP rate codes — there is
// no per-property id in the URL. The search area is a Google Place (sa[value])
// plus a human label (sa[label]); the ten rateCodes with exactMatch make the
// results price at the VIP rate. So a dated destination search lands on live
// VIP rates that include the property, which satisfies the trust rule (§6): the
// link only appears once we have dates, and it lands on a real rate page.
//
// The access code (bookPassword) still gates the portal, so it rides along as a
// note on every booking affordance, deep or portal.

const MODE = process.env.NEXT_PUBLIC_BOOKING_MODE || "deep";

const TW_BASE = "https://aspentraveladvisors.travelwits.com/";

// The preferred VIP rate codes, sent on every search with exactMatch so results
// price at the VIP rate. Constant across destinations (from the reference link).
const TW_RATE_CODES = ["X2T", "VMC", "API", "BEL", "CDH", "L72", "RQ6", "SAC", "STP", "TLC"];

// Known Google Place ids for search labels we can resolve exactly. Optional:
// without one the label alone still drives the search. Extend as destinations
// recur, or resolve via a Places lookup later. Keyed by a normalized label.
const TW_PLACE_IDS = {
  "new york, ny, usa": "ChIJOwg_06VPwokRYv534QaPC8g",
};

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());

// Serialize as `key=encodedValue`, keeping the literal `[` / `]` in keys (like
// rateCodes[0], sa[label]) that the reference URL uses — URLSearchParams would
// percent-encode the brackets, so we build the query by hand.
function toQuery(pairs) {
  return pairs
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

// Build the TravelWits destination-search URL for a label + dates. Returns null
// when a required piece (dates, label) is missing — a "Book VIP rate" link must
// never point at a page that cannot show a rate.
export function travelWitsUrl({ label, checkIn, checkOut }) {
  const location = String(label || "").trim();
  if (!location || !isDay(checkIn) || !isDay(checkOut)) return null;
  const pairs = [
    ["selectedCurrency", "USD"],
    ["checkInDate", checkIn],
    ["checkOutDate", checkOut],
    ...TW_RATE_CODES.map((code, i) => [`rateCodes[${i}]`, code]),
    ["exactMatchRateCodesOnly", "true"],
    ["searchRadiuses[0]", "50"],
    ["searchMode", "2"],
    ["sa[value]", TW_PLACE_IDS[norm(location)] || ""],
    ["sa[label]", location],
  ];
  return `${TW_BASE}?${toQuery(pairs)}`;
}

// US country spellings in the inventory, and full state name -> abbreviation.
// TravelWits geocodes best on "City, ST, USA" (US) and "City, Country" (rest),
// so US cards need the state abbreviation and "USA" rather than "United States".
const US_COUNTRY = new Set([
  "united states", "united states of america", "usa", "us", "u.s.", "u.s.a.", "america",
]);
const US_STATE_ABBR = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
  "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
  "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
  "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
  "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
  "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN",
  "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
  "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
  "district of columbia": "DC", "washington dc": "DC", "washington, d.c.": "DC",
};

// TravelWits search label for a hotel card's own destination:
//   US  -> "City, ST, USA"  (e.g. "Aspen, CO, USA", "New York, NY, USA")
//   else -> "City, Country" (e.g. "Venice, Italy")
function hotelSearchLabel(hotel) {
  if (!hotel) return "";
  const city = String(hotel.city || "").trim();
  const country = String(hotel.country || "").trim();
  if (US_COUNTRY.has(country.toLowerCase())) {
    const admin = String(hotel.adminRegion || "").trim();
    const state = US_STATE_ABBR[admin.toLowerCase()] || admin; // fall back to the full name
    return [city, state, "USA"].filter(Boolean).join(", ");
  }
  if (city && country) return `${city}, ${country}`;
  return city || country || String(hotel.region || "").trim() || "";
}

// The booking affordance for a hotel card, or null when no booking UI should
// render. Shape: { kind, url, label, external, note? }.
//  - deep  (dates present): TravelWits search of the hotel's own city at VIP
//    rates for the captured dates → "Book VIP rate". Primary-worthy.
//  - portal (no dates, or deep unavailable): the gated VipTravelAi.com portal →
//    "Check VIP rates". Secondary; honest about being a portal, not a rate page.
export function bookingLink(hotel, trip) {
  if (MODE === "off") return null;

  const password = String((hotel && hotel.bookPassword) || "").trim();
  const note = password ? `Access code: ${password}` : undefined;
  const type = String((hotel && hotel.type) || "");
  const isHotel = type === "hotel" || !type;

  if (MODE === "deep" && isHotel) {
    const url = travelWitsUrl({
      label: hotelSearchLabel(hotel) || (trip && trip.destination) || "",
      checkIn: trip && trip.checkIn,
      checkOut: trip && trip.checkOut,
    });
    if (url) {
      return { kind: "deep", url, label: "Book VIP rate", external: true, ...(note ? { note } : {}) };
    }
    // no dates yet (or unresolvable) → fall through to the portal affordance
  }

  const raw = String((hotel && hotel.bookUrl) || "").trim();
  if (!raw) return null;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  // Cruise/jet/yacht bookUrls point at a Virtuoso journey page (photos, route,
  // description) rather than a live VIP rate quote, so "Check VIP rates" would
  // overpromise — only hotels land on an actual rate portal.
  const label = isHotel ? "Check VIP rates" : "See more details";
  return { kind: "portal", url, label, external: true, ...(note ? { note } : {}) };
}

// A destination-level booking link for the BookingStrip's captured trip (dates +
// free-text destination). Returns null until dates and a destination exist.
export function destinationBookingUrl(trip) {
  if (MODE === "off" || !trip) return null;
  return travelWitsUrl({
    label: trip.destination || "",
    checkIn: trip.checkIn,
    checkOut: trip.checkOut,
  });
}

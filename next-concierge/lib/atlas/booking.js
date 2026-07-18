// lib/atlas/booking.js — the single booking-link seam (BOOKING-SPEC §4).
// Every booking CTA in the app calls these helpers; no component builds a
// TravelWits URL by hand. mode: "off" | "portal" | "deep" from
// NEXT_PUBLIC_BOOKING_MODE (default "deep").
//
// TravelWits deep links (aspentraveladvisors.travelwits.com) are a named-place
// search priced at the preferred VIP rate codes. For hotel CTAs, we search the
// property name itself for a one-night stay checking in tomorrow.
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
  "savoy palace, london, uk": "ChIJ2TTjMsoEdkgRRQZD30XAn68",
};

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());
const pad2 = (n) => String(n).padStart(2, "0");

function localIsoDay(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addLocalDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function tomorrowNightStay(now = new Date()) {
  return {
    checkIn: localIsoDay(addLocalDays(now, 1)),
    checkOut: localIsoDay(addLocalDays(now, 2)),
  };
}

// Serialize as `key=encodedValue`, keeping the literal `[` / `]` in keys (like
// rateCodes[0], sa[label]) that the reference URL uses — URLSearchParams would
// percent-encode the brackets, so we build the query by hand.
function toQuery(pairs) {
  return pairs
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

// Build the TravelWits search URL for a place + dates. The portal only
// auto-runs the search when the place is identified by a TravelWits hotelId
// (sa[hotelId] + sa[lat]/sa[lon]) or a Google Place id (sa[value]); with a bare
// text label it strands the visitor at the search form ("Address is
// required"). So this returns null unless dates, a label, AND one of those
// identifiers are present — a "Book VIP rate" link must never point at a page
// that cannot show a rate.
export function travelWitsUrl({ label, checkIn, checkOut, hotelId, lat, lon }) {
  const location = String(label || "").trim();
  if (!location || !isDay(checkIn) || !isDay(checkOut)) return null;
  const placeId = TW_PLACE_IDS[norm(location)] || "";
  const hasHotel = hotelId != null && String(hotelId).trim() !== "";
  if (!hasHotel && !placeId) return null;
  const pairs = [
    ["checkInDate", checkIn],
    ["checkOutDate", checkOut],
    ...TW_RATE_CODES.map((code, i) => [`rateCodes[${i}]`, code]),
    ["exactMatchRateCodesOnly", "true"],
    ["searchRadiuses[0]", "50"],
    ["selectedCurrency", "USD"],
    ["searchMode", "2"],
    ...(hasHotel
      ? [
          ["sa[hotelId]", String(hotelId).trim()],
          ["sa[label]", location],
          ["sa[lat]", lat],
          ["sa[lon]", lon],
        ]
      : [
          ["sa[value]", placeId],
          ["sa[label]", location],
        ]),
  ];
  return `${TW_BASE}?${toQuery(pairs)}`;
}

// US country spellings in the inventory, and full state name -> abbreviation.
// TravelWits geocodes best when US labels use the state abbreviation and "USA"
// rather than "United States"; UK labels use the short "UK" form from the
// reference URL.
const US_COUNTRY = new Set([
  "united states", "united states of america", "usa", "us", "u.s.", "u.s.a.", "america",
]);
const UK_COUNTRY = new Set(["united kingdom", "uk", "u.k.", "great britain", "gb"]);
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

function compactParts(parts) {
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const value = String(part || "").trim();
    const key = norm(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

// TravelWits search label for a hotel card's own property:
//   US  -> "Hotel Name, City, ST, USA"
//   UK  -> "Hotel Name, City, UK"
//   else -> "Hotel Name, City, Country"
function hotelSearchLabel(hotel) {
  if (!hotel) return "";
  const name = String(hotel.name || "").trim();
  const city = String(hotel.city || "").trim();
  const country = String(hotel.country || "").trim();
  if (US_COUNTRY.has(country.toLowerCase())) {
    const admin = String(hotel.adminRegion || "").trim();
    const state = US_STATE_ABBR[admin.toLowerCase()] || admin; // fall back to the full name
    return compactParts([name, city, state, "USA"]).join(", ");
  }
  const displayCountry = UK_COUNTRY.has(country.toLowerCase()) ? "UK" : country;
  return compactParts([name, city, displayCountry]).join(", ")
    || String(hotel.region || "").trim();
}

// The booking affordance for a hotel card, or null when no booking UI should
// render. Shape: { kind, url, label, external, note? }.
//  - deep: TravelWits search of the hotel's own name at VIP rates for a
//    one-night stay checking in tomorrow → "Book VIP rate". Primary-worthy.
//  - portal (deep unavailable): the gated VipTravelAi.com portal →
//    "Check VIP rates". Secondary; honest about being a portal, not a rate page.
export function bookingLink(hotel, trip) {
  if (MODE === "off") return null;

  const password = String((hotel && hotel.bookPassword) || "").trim();
  const note = password ? `Access code: ${password}` : undefined;
  const type = String((hotel && hotel.type) || "");
  const isHotel = type === "hotel" || !type;

  if (MODE === "deep" && isHotel) {
    // The TravelWits identity (hotelId + coords + canonical label) rides on the
    // record as `tw`, attached server-side from the harvested overlay. Without
    // it a deep link cannot auto-run the search, so we fall through to the
    // portal instead of emitting a dead-end link.
    const tw = hotel && hotel.tw;
    const stay = tomorrowNightStay();
    const url = tw && travelWitsUrl({
      label: tw.label || hotelSearchLabel(hotel),
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      hotelId: tw.hotelId,
      lat: tw.lat,
      lon: tw.lon,
    });
    if (url) {
      return { kind: "deep", url, label: "Book VIP rate", external: true, ...(note ? { note } : {}) };
    }
    // no TravelWits identity → fall through to the portal affordance
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

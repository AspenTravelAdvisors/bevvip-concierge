// lib/atlas/booking.js — the single booking-link seam (BOOKING-SPEC §4).
// Every booking CTA in the app calls bookingLink(); no component ever
// concatenates a TravelWits URL. mode: "off" | "portal" | "deep", from
// NEXT_PUBLIC_BOOKING_MODE (default "portal").
//
// Trust rule (SPEC §6): no up-front "book" affordance until the link behind it
// lands on a rate page. In portal mode the link is the password-gated
// VipTravelAi.com portal, so it is labeled honestly ("Check VIP rates") and
// rendered as a secondary affordance, never the primary CTA.

// TravelWits unknowns, parked so the Phase 2 integration is fill-in-the-blanks:
// eslint-disable-next-line no-unused-vars
const TW_URL_TEMPLATE = null; // e.g. "https://<portal>/hotel/{twId}?checkin={ci}&checkout={co}&adults={ad}&childAges={ages}"
// data/atlas/hotel/travelwits-ids.json — { [bevvipHotelId]: "<travelwits property id>" }
// Open questions for TravelWits: id scheme, child-age param format,
// whether deep-linked sessions still require bookPassword, rate-code param for VIP rates.

const MODE = process.env.NEXT_PUBLIC_BOOKING_MODE || "portal";

/**
 * The booking link for a hotel record, or null when no booking UI should
 * render at all.
 *
 * @param {object} hotel  hotel card record (bookUrl, bookPassword, id)
 * @param {object|null} trip  shared TripState (dates/party) — used by deep mode
 * @returns {{ url: string, label: string, external: true, note?: string } | null}
 */
export function bookingLink(hotel, trip) {
  if (MODE === "off") return null;
  // "deep" (Phase 2): per-property TravelWits URL from TW_URL_TEMPLATE + the
  // id mapping, only when the hotel has a mapping AND trip has dates — a
  // "Book VIP rate" button must never point at a page that can't show a rate.
  // Until the template lands, deep mode falls back to portal behavior.
  if (MODE === "deep" && TW_URL_TEMPLATE && trip?.checkIn && trip?.checkOut) {
    // fill-in-the-blanks: build from TW_URL_TEMPLATE + travelwits-ids.json
  }
  const raw = String((hotel && hotel.bookUrl) || "").trim();
  if (!raw) return null;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const password = String((hotel && hotel.bookPassword) || "").trim();
  return {
    url,
    label: "Check VIP rates",
    external: true,
    ...(password ? { note: `Access code: ${password}` } : {}),
  };
}

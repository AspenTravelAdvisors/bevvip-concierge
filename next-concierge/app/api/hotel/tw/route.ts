// GET /api/hotel/tw?ids=h_00001,h_00002 — the TravelWits identity for a batch
// of hotels, and nothing else.
//
// Why this exists: a "Search VIP rates" link can only auto-run the portal
// search when it carries the property's TravelWits hotelId + coordinates
// (lib/atlas/booking.js). That identity is attached server-side by
// lib/atlas/travelwits-overlay.js and is deliberately absent from the static
// point feed the globe downloads (public/maps/hotel/hotel-points.json), so
// without an endpoint the browse surface can only offer a link to *another*
// surface that has it — which is the extra hop this removes.
//
// Deliberately narrow: /api/hotel/luxury-hotels?ids= would answer the same
// question, but it returns the whole enriched record (description, benefits,
// ratings, fit) for every id — hundreds of kilobytes to build a link. This
// returns four fields per hotel and caches hard.

import atlasDispatch from "@/lib/atlas/index.js";

export const runtime = "nodejs";

// The card list renders at most 120 hotels; 200 matches the atlas query cap and
// leaves room for the map's own lookups without becoming a bulk export.
const MAX_IDS = 200;

interface TwIdentity {
  hotelId?: string | number;
  lat?: number;
  lon?: number;
  label?: string;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("ids") || "";
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, MAX_IDS);

  const tw: Record<string, TwIdentity> = {};
  const bookPassword: Record<string, string> = {};
  // The gated portal, for the ~16% of properties the TravelWits overlay has no
  // identity for. Sending those cards a portal link rather than no link is the
  // difference between "we can't price this one" and a card that quietly has
  // one fewer action than its neighbour for no reason the reader can see.
  // bookingLink() decides which of the two it renders; this route just supplies
  // the raw material for both.
  const bookUrl: Record<string, string> = {};
  for (const id of ids) {
    const rec = atlasDispatch.getById("hotel", id) as
      | { tw?: TwIdentity; bookPassword?: string; bookUrl?: string }
      | null;
    if (!rec) continue;
    if (rec.tw) tw[id] = rec.tw;
    if (rec.bookUrl) bookUrl[id] = rec.bookUrl;
    if (rec.bookPassword) bookPassword[id] = rec.bookPassword;
  }

  return new Response(JSON.stringify({ tw, bookUrl, bookPassword }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // The overlay is a build-time artifact, so this answer is stable.
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

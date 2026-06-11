import { NextRequest, NextResponse } from "next/server";
import { ATLASES, isOfferingType } from "@/lib/atlas-config";

// app/api/atlas-data/route.ts — server-side proxy for the cruise/jet/yacht
// region feeds the globe plots as colored pins. Each standalone atlas ships a
// static meta/itinerary file; proxying it here sidesteps cross-origin fetches
// from the browser and lets us cache it on the edge. ?type=cruise|jet|yacht.

export const runtime = "nodejs";
export const revalidate = 21600; // 6h

// Each app keys its data slightly differently (cruise ships atlas-meta.json;
// jet/yacht ship itinerary.json), matching public/index.html's overlay feeds.
const FEED_PATH: Record<string, string> = {
  cruise: "/atlas-meta.json",
  jet: "/itinerary.json",
  yacht: "/itinerary.json",
};

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") || "";
  if (!isOfferingType(type) || type === "hotel" || !FEED_PATH[type]) {
    return NextResponse.json({ error: "unknown type" }, { status: 400 });
  }
  try {
    const url = `${ATLASES[type].base}${FEED_PATH[type]}`;
    const r = await fetch(url, { next: { revalidate: 21600 } });
    if (!r.ok) throw new Error(`${type} feed ${r.status}`);
    const json = await r.json();
    return NextResponse.json(json, {
      headers: {
        "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
      },
    });
  } catch {
    // One atlas being down must not break the others; the client treats an
    // empty payload as "no pins for this type".
    return NextResponse.json({ REGIONS: {}, TRIPS: [] });
  }
}

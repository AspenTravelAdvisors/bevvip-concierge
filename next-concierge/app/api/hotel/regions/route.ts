// GET /api/hotel/regions — per-marquee-region counts + bbox for the hotel map's
// resting state. Backed by the in-process lib/atlas hotel backend.

import atlasDispatch from "@/lib/atlas/index.js";

export const runtime = "nodejs";

export async function GET() {
  const result = atlasDispatch.regionsFor("hotel");
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}

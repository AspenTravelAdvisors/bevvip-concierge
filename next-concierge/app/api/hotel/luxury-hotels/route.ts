// GET /api/hotel/luxury-hotels — filter/search/paginate the hotel inventory.
// Returns { total, count, results, deepLink }. Backed by the in-process
// lib/atlas hotel backend; reached same-origin by the hotel map iframe via the
// next.config rewrite (/maps/hotel/api/luxury-hotels).

import atlasDispatch from "@/lib/atlas/index.js";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const result = atlasDispatch.queryAtlas("hotel", params);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}

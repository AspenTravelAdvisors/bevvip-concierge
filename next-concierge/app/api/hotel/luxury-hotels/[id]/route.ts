// GET /api/hotel/luxury-hotels/:id — one full hotel record, or 404.
// Backed by the in-process lib/atlas hotel backend.

import atlasDispatch from "@/lib/atlas/index.js";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rec = atlasDispatch.getById("hotel", String(id || ""));
  if (!rec) {
    return new Response(JSON.stringify({ error: "Not found", id }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
  return new Response(JSON.stringify(rec), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}

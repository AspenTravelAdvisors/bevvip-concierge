// GET /api/hotel/config — serves the Google Maps JS key to the hotel map iframe.
// (Reached same-origin as /maps/hotel/api/config via the next.config rewrite.)
// The key lives in an env var (GOOGLE_MAPS_API_KEY); never committed.

export const runtime = "nodejs";

export async function GET() {
  return new Response(JSON.stringify({ apiKey: process.env.GOOGLE_MAPS_API_KEY || "" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

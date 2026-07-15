// GET /api/villas/search — the only way villa inventory reaches a client.
// Thin wrapper over lib/villas.searchVillas: filter + sort + paginate + facets
// (region and sleeps-bucket counts). perPage defaults to 24 and is capped at
// 50, so no response ships more than a sliver of the 3,902-record dataset.
//
// ?view=pins returns the compact map view instead: every matching villa as
// [id, lat, lon, exactPoint, featured] (~115 KB raw for the full set, far less
// gzipped) so the Mapbox layer can cluster without ever seeing full records.
//
// Same-origin only — no CORS headers by design (do not resurrect the
// transitional allowlist). The dataset changes only when the source JSON is
// re-uploaded, so responses are CDN-cached for a day per URL.

import { searchVillas, villaPins, villaOverlayRegions } from "@/lib/villas.js";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Advisory for the framework; the effective cache is the s-maxage header below
// (reading req.url makes this handler dynamic, one cached entry per query URL).
export const revalidate = 86400;

const PER_PAGE_DEFAULT = 24;
const PER_PAGE_CAP = 50;

// Generous browsing budget, separate bucket from the Guide's 10/min.
const RATE = { bucket: "villas", max: 120, windowMs: 60_000 };

export async function GET(req) {
  const limited = isRateLimited(req, {}, RATE);
  if (limited) return limited;

  const params = Object.fromEntries(new URL(req.url).searchParams.entries());

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
  };

  if (params.view === "pins") {
    return new Response(JSON.stringify(villaPins(params)), { status: 200, headers });
  }

  // Living Atlas overlay: per-region pins in the shared REGIONS shape.
  if (params.view === "overlay") {
    return new Response(JSON.stringify(villaOverlayRegions()), { status: 200, headers });
  }

  let perPage = parseInt(params.perPage, 10);
  if (!Number.isFinite(perPage) || perPage <= 0) perPage = PER_PAGE_DEFAULT;
  const result = searchVillas({ ...params, perPage: Math.min(perPage, PER_PAGE_CAP) });
  return new Response(JSON.stringify(result), { status: 200, headers });
}

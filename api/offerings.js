// api/offerings.js — Base Camp: live cruise / jet / yacht inventory endpoint.
//
// HTTP surface over lib/offerings-data.js. Mirrors the hotel atlas's query shape
// so the Guide (and any other client) can ask for real expedition-cruise, private
// jet, and brand-yacht inventory the same way it asks for hotels. The Guide tool
// (lib/search-offerings.js) calls the lib in-process; this endpoint is for the
// globe and external callers.
//
//   /api/offerings?type=cruise&region=antarctica&month=2027-01&limit=6
//   /api/offerings?type=jet&q=northern%20lights
//   /api/offerings?type=yacht&country=Italy
//
// Returns { type, total, count, results, deepLink, chartRegion }.

import { queryOfferings } from "../lib/offerings-data.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const q = req.query || {};
  const input = {
    type: q.type,
    q: q.q,
    region: q.region,
    country: q.country,
    month: q.month,
    limit: q.limit,
  };

  try {
    const out = await queryOfferings(input);
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=21600, stale-while-revalidate=86400"
    );
    res.status(200).json(out);
  } catch (e) {
    // Degrade gracefully: empty inventory, never a 500 that breaks the Guide.
    res.status(200).json({
      type: String(input.type || "").toLowerCase(),
      total: 0,
      count: 0,
      results: [],
      deepLink: null,
      chartRegion: null,
      unavailable: true,
      note: "offerings temporarily unavailable",
    });
  }
}

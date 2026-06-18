// api/vr-points.js — VR layer: 360° video pins for the Living Atlas globe.
//
// Companion to atlas-points.js. Where that feed plots bookable inventory as an
// ambient dot field, this one plots BeVvip's own LuxuryTravelVR 360° videos as a
// cross-cutting media overlay — "see the real place" pins that sit above whichever
// offering view is active, not a sixth offering type.
//
// YouTube exposes zero public geolocation for this channel, so coordinates are
// hand-geocoded from titles and committed in ../data/vr-videos.json. The owned
// 360° street-view stills (separate pipeline) merge into the same feed later as
// kind:"photo" — the client renders both from one toggle.
//
// Shape mirrors atlas-points.js: a GeoJSON FeatureCollection the globe can add as
// a symbol layer with zoom-interpolated icon-size (small dots far out, thumbnails
// up close). Only located items become Features; the full set (incl. unplaced) is
// echoed under `unplaced` so nothing is silently dropped.

import { readFileSync } from "node:fs";

// new URL(..., import.meta.url) is statically analyzable, so Vercel's file
// tracer bundles the JSON with the function.
const DATA_URL = new URL("../data/vr-videos.json", import.meta.url);

let CACHE = null;

function build() {
  const doc = JSON.parse(readFileSync(DATA_URL, "utf8"));
  const items = Array.isArray(doc.videos) ? doc.videos : [];

  const features = [];
  const unplaced = [];
  const regions = new Set();

  for (const v of items) {
    if (!v.located || !Number.isFinite(v.lat) || !Number.isFinite(v.lng)) {
      unplaced.push(v.videoId);
      continue;
    }
    if (v.region) regions.add(v.region);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [v.lng, v.lat] },
      properties: {
        id: v.videoId,
        kind: v.kind || "video",
        name: v.title,
        place: v.place || null,
        region: v.region || null,
        // Media payload the click handler needs to play in-app, no YT round-trip.
        embed: v.embedUrl,
        watch: v.watchUrl,
        thumb: v.thumb,
        thumbGrid: v.thumbGrid,
        duration: v.durationLabel || null,
        confidence: v.geocodeConfidence || null,
      },
    });
  }

  return {
    type: "FeatureCollection",
    count: features.length,
    regions: [...regions].sort(),
    unplaced,
    features,
  };
}

export default async function handler(req, res) {
  try {
    if (!CACHE) CACHE = build();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=21600, stale-while-revalidate=86400"
    );
    res.status(200).json(CACHE);
  } catch (e) {
    // Never break the globe: an empty layer just means no VR pins.
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json({
      type: "FeatureCollection",
      count: 0,
      regions: [],
      unplaced: [],
      features: [],
    });
  }
}

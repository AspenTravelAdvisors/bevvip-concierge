// app/api/vr-points/route.ts — VR layer feed for the Living Atlas globe.
//
// Same-origin GeoJSON the globe adds as a symbol layer: BeVvip's own
// LuxuryTravelVR 360° videos plotted as a cross-cutting "see the real place"
// overlay (not a sixth offering type). YouTube exposes no geolocation for the
// channel, so coordinates are hand-geocoded in data/vr-videos.json.
//
// Mirrors the root api/vr-points.js shape. data/vr-videos.json here is a bundled
// copy of the repo-root canonical file (single source: ../../../data — regenerate
// both when the owned 360° photo stills land as kind:"photo").

import vrData from "@/data/vr-videos.json";

interface VrItem {
  videoId: string;
  title: string;
  watchUrl: string;
  embedUrl: string;
  thumb: string;
  thumbGrid: string;
  durationLabel: string;
  place: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  located: boolean;
  geocodeConfidence: string | null;
  kind: string;
}

function build() {
  const items = (vrData.videos as VrItem[]) ?? [];
  const features = [];
  const unplaced: string[] = [];
  const regions = new Set<string>();

  for (const v of items) {
    if (!v.located || typeof v.lat !== "number" || typeof v.lng !== "number") {
      unplaced.push(v.videoId);
      continue;
    }
    if (v.region) regions.add(v.region);
    features.push({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [v.lng, v.lat] },
      properties: {
        id: v.videoId,
        kind: v.kind || "video",
        name: v.title,
        place: v.place ?? null,
        region: v.region ?? null,
        embed: v.embedUrl,
        watch: v.watchUrl,
        thumb: v.thumb,
        thumbGrid: v.thumbGrid,
        duration: v.durationLabel ?? null,
        confidence: v.geocodeConfidence ?? null,
      },
    });
  }

  return {
    type: "FeatureCollection" as const,
    count: features.length,
    regions: [...regions].sort(),
    unplaced,
    features,
  };
}

// Computed once at module load — the feed is static per deploy.
const FEED = build();

export function GET() {
  return Response.json(FEED, {
    headers: {
      "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
    },
  });
}

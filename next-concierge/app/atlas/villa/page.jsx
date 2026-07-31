// /atlas/villa — the Villa Atlas. The first server-rendered atlas: the 7MB
// dataset never leaves the server. This page runs the initial search on the
// server (so a deep link like ?region=caribbean&sleeps=10&priceMax=3000 arrives
// fully rendered) and hands the client component only that page of results;
// every later filter/page change goes through /api/villas/search.

import { IBM_Plex_Mono } from "next/font/google";
import {
  searchVillas,
  getVillaTaxonomy,
  resolveRegion,
  resolveDestination,
  resolveLocation,
} from "@/lib/villas.js";
import VillaAtlas from "@/components/VillaAtlas";
import AtlasFrame from "@/components/AtlasFrame";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata = {
  title: "Villa Atlas",
  description:
    "3,900+ private villas and vacation homes worldwide, arranged by your Aspen Travel Advisor. VIP travel benefits, zero membership fees.",
};

// Read only the params the villa search understands; everything else is noise.
const PARAM_KEYS = [
  "region", "destination", "location", "sleeps", "bedrooms", "priceMax",
  "featured", "specials", "q", "ids", "page", "sort", "bbox",
];

export default async function VillaAtlasPage({ searchParams }) {
  const sp = await searchParams;
  const params = {};
  for (const key of PARAM_KEYS) {
    const v = Array.isArray(sp[key]) ? sp[key][0] : sp[key];
    if (v != null && String(v).trim() !== "") params[key] = String(v);
  }
  // Canonicalize geography before it reaches the client, so a Guide deep link
  // like ?region=caribbean or ?destination=st+barts selects the right filter
  // option ("Caribbean", "St. Barthélemy") instead of only filtering silently.
  if (params.region) params.region = resolveRegion(params.region) || params.region;
  if (params.destination)
    params.destination = resolveDestination(params.destination) || params.destination;
  if (params.location) params.location = resolveLocation(params.location) || params.location;
  // The atlas list reads high → low by nightly rate by default (Call-for-Pricing
  // records sort last). Featured villas no longer float to the top of an open
  // list — the Featured checkbox is the only thing that surfaces them now.
  if (!params.sort) params.sort = "priceDesc";

  // A bad deep link must not take the page down with it.
  //
  // searchVillas parses whatever arrived in the query string; a malformed
  // `bbox`, `ids` or `priceMax` used to throw here, and a throw in a server
  // component is a full-page error — the traveller lost the atlas because one
  // param was wrong. The client can refetch through /api/villas/search the
  // moment any filter changes, so an empty first page is fully recoverable
  // while an error screen is not. Genuine infrastructure failures (a cold start
  // evicted mid-render) still surface, and error.tsx retries those.
  let initial;
  try {
    initial = searchVillas(params);
  } catch {
    initial = { total: 0, page: 1, perPage: 24, results: [], facets: { regions: {}, sleeps: {}, callForPricing: 0 } };
  }

  // Filter menus come from the taxonomy tree, trimmed to names + slugs only —
  // supplier deep links stay server-side.
  const taxonomy = getVillaTaxonomy().map((r) => ({
    name: r.name,
    destinations: (r.destinations || []).map((d) => ({
      name: d.name,
      slug: d.slug,
      locations: (d.locations || []).map((l) => ({ name: l.name, slug: l.slug })),
    })),
  }));

  // Villas is the third distinct map UI in this app (globe / iframed Leaflet /
  // this). AtlasFrame is what makes arriving here feel like the same product.
  return (
    <AtlasFrame type="villa">
      <div className={`villa-atlas ${mono.variable}`}>
        <VillaAtlas initial={initial} initialParams={params} taxonomy={taxonomy} />
      </div>
    </AtlasFrame>
  );
}

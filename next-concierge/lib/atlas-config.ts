import type { OfferingType } from "./types";

// One registry for the five atlas surfaces. The unified /atlas/[type] route
// renders them under a single shell; `base` points at each standalone atlas
// app for the "Open full Atlas" handoff (same ?region= deep-link contract
// documented in DEEPLINK-HANDOFF.md).
export interface AtlasConfig {
  type: OfferingType;
  label: string;
  tagline: string;
  base: string;
  sampleRegions: string[];
}

export const ATLASES: Record<OfferingType, AtlasConfig> = {
  hotel: {
    type: "hotel",
    label: "Hotel Atlas",
    tagline: "Approved luxury hotel inventory, mapped worldwide",
    base:
      process.env.NEXT_PUBLIC_HOTEL_ATLAS_BASE ||
      "https://luxury-hotel-atlas-two.vercel.app",
    sampleRegions: ["Caribbean", "Mediterranean", "Alps", "Southeast Asia"],
  },
  cruise: {
    type: "cruise",
    label: "Expedition Cruise Atlas",
    tagline: "Expedition cruise journeys by region and season",
    base:
      process.env.NEXT_PUBLIC_CRUISE_ATLAS_BASE ||
      "https://expedition-cruise-map.vercel.app",
    sampleRegions: ["Antarctica", "Galapagos", "Arctic", "Northwest Passage"],
  },
  jet: {
    type: "jet",
    label: "Private Jet Atlas",
    tagline: "Around-the-world and regional private jet expeditions",
    base:
      process.env.NEXT_PUBLIC_JET_ATLAS_BASE ||
      "https://private-jet-expeditions.vercel.app",
    sampleRegions: ["ANTARCTICA", "AFRICA", "ASIA", "WORLD"],
  },
  yacht: {
    type: "yacht",
    label: "Luxury Hotel Yacht Atlas",
    tagline: "Aman, Ritz-Carlton, Four Seasons and Orient Express at sea",
    base:
      process.env.NEXT_PUBLIC_YACHT_ATLAS_BASE ||
      "https://luxury-hotel-brand-yacht-atlas.vercel.app",
    sampleRegions: ["MED", "CARIB", "ASIA"],
  },
  worldcruise: {
    type: "worldcruise",
    label: "World Cruise Atlas",
    tagline: "World cruises and grand voyages, every port day by day",
    base:
      process.env.NEXT_PUBLIC_WORLD_CRUISE_ATLAS_BASE ||
      "https://world-cruise-atlas.vercel.app",
    sampleRegions: ["MED", "CARIB", "AUNZ", "EASTASIA"],
  },
};

export const ATLAS_TYPES = Object.keys(ATLASES) as OfferingType[];

export function isOfferingType(value: string): value is OfferingType {
  return value in ATLASES;
}

export function externalAtlasLink(type: OfferingType, region?: string | null): string {
  const base = ATLASES[type].base;
  return region ? `${base}/?region=${encodeURIComponent(region)}` : base;
}

// In-app atlas route (the atlas now lives inside Base Camp under /atlas/<type>,
// rendering the copied standalone page). `query` is a pre-built search string
// (e.g. "?region=Caribbean&ids=h_001") carried through to the embedded atlas,
// which reads it from its own location.search inside the iframe.
export function internalAtlasLink(type: OfferingType, query = ""): string {
  return `/atlas/${type}${query}`;
}

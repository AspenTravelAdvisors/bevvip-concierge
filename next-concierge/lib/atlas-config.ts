import type { OfferingType } from "./types";

// One registry for the five atlas surfaces. The unified /atlas/[type] route
// renders them under a single shell; `base` is the internal map root
// (/maps/<type>) for the "Open full Atlas" handoff (same ?region= deep-link
// contract documented in DEEPLINK-HANDOFF.md). Override with NEXT_PUBLIC_*_ATLAS_BASE
// only if pointing at an external deploy.
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
    base: process.env.NEXT_PUBLIC_HOTEL_ATLAS_BASE || "/maps/hotel",
    sampleRegions: ["Caribbean", "Mediterranean", "Alps", "Southeast Asia"],
  },
  cruise: {
    type: "cruise",
    label: "Expedition Cruise Atlas",
    tagline: "Expedition cruise journeys by region and season",
    base: process.env.NEXT_PUBLIC_CRUISE_ATLAS_BASE || "/maps/cruise",
    sampleRegions: ["Antarctica", "Galapagos", "Arctic", "Northwest Passage"],
  },
  jet: {
    type: "jet",
    label: "Private Jet Atlas",
    tagline: "Around-the-world and regional private jet expeditions",
    base: process.env.NEXT_PUBLIC_JET_ATLAS_BASE || "/maps/jet",
    sampleRegions: ["ANTARCTICA", "AFRICA", "ASIA", "WORLD"],
  },
  yacht: {
    type: "yacht",
    label: "Luxury Hotel Yacht Atlas",
    tagline: "Aman, Ritz-Carlton, Four Seasons and Orient Express at sea",
    base: process.env.NEXT_PUBLIC_YACHT_ATLAS_BASE || "/maps/yacht",
    sampleRegions: ["MED", "CARIB", "ASIA"],
  },
  worldcruise: {
    type: "worldcruise",
    label: "World Cruise Atlas",
    tagline: "World cruises and grand voyages, every port day by day",
    base: process.env.NEXT_PUBLIC_WORLD_CRUISE_ATLAS_BASE || "/maps/worldcruise",
    sampleRegions: ["MED", "CARIB", "AUNZ", "EASTASIA"],
  },
  train: {
    type: "train",
    label: "Rail Journeys Atlas",
    tagline: "The legendary trains and rail journeys, drawn along the tracks",
    base: process.env.NEXT_PUBLIC_TRAIN_ATLAS_BASE || "/maps/train",
    sampleRegions: ["BRITAIN", "EUROPE", "CANADA", "EASTASIA"],
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

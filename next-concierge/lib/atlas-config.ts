import type { OfferingType } from "./types";

// One registry for the five atlas surfaces. The unified /atlas/[type] route
// renders them under a single shell; `base` is the internal map root
// (/maps/<type>) for the "Open full Atlas" handoff (same ?region= deep-link
// contract documented in DEEPLINK-HANDOFF.md). Override with NEXT_PUBLIC_*_ATLAS_BASE
// only if pointing at an external deploy.
/**
 * The four things a traveller is actually choosing between.
 *
 * Grouped by how you travel, not by our inventory taxonomy: somewhere to stay,
 * then air / sea / land. "Journeys by rail and air" used to bundle jets and
 * trains into one heading, which put a round-the-world jet expedition and a
 * Scottish sleeper under the same label — the same mistake, one level up, that
 * the flat seven-item list made.
 */
export type IntentKey = "stay" | "air" | "sea" | "land";

export const INTENTS: { key: IntentKey; label: string; blurb: string }[] = [
  { key: "stay", label: "Places to stay", blurb: "Hotels and private villas" },
  { key: "air", label: "By Air", blurb: "Private jet expeditions" },
  // NOT "charters". A hotel yacht is an ultra-luxury cruise — a hotel at sea,
  // booked by the cabin exactly like an expedition or world cruise. Calling the
  // group "charters" described the wrong product and the wrong price.
  { key: "sea", label: "By Sea", blurb: "Hotel yachts, expeditions, world cruises" },
  { key: "land", label: "By Land", blurb: "The legendary rail journeys" },
];

export interface AtlasConfig {
  type: OfferingType;
  /**
   * Name of the collection's own map ("Hotel atlas"). Used for page titles and
   * the map badge, so it is sentence case, not title case: "atlas" is a common
   * noun here, not a product. Mid-sentence, lowercase the whole thing — see
   * AtlasShell's fallback copy.
   */
  label: string;
  /** Short navigation label ("Hotels"). Never says "atlas" — see `nounPlural`. */
  nav: string;
  /** How the collection is named in a sentence ("2,501 vetted hotels"). */
  nounPlural: string;
  tagline: string;
  base: string;
  sampleRegions: string[];
  /** Map-legend / nav accent color. The single source for both. */
  color: string;
  /** Records in the shipped dataset. Powers the blurb and the Explore menu. */
  count: number;
  /**
   * What the traveller is trying to do — Deliverable 4.
   *
   * Explore used to list seven collections flat, which asked the visitor to
   * know our inventory taxonomy before they could look at anything: "Hotels",
   * "Villas", "Expeditions", "World Cruises", "Yachts", "Rail", "Jets". But
   * nobody arrives wanting "a villa OR a hotel" as a category question — they
   * want somewhere to stay, and the distinction is an implementation detail of
   * how the inventory is filed.
   *
   * Grouping by intent puts hotels and villas together under one heading, which
   * is also why villas converge onto the shared rail: once they sit side by
   * side in the menu, arriving at two different-looking browse surfaces is the
   * next thing that reads as a seam.
   */
  intent: IntentKey;
  /**
   * Order everywhere the collections are listed: where-you-stay first, then
   * air, sea and land, each group by how often travelers ask for it.
   * Deliberately NOT alphabetical and NOT raw record count — a visitor scans
   * this list looking for their own intent, not our inventory table.
   *
   * This is browse order, and the prose helpers no longer piggyback on it:
   * `collectionsSummary` / `collectionsCompact` now pick the three largest
   * collections by `count` explicitly, so reordering the menu can never
   * quietly change which numbers the home page leads with.
   */
  order: number;
}

export const ATLASES: Record<OfferingType, AtlasConfig> = {
  hotel: {
    type: "hotel",
    label: "Hotel atlas",
    nav: "Hotels",
    nounPlural: "vetted hotels",
    tagline: "Approved luxury hotel inventory, mapped worldwide",
    base: process.env.NEXT_PUBLIC_HOTEL_ATLAS_BASE || "/maps/hotel",
    sampleRegions: ["Caribbean", "Mediterranean", "Alps", "Southeast Asia"],
    color: "#e6d488",
    count: 2501,
    order: 1,
    intent: "stay",
  },
  villa: {
    // Villa is the first server-rendered atlas: no /maps/villa iframe page
    // exists. base points at the in-app route itself; the /atlas/[type] iframe
    // route excludes it (app/atlas/villa is its own static route).
    type: "villa",
    label: "Villa atlas",
    nav: "Villas",
    nounPlural: "private villas",
    tagline: "Private villas and vacation homes, advisor arranged worldwide",
    base: "/atlas/villa",
    sampleRegions: ["Caribbean", "United States", "Europe", "Mexico"],
    color: "#a8d08d",
    count: 3902,
    order: 2,
    intent: "stay",
  },
  cruise: {
    type: "cruise",
    label: "Expedition cruise atlas",
    nav: "Expedition Cruises",
    nounPlural: "expedition sailings",
    tagline: "Expedition cruise journeys by region and season",
    base: process.env.NEXT_PUBLIC_CRUISE_ATLAS_BASE || "/maps/cruise",
    sampleRegions: ["Antarctica", "Galapagos", "Arctic", "Northwest Passage"],
    color: "#5aa9e6",
    count: 3542,
    order: 5,
    intent: "sea",
  },
  worldcruise: {
    type: "worldcruise",
    label: "World cruise atlas",
    nav: "World Cruises",
    nounPlural: "world cruises and grand voyages",
    tagline: "World cruises and grand voyages, every port day by day",
    base: process.env.NEXT_PUBLIC_WORLD_CRUISE_ATLAS_BASE || "/maps/worldcruise",
    sampleRegions: ["MED", "CARIB", "AUNZ", "EASTASIA"],
    color: "#45d6c2",
    count: 250,
    order: 6,
    intent: "sea",
  },
  train: {
    type: "train",
    label: "Rail journeys atlas",
    nav: "Rail Journeys",
    nounPlural: "rail journeys",
    tagline: "The legendary trains and rail journeys, drawn along the tracks",
    base: process.env.NEXT_PUBLIC_TRAIN_ATLAS_BASE || "/maps/train",
    sampleRegions: ["BRITAIN", "EUROPE", "CANADA", "EASTASIA"],
    color: "#e08d5f",
    count: 135,
    order: 7,
    intent: "land",
  },
  yacht: {
    type: "yacht",
    label: "Luxury hotel yacht atlas",
    nav: "Luxury Hotel Yachts",
    nounPlural: "hotel-brand yacht voyages",
    tagline: "Aman, Ritz-Carlton, Four Seasons and Orient Express at sea",
    base: process.env.NEXT_PUBLIC_YACHT_ATLAS_BASE || "/maps/yacht",
    sampleRegions: ["MED", "CARIB", "ASIA"],
    color: "#e0b84a",
    count: 374,
    order: 4,
    intent: "sea",
  },
  jet: {
    type: "jet",
    label: "Private jet atlas",
    nav: "Private Jet Expeditions",
    nounPlural: "private jet expeditions",
    tagline: "Around-the-world and regional private jet expeditions",
    base: process.env.NEXT_PUBLIC_JET_ATLAS_BASE || "/maps/jet",
    sampleRegions: ["ANTARCTICA", "AFRICA", "ASIA", "WORLD"],
    color: "#dfe5f2",
    // 141 -> 147: the six Safrans du Monde departures added by
    // scripts/apply-safrans-dates.mjs. Like every count here this is a hand-kept
    // constant over the raw feed, not a live figure — see the note on `count`.
    count: 147,
    order: 3,
    intent: "air",
  },
};

export const ATLAS_TYPES = Object.keys(ATLASES) as OfferingType[];

/**
 * THE canonical collection list. Every surface that enumerates what Base Camp
 * contains — the header's Explore menu, the map legend, the home blurb, the
 * atlas breadcrumb — reads this and only this. Three surfaces previously kept
 * three different lists (the blurb named four collections, the nav seven, and
 * the legend however many finished loading), which meant the product described
 * itself differently depending on where you looked and how fast the network was.
 */
export const COLLECTIONS: AtlasConfig[] = Object.values(ATLASES).sort(
  (a, b) => a.order - b.order,
);

const nf = new Intl.NumberFormat("en-US");

/**
 * The three collections whose size is worth stating, and the rest.
 *
 * These used to be "the first three in `order`", which silently coupled the
 * home page's headline numbers to the Explore menu's browse order — regrouping
 * the menu by air/sea/land would have promoted 147 jet expeditions into the
 * counted slot and demoted 3,542 expedition sailings out of it. Picking the
 * largest three by `count` says the same thing the copy always meant.
 */
function countedSplit(): { counted: AtlasConfig[]; named: AtlasConfig[] } {
  const bySize = [...COLLECTIONS].sort((a, b) => b.count - a.count);
  const top = new Set(bySize.slice(0, 3).map((c) => c.type));
  return {
    counted: COLLECTIONS.filter((c) => top.has(c.type)),
    named: COLLECTIONS.filter((c) => !top.has(c.type)),
  };
}

/** "2,501 vetted hotels" — one collection, counted, for prose. */
export function collectionPhrase(c: AtlasConfig): string {
  return `${nf.format(c.count)} ${c.nounPlural}`;
}

/**
 * The whole collection, as one sentence. Used by the home blurb so the promise
 * on the landing page can never drift from what the map actually plots.
 */
export function collectionsSentence(): string {
  const parts = COLLECTIONS.map(collectionPhrase);
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The same promise, at headline length: count the three big collections (the
 * numbers are the proof), name the rest (the numbers there are small enough to
 * undersell them). Never omit a collection — a visitor who came for rail
 * journeys should see the words "rail journeys".
 */
export function collectionsSummary(): string {
  const { counted, named } = countedSplit();
  const head = counted.map(collectionPhrase).join(", ");
  const tail = named.map((x) => x.nounPlural);
  return `${head}, ${tail.slice(0, -1).join(", ")} and ${tail[tail.length - 1]}`;
}

/**
 * The same list at map-overlay length — counts for the big three, bare nouns
 * for the rest, middot-separated.
 *
 * This exists because prose length is a layout constraint here, not a style
 * choice: the home page's blurb is absolutely positioned above the map legend,
 * so a blurb that wraps to a third line lands on top of it. `collectionsSummary`
 * (a full sentence) did exactly that. The CSS now clamps the paragraph so no
 * copy change can collide again, but the honest fix is to not write past the
 * space — two lines at ~95 characters each.
 */
export function collectionsCompact(): string {
  const { counted, named } = countedSplit();
  const head = counted
    .map((x) => `${nf.format(x.count)} ${x.nav.toLowerCase()}`)
    .join(" · ");
  return `${head} · ${named.map((x) => x.nav.toLowerCase()).join(", ")}`;
}

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
/**
 * COLLECTIONS grouped by intent, in INTENTS order, each group in the
 * collections' own `order`.
 *
 * Derived rather than hand-listed: a new collection appears in the Explore menu
 * the moment it is added to ATLASES with an intent, and cannot be silently
 * missing from the menu the way a second hand-maintained list would allow.
 */
export function collectionsByIntent(): {
  key: IntentKey;
  label: string;
  blurb: string;
  items: AtlasConfig[];
}[] {
  return INTENTS.map((i) => ({
    ...i,
    items: COLLECTIONS.filter((c) => c.intent === i.key),
  })).filter((g) => g.items.length > 0);
}

export function internalAtlasLink(type: OfferingType, query = ""): string {
  return `/atlas/${type}${query}`;
}

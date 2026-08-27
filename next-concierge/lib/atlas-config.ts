import type { OfferingType } from "./types";

// One registry for the five atlas surfaces. The unified /atlas/[type] route
// renders them under a single shell; `base` is the internal map root
// (/maps/<type>) for the "Open full Atlas" handoff. Region handoffs carry both
// the legacy `region=` focus key and the native `regions=` filter key; see
// atlasRegionQuery().
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

/*
 * No blurbs. Each group used to carry a subtitle that listed the collections
 * printed directly beneath it — "By Sea · Hotel yachts, expeditions, world
 * cruises" sitting on top of Luxury Hotel Yachts, Expedition Cruises, World
 * Cruises. A caption that repeats the thing it captions is noise between the
 * reader and the list.
 *
 * The group labels also say NOT "charters" for the sea group: a hotel yacht is
 * an ultra-luxury cruise — a hotel at sea, booked by the cabin exactly like an
 * expedition or a world cruise — so "charters" named the wrong product at the
 * wrong price.
 */
export const INTENTS: { key: IntentKey; label: string }[] = [
  { key: "stay", label: "Places to stay" },
  { key: "air", label: "By Air" },
  { key: "sea", label: "By Sea" },
  { key: "land", label: "By Land" },
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
   * A second way to look at this same collection.
   *
   * The registry has always been keyed by inventory TYPE, which is why the
   * Google Photorealistic 3D hotel view could never appear in the Explore menu:
   * it is not a type, it is a view of one, and there was no slot for that. The
   * absence of the slot is most of why the best thing in the product read as
   * buried — it lived behind a query param nothing could link to by name.
   *
   * `query` is appended to `/atlas/<type>`, so a view is an ordinary deep link
   * and nothing new has to be routed.
   */
  views?: { key: string; label: string; query: string; blurb: string }[];
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
    nav: "VIP Hotels",
    nounPlural: "vetted hotels",
    tagline: "Approved luxury hotel inventory, mapped worldwide",
    base: process.env.NEXT_PUBLIC_HOTEL_ATLAS_BASE || "/maps/hotel",
    sampleRegions: ["Caribbean", "Mediterranean", "Alps", "Southeast Asia"],
    color: "#e6d488",
    // Verified against the shipped feed by scripts/audit-listings.mjs, which
    // npm run verify runs: this said 2,382 while luxury-hotels.json held 2,240,
    // so the home page headline counted 142 hotels the atlas cannot plot. The
    // number stays hand-kept — it is an editorial figure, not a raw row count —
    // but it is no longer hand-kept AND unchecked.
    count: 2240,
    order: 1,
    intent: "stay",
    views: [
      {
        key: "3d",
        label: "In photoreal 3D",
        query: "engine=3d",
        // Says what it IS, not what it looks like. "3D" alone reads as a toy;
        // the persuasive fact is that it is the actual building.
        blurb: "The real buildings, in photogrammetry",
      },
    ],
  },
  villa: {
    // Villa is the first server-rendered atlas: no /maps/villa iframe page
    // exists. base points at the in-app route itself; the /atlas/[type] iframe
    // route excludes it (app/atlas/villa is its own static route).
    type: "villa",
    label: "Villa atlas",
    nav: "Private Villas",
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
    count: 3662,
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
    count: 303,
    order: 6,
    intent: "sea",
  },
  safari: {
    type: "safari",
    label: "Safari journeys atlas",
    nav: "Safari",
    nounPlural: "safari journeys",
    tagline: "The great migration, the Delta and the gorilla forests, camp by camp",
    base: process.env.NEXT_PUBLIC_SAFARI_ATLAS_BASE || "/maps/safari",
    sampleRegions: ["EASTAFRICA", "OKAVANGO", "ZAMBEZI", "GREATAPES"],
    color: "#c9812f",
    count: 269,
    order: 8,
    intent: "land",
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
    count: 130,
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
    count: 467,
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
    count: 124,
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

/** Every record we plot, summed. Derived — never a hand-kept second number. */
export function totalCount(): number {
  return COLLECTIONS.reduce((n, c) => n + c.count, 0);
}

/**
 * The line that answers "what is this" before anything else on the page.
 *
 * Scale is the hook. A visitor who lands on a globe knows within a second that
 * it's a map and does NOT know whether it's showing eleven hand-picked hotels
 * or eleven thousand — and that difference is the entire proposition. So the
 * first thing above the fold is the count, in plain digits, at a length you can
 * read without moving your eyes: one clause, one number, one noun.
 *
 * It deliberately says nothing about how the search works. "AI-powered",
 * "intelligent", "conversational" — every one of those describes the mechanism
 * rather than the inventory, and a mechanism is not a reason to stay. The
 * Guide's composer is sitting right there making the same point by existing.
 *
 * "stays and journeys" rather than "journeys": 6,403 of these records are
 * hotels and villas, which nobody calls a journey. The compound is slightly
 * baggy and it is the honest noun for what the number counts.
 *
 * BOTH numbers are derived from ATLASES, so this line cannot drift from what
 * the map plots. Add a collection and the headline counts it the same day.
 */
export function collectionsHeadline(): string {
  return `${nf.format(totalCount())} vetted stays and journeys across ${COLLECTIONS.length} collections`;
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

/**
 * What the route control says, per collection.
 *
 * An aircraft flies, a yacht sails, an expedition or a world voyage cruises, a
 * train runs. "Fly the route" over a Mediterranean sailing is the kind of wrong
 * word that tells a traveller the product was built for something else and they
 * are looking at the leftovers — and this button sits on a card next to the
 * ship's own name.
 *
 * Rail gets "Ride" rather than "Run": a train runs, but the traveller rides,
 * and every other verb here is the traveller's.
 *
 * The map's own control uses the same verbs with the article dropped, because
 * it is a button in a stack of four and "Fly the route" does not fit beside
 * "Fullscreen".
 */
const ROUTE_VERB: Partial<Record<OfferingType, string>> = {
  jet: "Fly",
  yacht: "Sail",
  cruise: "Cruise",
  worldcruise: "Cruise",
  train: "Ride",
};

/** "Sail the route" — the card action. Null where a collection has no routes. */
export function routeVerbLong(type: OfferingType): string | null {
  const verb = ROUTE_VERB[type];
  return verb ? `${verb} the route` : null;
}

/** "Sail route" — the map control, where the stack is narrow. */
export function routeVerbShort(type: OfferingType): string | null {
  const verb = ROUTE_VERB[type];
  return verb ? `${verb} route` : null;
}

export function externalAtlasLink(type: OfferingType, region?: string | null): string {
  return internalAtlasLink(type, atlasRegionQuery(region));
}

export function atlasRegionQuery(region?: string | null): string {
  const key = String(region ?? "").trim();
  if (!key) return "";
  const p = new URLSearchParams();
  // `region` opens/focuses the legacy standalone panel; `regions` marks the
  // selected filter in the native /atlas pages and newer standalone maps.
  p.set("region", key);
  p.set("regions", key);
  return `?${p.toString()}`;
}

// In-app atlas route (the atlas now lives inside Base Camp under /atlas/<type>,
// rendering the copied standalone page). `query` is a pre-built search string
// (e.g. "?region=Caribbean&regions=Caribbean&ids=h_001") carried through to the
// embedded atlas, which reads it from its own location.search inside the iframe.
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

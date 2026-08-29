// The crawlable journey entity layer — the six route atlases.
//
// Same argument as lib/seo/hotels.js, one collection family over: 4,960
// departures across expedition cruises, world cruises, yacht voyages, rail,
// jets and safaris, every one of them rendered by a client component fed from
// a feed no crawler is allowed to read.
//
// ── One page per ITINERARY, not per departure ──────────────────────────────
//
// This is the decision worth defending, because the obvious implementation is
// the wrong one. The cruise feed holds 3,662 sailings and 902 distinct
// operator-plus-itinerary pairs: "Exploring Galápagos" alone appears 235 times,
// once per departure date, identical in every other respect. A page per sailing
// would have published 235 pages differing only in a date — the textbook
// definition of thin, near-duplicate content, and the fastest way to have the
// whole /journeys tree discounted.
//
// So a page is an itinerary and the departures are a table on it. That is
// better for a reader too: "when does this sail" is a question the page can now
// answer completely, instead of 235 pages each answering it once. Yacht
// collapses 467 → 347 the same way; the other four are nearly all distinct
// already and collapse barely at all, which is itself the evidence that the
// grouping key is the right one.
//
// The offerings come from the REAL adapters — the same adaptCruise/adaptVoyage/
// adaptJourney the atlases run — so a page and the map agree about what a
// journey is. Anything the adapters deliberately drop (they normalize for
// filtering and drawing, not for prose) is read back off the raw record here,
// which is why both are loaded.
//
// Server-only: this pulls every route feed.

import { SITE_URL } from "@/lib/answers";
import { orgRef } from "@/lib/seo/site";
import { slugify } from "@/lib/seo/hotels";

import { adaptCruise } from "@/lib/atlas/adapters/cruise";
import { adaptWorldCruise } from "@/lib/atlas/adapters/worldcruise";
import { adaptYacht } from "@/lib/atlas/adapters/yacht";
import { adaptTrain } from "@/lib/atlas/adapters/train";
import { adaptJet } from "@/lib/atlas/adapters/jet";
import { adaptSafari } from "@/lib/atlas/adapters/safari";

import cruiseSailings from "@/data/atlas/cruise/sailings.json";
import cruiseMeta from "@/data/atlas/cruise/atlas-meta.json";
import cruiseRegionOverrides from "@/data/atlas/cruise/region-overrides.json";
// The only copy of the cruise route geometry lives under public/, because the
// Leaflet atlas fetched it. The itinerary IS the content of a sailing page, and
// the adapter builds `stops` from this file, so the page needs it too.
import cruiseRoutes from "@/public/maps/cruise/data/itinerary-routes.json";
import worldRaw from "@/data/atlas/world/itinerary.json";
import yachtRaw from "@/data/atlas/yacht/itinerary.json";
import trainRaw from "@/data/atlas/train/itinerary.json";
import jetRaw from "@/data/atlas/jet/itinerary.json";
import safariRaw from "@/data/atlas/safari/itinerary.json";

/**
 * Per-collection wiring: how to adapt it, and how to read the three prose
 * fields the adapters do not carry (description, what's included, live offers).
 *
 * The three raw shapes are genuinely different — cruise is columnar, the
 * voyages key `promotions` off the trip, the journeys add `included` — and this
 * table is where that ends. Everything downstream sees one shape.
 */
const cruiseIdx = (() => {
  const idx = {};
  (cruiseSailings.schema || []).forEach((name, i) => { idx[name] = i; });
  return idx;
})();

const COLLECTIONS = {
  cruise: {
    label: "Expedition cruises",
    noun: "sailing",
    nounPlural: "sailings",
    blurb:
      "Small-ship expedition sailings — Antarctica, the Arctic, the Galápagos and the world's wilder coasts — day by day, with every departure listed.",
    adapt: () =>
      adaptCruise(cruiseSailings, cruiseMeta, cruiseRoutes, cruiseRegionOverrides),
    extras: () => {
      const map = new Map();
      for (const row of cruiseSailings.rows || []) {
        let offers = [];
        // The offers column ships as a JSON *string*, not an array.
        try {
          offers = JSON.parse(row[cruiseIdx.offers] || "[]");
        } catch {
          offers = [];
        }
        map.set(String(row[cruiseIdx.id]), {
          description: row[cruiseIdx.description] || null,
          included: [],
          promotions: Array.isArray(offers) ? offers : [],
        });
      }
      return map;
    },
  },
  worldcruise: {
    label: "World cruises",
    noun: "voyage",
    nounPlural: "voyages",
    blurb:
      "Full circumnavigations and grand voyages, with their whole port list and the segments they are also sold in.",
    adapt: () => adaptWorldCruise(worldRaw),
    extras: () => tripExtras(worldRaw),
  },
  yacht: {
    label: "Hotel-brand yachts",
    noun: "voyage",
    nounPlural: "voyages",
    blurb:
      "The hotel brands at sea — Ritz-Carlton, Four Seasons, Orient Express — itinerary by itinerary.",
    adapt: () => adaptYacht(yachtRaw),
    extras: () => tripExtras(yachtRaw),
  },
  train: {
    label: "Luxury rail",
    noun: "journey",
    nounPlural: "journeys",
    blurb:
      "Named trains and rail-centred itineraries, with what each fare includes.",
    adapt: () => adaptTrain(trainRaw),
    extras: () => tripExtras(trainRaw),
  },
  jet: {
    label: "Private jet journeys",
    noun: "journey",
    nounPlural: "journeys",
    blurb:
      "Around-the-world and regional itineraries flown by private jet, with the route as it is actually flown.",
    adapt: () => adaptJet(jetRaw),
    extras: () => tripExtras(jetRaw),
  },
  safari: {
    label: "Safaris",
    noun: "safari",
    nounPlural: "safaris",
    blurb:
      "Guided safari itineraries — camps, countries and days — with what each one includes.",
    adapt: () => adaptSafari(safariRaw),
    extras: () => tripExtras(safariRaw),
  },
};

/** The voyage/journey feeds all key their prose off the trip object itself. */
function tripExtras(raw) {
  const map = new Map();
  (raw.TRIPS || []).forEach((t, i) => {
    map.set(String(t?.id ?? i), {
      description: t?.description || null,
      included: t?.included || [],
      promotions: t?.promotions || [],
    });
  });
  return map;
}

export const JOURNEY_COLLECTIONS = Object.keys(COLLECTIONS);
export const collectionMeta = (type) => COLLECTIONS[type] || null;

const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

/**
 * Group one collection's offerings into itineraries.
 *
 * The group key is operator plus title, which is also the slug, so two
 * itineraries can only collide if they fold to the same string after
 * slugification. That is broken the way the hotel slugs are: groups are walked
 * in a deterministic order and the first one keeps the clean URL, so a feed
 * that later adds a colliding itinerary cannot take an existing page's address.
 */
function buildCollection(type) {
  const meta = COLLECTIONS[type];
  const offerings = meta.adapt();
  const extras = meta.extras();

  const groups = new Map();
  for (const o of offerings) {
    const operator = o.brandLabel || o.operator || null;
    const key = `${operator || ""}|${o.title}`;
    const g = groups.get(key) || {
      collection: type,
      title: o.title,
      operator,
      departures: [],
      regions: new Set(),
      vessels: new Set(),
      countries: new Set(),
    };
    g.departures.push(o);
    for (const r of o.regions || []) g.regions.add(r);
    if (o.vessel) g.vessels.add(o.vessel);
    if (o.country) g.countries.add(o.country);
    groups.set(key, g);
  }

  const ordered = [...groups.values()].sort((a, b) =>
    String(a.departures[0].id).localeCompare(String(b.departures[0].id)),
  );

  const bySlug = new Map();
  for (const g of ordered) {
    const base = slugify([g.operator, g.title].filter(Boolean).join(" ")) ||
      slugify(g.departures[0].id);
    const slug = bySlug.has(base) ? `${base}-${slugify(g.departures[0].id)}` : base;

    // The departure that best represents the itinerary: the one the adapters
    // gave the most itinerary rows, because a route with more named calls is
    // the one worth rendering. Ties break on the earliest departure.
    const representative = [...g.departures].sort(
      (a, b) =>
        (b.itinerary?.length || 0) - (a.itinerary?.length || 0) ||
        String(a.startDate || "9999").localeCompare(String(b.startDate || "9999")),
    )[0];

    const extra = extras.get(String(representative.id)) ||
      g.departures.map((d) => extras.get(String(d.id))).find((e) => e && e.description) ||
      { description: null, included: [], promotions: [] };

    // Offers are per-departure in the feed; an itinerary page states the union,
    // because a reader asking "is there an offer on this" does not mean "on the
    // 14 March sailing specifically".
    const promotions = [];
    const seenOffer = new Set();
    for (const d of g.departures) {
      for (const p of (extras.get(String(d.id)) || {}).promotions || []) {
        const name = clean(p?.name);
        if (!name || seenOffer.has(name)) continue;
        seenOffer.add(name);
        promotions.push(p);
      }
    }

    bySlug.set(slug, {
      collection: type,
      slug,
      path: `/journeys/${type}/${slug}`,
      title: g.title,
      operator: g.operator,
      vessels: [...g.vessels],
      regions: [...g.regions],
      countries: [...g.countries],
      days: representative.days,
      thumb: g.departures.map((d) => d.thumb).find(Boolean) || null,
      world: g.departures.some((d) => d.world),
      onDemand: g.departures.every((d) => d.onDemand),
      window: g.departures.map((d) => d.window).find(Boolean) || null,
      itinerary: representative.itinerary || [],
      stops: representative.stops || [],
      description: extra.description,
      included: extra.included || [],
      promotions,
      departures: [...g.departures]
        .sort((a, b) =>
          String(a.startDate || "9999").localeCompare(String(b.startDate || "9999")),
        )
        .map((d) => ({
          id: d.id,
          startDate: d.startDate,
          endDate: d.endDate,
          days: d.days,
          vessel: d.vessel,
          window: d.window,
          onDemand: d.onDemand,
          url: d.url,
          hasPromotion: Boolean(d.hasPromotion),
        })),
    });
  }
  return bySlug;
}

// Built once per process, lazily: a route that only renders /journeys/train has
// no reason to adapt 3,662 sailings and read 3.6MB of route geometry.
const CACHE = new Map();
function collectionIndex(type) {
  if (!COLLECTIONS[type]) return null;
  if (!CACHE.has(type)) CACHE.set(type, buildCollection(type));
  return CACHE.get(type);
}

export const journeysIn = (type) => [...(collectionIndex(type)?.values() ?? [])];
export const getJourney = (type, slug) => collectionIndex(type)?.get(slug) || null;

/** Every collection with its itinerary and departure counts, for the hubs. */
export function journeyCollections() {
  return JOURNEY_COLLECTIONS.map((type) => {
    const items = journeysIn(type);
    return {
      type,
      ...COLLECTIONS[type],
      itineraries: items.length,
      departures: items.reduce((n, j) => n + j.departures.length, 0),
    };
  });
}

/**
 * Prebuilt at deploy: the itineraries with the most departures behind them,
 * per collection. Those are both the most asked about and the most expensive
 * to render, and everything else is ISR — the same split the hotel and villa
 * pages use.
 */
export function featuredJourneyParams(perCollection = 40) {
  return JOURNEY_COLLECTIONS.flatMap((type) =>
    [...journeysIn(type)]
      .sort((a, b) => b.departures.length - a.departures.length)
      .slice(0, perCollection)
      .map((j) => ({ collection: type, slug: j.slug })),
  );
}

export function journeySitemapEntries() {
  return [
    { url: `${SITE_URL}/journeys`, priority: 0.9 },
    ...JOURNEY_COLLECTIONS.map((type) => ({
      url: `${SITE_URL}/journeys/${type}`,
      priority: 0.7,
    })),
    ...JOURNEY_COLLECTIONS.flatMap((type) =>
      journeysIn(type).map((j) => ({ url: `${SITE_URL}${j.path}`, priority: 0.5 })),
    ),
  ];
}

/** Other itineraries by the same operator, then anywhere in the collection. */
export function relatedJourneys(j, limit = 8) {
  const all = journeysIn(j.collection).filter((o) => o.slug !== j.slug);
  const sameOperator = all.filter((o) => o.operator && o.operator === j.operator);
  const sameRegion = all.filter(
    (o) => !sameOperator.includes(o) && o.regions.some((r) => j.regions.includes(r)),
  );
  return [...sameOperator, ...sameRegion].slice(0, limit);
}

/**
 * The itinerary as schema.org.
 *
 * `TouristTrip` with the ports as an ordered `ItemList` of `Place`, and each
 * departure as a `subTrip` carrying its own dates — which is exactly the shape
 * the page renders, and the reason the page is one itinerary rather than 235
 * near-identical ones.
 *
 * No `offers` and no price, for the same reason the hotel pages carry none: we
 * hold no rates. `provider` names the operator, which we do know.
 */
export function journeyJsonLd(j) {
  const url = `${SITE_URL}${j.path}`;
  const places = (j.itinerary.length ? j.itinerary : j.stops).filter((s) => s && s.name);

  const node = {
    "@context": "https://schema.org",
    "@type": "TouristTrip",
    "@id": `${url}#trip`,
    name: j.title,
    url,
    description: clean(j.description) || undefined,
    provider: j.operator
      ? { "@type": "Organization", name: j.operator }
      : undefined,
    publisher: orgRef(),
    image: j.thumb || undefined,
    itinerary: places.length
      ? {
          "@type": "ItemList",
          numberOfItems: places.length,
          itemListElement: places.map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: { "@type": "Place", name: clean(s.name) },
          })),
        }
      : undefined,
    subTrip: j.departures
      .filter((d) => d.startDate)
      .slice(0, 50)
      .map((d) => ({
        "@type": "Trip",
        name: `${j.title} — ${d.startDate}`,
        departureTime: d.startDate,
        arrivalTime: d.endDate || undefined,
        ...(d.vessel ? { provider: { "@type": "Organization", name: j.operator || d.vessel } } : {}),
      })),
  };
  if (!node.subTrip.length) delete node.subTrip;
  return JSON.parse(JSON.stringify(node));
}

export function journeyBreadcrumbJsonLd(j) {
  const meta = COLLECTIONS[j.collection];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Journeys", item: `${SITE_URL}/journeys` },
      {
        "@type": "ListItem",
        position: 2,
        name: meta.label,
        item: `${SITE_URL}/journeys/${j.collection}`,
      },
      { "@type": "ListItem", position: 3, name: j.title, item: `${SITE_URL}${j.path}` },
    ],
  };
}

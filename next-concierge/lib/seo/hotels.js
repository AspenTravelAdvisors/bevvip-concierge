// The crawlable hotel entity layer.
//
// Until now the 2,240 properties in the atlas existed for a crawler only as a
// number in a sentence. The map is a client component, the dossier fetches
// `/api/hotel/luxury-hotels/:id`, and robots.txt disallows `/api/` — so every
// fact the Virtuoso sync brought in (the year-stamped benefits, the supplier's
// own description, the coordinates, the room counts, the live promotions) was
// invisible to search and to answer engines alike. An answer page could say
// "1,930 Virtuoso properties" and there was no page anywhere naming one.
//
// This module is the server-side half of the fix: one stable URL per property,
// resolved from the same merged feed the atlas queries, plus the schema.org
// description of it. The pages themselves are app/hotels/**.
//
// Server-only. Never import from a "use client" file: it pulls the 11MB feed.

import rawHotels from "@/data/atlas/hotel/luxury-hotels.json";
import { applyHotelOverlays } from "@/lib/atlas/hotel-overlays.js";
import { isNotAPlace } from "@/lib/atlas/country-overrides.js";
import { SITE_URL } from "@/lib/answers";
import { orgRef } from "@/lib/seo/site";

// The same overlays the API and the map apply, through the same function, for
// the same reason: a property's programme and its country are each decided in
// ONE place, or the page and the atlas disagree about what a country contains.
const HOTELS = applyHotelOverlays(rawHotels);

const fold = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export const slugify = (s) =>
  fold(s)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Slugs, assigned once for the whole feed rather than computed per record.
 *
 * Name + city is unique across the catalogue in every case but one (two Oberoi
 * Beach Resorts both addressed "Hurghada, Egypt"), and a URL that changes when
 * a second property collides with it is a URL that 404s for everyone who
 * bookmarked it. So the tie is broken deterministically by our stable `id`:
 * the lower id keeps the clean slug, later arrivals carry an id suffix. A new
 * colliding property therefore cannot take an existing property's URL away.
 */
function buildIndex() {
  const bySlug = new Map();
  const byId = new Map();
  const taken = new Set();
  const ordered = [...HOTELS].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  for (const h of ordered) {
    /*
     * Three records get no page, and it is the honest outcome rather than a
     * gap: Mandarin Oriental Exclusive Homes, Rocco Forte Private Villas and
     * The Ritz-Carlton Residences are filed under the country "Various", have
     * no city, an address that reads literally "Various", and placeholder
     * coordinates — the Mandarin Oriental entry sits in the Gulf of Tonkin.
     * They are portfolio listings spanning many countries.
     *
     * An address page for a property with no address is a page that invents
     * one, and /hotels/various is a country hub for a country. They stay in the
     * atlas and stay searchable; they are simply not addressable. See
     * data/atlas/hotel/country-overrides.json.
     */
    if (isNotAPlace(h.country)) continue;

    const destination = slugify(h.country) || "worldwide";
    const base = slugify([h.name, h.city].filter(Boolean).join(" ")) || slugify(h.id);
    let slug = base;
    if (taken.has(`${destination}/${slug}`)) slug = `${base}-${slugify(h.id)}`;
    taken.add(`${destination}/${slug}`);

    const entry = { ...h, destination, slug, path: `/hotels/${destination}/${slug}` };
    bySlug.set(`${destination}/${slug}`, entry);
    byId.set(String(h.id), entry);
  }
  return { bySlug, byId };
}

const INDEX = buildIndex();

export const allHotels = () => [...INDEX.bySlug.values()];
export const hotelCount = () => INDEX.bySlug.size;
export const getHotelBySlug = (destination, slug) =>
  INDEX.bySlug.get(`${destination}/${slug}`) || null;
export const getHotelById = (id) => INDEX.byId.get(String(id)) || null;
export const hotelPath = (h) => (h && h.path) || null;

/** Every country that has at least one property, with its count and label. */
export function hotelDestinations() {
  const groups = new Map();
  for (const h of allHotels()) {
    const g = groups.get(h.destination) || {
      destination: h.destination,
      country: h.country,
      hotels: [],
    };
    g.hotels.push(h);
    groups.set(h.destination, g);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      count: g.hotels.length,
      cities: [...new Set(g.hotels.map((h) => h.city).filter(Boolean))].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
}

export function getDestination(destination) {
  return hotelDestinations().find((d) => d.destination === destination) || null;
}

/**
 * Every property's route params — the whole detail tree, built at deploy.
 *
 * This used to prebuild 400 of 2,240, round-robin across countries so the warm
 * set was geographically wide, and leave the other 1,840 to ISR. It read as a
 * sensible compromise and it was not one, because it was pricing a render that
 * has no price to pay: these pages resolve entirely from JSON committed to this
 * repository, so a property's page is the same bytes on every request until the
 * next deploy. "On demand" therefore bought nothing and cost a billed ISR write
 * per page per deployment — against crawler traffic the entity layer exists to
 * attract. See "The ISR writes were paying for nothing" in STATE.md.
 *
 * Built here with `dynamicParams = false` on the page, a property is a static
 * asset on the CDN. It also closes a gap: the set of pages that exist is now
 * derived from `allHotels()`, the same call `hotelSitemapEntries()` makes, so
 * the sitemap cannot advertise a URL the build did not produce.
 */
export function hotelDetailParams() {
  return allHotels().map((h) => ({ destination: h.destination, slug: h.slug }));
}

/**
 * The whole hotel tree for the sitemap — the root hub, every country, every
 * property. It owns the root deliberately: when app/sitemap.js also listed the
 * hubs, /villas and /journeys each shipped twice in one file.
 */
export function hotelSitemapEntries() {
  return [
    { url: `${SITE_URL}/hotels`, priority: 0.9 },
    ...hotelDestinations().map((d) => ({
      url: `${SITE_URL}/hotels/${d.destination}`,
      priority: 0.6,
    })),
    ...allHotels().map((h) => ({ url: `${SITE_URL}${h.path}`, priority: 0.5 })),
  ];
}

/** Other properties in the same city, then the same country. */
export function relatedHotels(h, limit = 6) {
  const sameCity = allHotels().filter(
    (o) => o.id !== h.id && o.country === h.country && o.city && o.city === h.city,
  );
  const sameCountry = allHotels().filter(
    (o) => o.id !== h.id && o.country === h.country && o.city !== h.city,
  );
  return [...sameCity, ...sameCountry].slice(0, limit);
}

/** Live supplier offers that have not expired as of `on`. */
export function activePromotions(h, on = new Date()) {
  const today = on.toISOString().slice(0, 10);
  return (h.promotions || []).filter((p) => !p.endDate || p.endDate >= today);
}

const clean = (s) =>
  String(s == null ? "" : s)
    .replace(/\s+/g, " ")
    .trim();

/**
 * The property as schema.org.
 *
 * Two deliberate omissions, because a rich result that is wrong is worse than
 * none:
 *
 * `aggregateRating` — the feed carries `reviews.total` and
 * `recommendedPercent` for 1,599 properties, and it is tempting. They are
 * Virtuoso ADVISOR reviews, collected by the supplier, not reviews of or by
 * this site, and "% who recommend" is not a rating on a scale. Google's
 * structured-data policy asks for ratings the publisher itself collected. The
 * number is worth showing a reader with its source named — the page does that
 * in prose — but not worth claiming as our star rating.
 *
 * `priceRange` / `offers` — we do not hold rates. The whole architecture is
 * built on the language model never being the rate source, and markup is not
 * an exception to that.
 */
export function hotelJsonLd(h) {
  const url = `${SITE_URL}${h.path}`;
  const amenities = [
    ...(h.roomAmenities || []),
    ...(h.experiences || []),
  ].map((a) => ({ "@type": "LocationFeatureSpecification", name: a, value: true }));

  const node = {
    "@context": "https://schema.org",
    "@type": ["Hotel", "LodgingBusiness"],
    "@id": `${url}#hotel`,
    name: h.name,
    url,
    description: clean(h.summary || h.description) || undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: clean(h.address) || undefined,
      addressLocality: clean(h.city) || undefined,
      addressRegion: clean(h.adminRegion) || undefined,
      postalCode: clean(h.postalCode) || undefined,
      addressCountry: h.countryCode || h.country || undefined,
    },
    geo:
      Number.isFinite(h.lat) && Number.isFinite(h.lng)
        ? { "@type": "GeoCoordinates", latitude: h.lat, longitude: h.lng }
        : undefined,
    image: (h.images || []).slice(0, 6),
    photo: h.thumb || undefined,
    brand: h.brand ? { "@type": "Brand", name: h.brand } : undefined,
    numberOfRooms: Number.isFinite(h.numberOfRooms) ? h.numberOfRooms : undefined,
    amenityFeature: amenities.length ? amenities : undefined,
    // The perks are the reason a traveller books through an advisor at all, so
    // they are the part of the page most worth making machine-readable.
    hasOfferCatalog: (h.vipUpgrades || []).length
      ? {
          "@type": "OfferCatalog",
          name: `${h.program || "Preferred partner"} benefits${h.perksYear ? ` (${h.perksYear})` : ""}`,
          itemListElement: h.vipUpgrades.map((p, i) => ({
            "@type": "Offer",
            position: i + 1,
            name: clean(p),
            seller: orgRef(),
          })),
        }
      : undefined,
    isAccessibleForFree: false,
    publisher: orgRef(),
  };
  // Drop the undefined keys rather than serialising `null`s a validator flags.
  return JSON.parse(JSON.stringify(node));
}

export function hotelBreadcrumbJsonLd(h) {
  const items = [
    { name: "Hotels", item: `${SITE_URL}/hotels` },
    { name: h.country, item: `${SITE_URL}/hotels/${h.destination}` },
    { name: h.name, item: `${SITE_URL}${h.path}` },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.item,
    })),
  };
}

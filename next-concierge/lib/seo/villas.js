// The villa entity layer — schema for the detail pages, and the hubs that were
// missing under them.
//
// Villas are the one collection that already HAD detail pages: 3,902 of them at
// /atlas/villa/<destination>/<slug>, server-rendered, all built at deploy. Two
// things were missing, and neither is visible from the page itself.
//
//   1. **No structured data at all.** Not a single JSON-LD block on any of
//      them, so a page carrying a name, a place, coordinates, a sleeps count
//      and a bedroom count published none of it in a form a machine reads.
//   2. **Nothing linked to them.** Only the 114 featured villas were in the
//      sitemap, and the browse surface at /atlas/villa reaches the rest through
//      client-side pagination. 3,788 pages existed and were unreachable — worse
//      than not existing, because they cost render budget and returned nothing.
//
// The detail URLs are deliberately NOT moved. They are live, indexed and
// linked; a tidier /villas/<destination>/<slug> would be a tidier address for
// 3,902 pages that currently answer, and every one of the old ones would 404.
// So the hubs live at /villas and link into /atlas/villa/… where the pages
// already are.
//
// Server-only: this pulls the 7.3MB villa feed.

import { loadVillas } from "@/lib/villas.js";
import { SITE_URL } from "@/lib/answers";
import { orgRef } from "@/lib/seo/site";

const all = () => loadVillas().villas;

/** The detail route these pages have always lived at. */
export const villaPath = (v) =>
  `/atlas/villa/${v.destinationSlug}/${v.slug}`;

/** Destinations with at least one villa, largest first. */
export function villaDestinations() {
  const groups = new Map();
  for (const v of all()) {
    if (!v.destinationSlug) continue;
    const g = groups.get(v.destinationSlug) || {
      destination: v.destination,
      destinationSlug: v.destinationSlug,
      region: v.region,
      villas: [],
    };
    g.villas.push(v);
    groups.set(v.destinationSlug, g);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      count: g.villas.length,
      locations: [...new Set(g.villas.map((v) => v.location).filter(Boolean))].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.destination.localeCompare(b.destination));
}

export const getVillaDestination = (slug) =>
  villaDestinations().find((d) => d.destinationSlug === slug) || null;

/**
 * The villa hubs — and only the hubs.
 *
 * The 3,902 detail entries that used to be the third line of this array are
 * gone. They are noindex, follow at the page (see the note in
 * app/atlas/villa/[destination]/[slug]/page.jsx), and submitting a URL that
 * answers noindex is a contradiction a crawler resolves by spending budget to
 * be told no — 3,902 times, in a file whose other 716 entries are pages we do
 * want read.
 *
 * This is NOT a return to the state described at the top of this file. Back
 * then 114 villas were listed and the other 3,788 were unreachable: nothing
 * linked to them at all. The hubs below link to every one of them, and `follow`
 * keeps those links carrying. What changed is what gets submitted for indexing,
 * not what can be reached.
 */
export function villaSitemapEntries() {
  return [
    { url: `${SITE_URL}/villas`, priority: 0.9 },
    ...villaDestinations().map((d) => ({
      url: `${SITE_URL}/villas/${d.destinationSlug}`,
      priority: 0.6,
    })),
  ];
}

export const villaCount = () => all().length;

const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

/**
 * One villa as schema.org.
 *
 * `VacationRental` is the type that exists for exactly this — a whole private
 * property let by the night — and it inherits LodgingBusiness, so the address,
 * geo and occupancy fields are the ones a search engine already understands.
 *
 * Two omissions carried over from the hotel pages, for the same reasons:
 *
 * `offers` / `priceRange` — 
 * we hold a supplier "from" rate and nothing else. It is not a bookable price,
 * it does not know the party size or the dates, and 
 * a third of the catalogue is "Call for Pricing". Publishing it as an Offer
 * would be publishing a number nobody can hold us to.
 *
 * `geo` is emitted ONLY where the coordinate is the villa's own. 236 villas sit
 * on a locality centroid because the supplier does not publish their address;
 * the page already says so in prose, and a GeoCoordinates node claiming a town
 * square is the villa is a worse lie in markup than it is in a sentence.
 *
 * `addressCountry` is omitted entirely, and that is not laziness. The feed's
 * `destination` is a country for "South Africa" and a US state for "Florida",
 * a Mexican resort town for "Punta Mita" and a Canadian province for "British
 * Columbia" — 62 values mixing four levels of administrative geography. The
 * first draft of this function mapped it straight onto addressCountry and
 * published `"addressCountry": "Florida"`. `region` is no better: it is a
 * marketing bucket ("Caribbean", "South Pacific"). We do not hold a country
 * for a villa, so the markup does not claim one.
 */
export function villaJsonLd(v) {
  const url = `${SITE_URL}${villaPath(v)}`;
  const node = {
    "@context": "https://schema.org",
    "@type": ["VacationRental", "LodgingBusiness"],
    "@id": `${url}#villa`,
    name: v.name,
    url,
    description: clean(v.summary) || undefined,
    address: {
      "@type": "PostalAddress",
      addressLocality: clean(v.location) || undefined,
      addressRegion: clean(v.destination) || undefined,
    },
    geo:
      v.exactLocation && Number.isFinite(v.lat) && Number.isFinite(v.lon)
        ? { "@type": "GeoCoordinates", latitude: v.lat, longitude: v.lon }
        : undefined,
    image: v.imageUrl || undefined,
    numberOfBedrooms: Number.isFinite(v.bedrooms) ? v.bedrooms : undefined,
    numberOfBathroomsTotal: Number.isFinite(v.bathrooms) ? v.bathrooms : undefined,
    occupancy: Number.isFinite(v.sleeps)
      ? { "@type": "QuantitativeValue", maxValue: v.sleeps, unitText: "guests" }
      : undefined,
    publisher: orgRef(),
  };
  return JSON.parse(JSON.stringify(node));
}

export function villaBreadcrumbJsonLd(v) {
  const items = [
    { name: "Villas", item: `${SITE_URL}/villas` },
    { name: v.destination, item: `${SITE_URL}/villas/${v.destinationSlug}` },
    { name: v.name, item: `${SITE_URL}${villaPath(v)}` },
  ].filter((i) => i.name);
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

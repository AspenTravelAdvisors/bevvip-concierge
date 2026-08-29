// /villas/[destination] — every villa we hold in one destination, by location.
//
// The page that makes the 3,902 detail pages reachable. Links go to
// /atlas/villa/<destination>/<slug>, where those pages already live and are
// already indexed — see the note in lib/seo/villas.js about not moving them.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  villaDestinations,
  getVillaDestination,
  villaPath,
} from "@/lib/seo/villas";
import { SITE_URL } from "@/lib/answers";
import { orgRef } from "@/lib/seo/site";
import SiteFooter from "@/components/SiteFooter";

export const dynamicParams = false;

export function generateStaticParams() {
  return villaDestinations().map((d) => ({ destination: d.destinationSlug }));
}

export async function generateMetadata({ params }) {
  const { destination } = await params;
  const d = getVillaDestination(destination);
  if (!d) return {};
  return {
    title: `Private Villas in ${d.destination} — ${d.count} in the Atlas`,
    description: `Every private villa in ${d.destination} in our atlas (${d.count}), with sleeps, bedrooms and location on each — arranged with VIP benefits by Aspen Travel Advisors.`,
    alternates: { canonical: `${SITE_URL}/villas/${d.destinationSlug}` },
  };
}

const nf = new Intl.NumberFormat("en-US");

export default async function VillaDestinationPage({ params }) {
  const { destination } = await params;
  const d = getVillaDestination(destination);
  if (!d) notFound();

  const byLocation = new Map();
  for (const v of d.villas) {
    const key = v.location || "Elsewhere";
    byLocation.set(key, [...(byLocation.get(key) || []), v]);
  }
  const locations = [...byLocation.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${SITE_URL}/villas/${d.destinationSlug}#list`,
    name: `Private villas in ${d.destination}`,
    numberOfItems: d.count,
    itemListElement: d.villas.map((v, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "VacationRental",
        "@id": `${SITE_URL}${villaPath(v)}#villa`,
        name: v.name,
        url: `${SITE_URL}${villaPath(v)}`,
      },
    })),
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Villas", item: `${SITE_URL}/villas` },
      {
        "@type": "ListItem",
        position: 2,
        name: d.destination,
        item: `${SITE_URL}/villas/${d.destinationSlug}`,
      },
    ],
  };

  const withOffers = d.villas.filter((v) => v.hasSpecials).length;
  const bigGroup = d.villas.filter((v) => (v.sleeps || 0) >= 12).length;

  return (
    <div className="answers-wrap">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            url: `${SITE_URL}/villas/${d.destinationSlug}`,
            name: `Private villas in ${d.destination}`,
            publisher: orgRef(),
          }),
        }}
      />

      <nav className="answers-crumbs">
        <Link href="/villas">Villas</Link>
        <span aria-hidden="true"> / </span>
        <span>{d.destination}</span>
      </nav>

      <header className="answers-head">
        <h1>Private villas in {d.destination}</h1>
        <p>
          {nf.format(d.count)} {d.count === 1 ? "villa" : "villas"} across{" "}
          {locations.length} {locations.length === 1 ? "location" : "locations"}.
          {bigGroup > 0 ? ` ${bigGroup} sleep 12 or more.` : ""}
          {withOffers > 0 ? ` ${withOffers} carry a current offer.` : ""}{" "}
          <Link href={`/atlas/villa?destination=${encodeURIComponent(d.destination)}`}>
            See them on the map
          </Link>
          .
        </p>
      </header>

      {locations.map(([location, list]) => (
        <section key={location} className="answers-group">
          <h2>{location}</h2>
          <ul>
            {list
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((v) => (
                <li key={v.id}>
                  <Link href={villaPath(v)}>{v.name}</Link>
                  <span className="answers-desc">
                    {[
                      v.sleeps != null ? `sleeps ${v.sleeps}` : null,
                      v.bedrooms ? `${v.bedrooms} bedrooms` : null,
                      v.bathrooms ? `${v.bathrooms} baths` : null,
                      v.hasSpecials ? v.specialCategory || "current offer" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <SiteFooter />
    </div>
  );
}

// /hotels/[destination] — every property we hold in one country.
//
// Static for all 117 countries: the list is small, it changes only when the
// nightly sync moves inventory, and it is the page a crawler walks to reach the
// detail pages.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDestination, hotelDestinations } from "@/lib/seo/hotels";
import { SITE_URL } from "@/lib/answers";
import { orgRef } from "@/lib/seo/site";
import SiteFooter from "@/components/SiteFooter";

export const dynamicParams = false;

export function generateStaticParams() {
  return hotelDestinations().map((d) => ({ destination: d.destination }));
}

export async function generateMetadata({ params }) {
  const { destination } = await params;
  const d = getDestination(destination);
  if (!d) return {};
  return {
    title: `Luxury Hotels in ${d.country} — ${d.count} Vetted Properties`,
    description: `Every luxury hotel in ${d.country} in our atlas (${d.count}), with the VIP benefits on file for each and the supplier's own description.`,
    alternates: { canonical: `${SITE_URL}/hotels/${d.destination}` },
  };
}

export default async function DestinationPage({ params }) {
  const { destination } = await params;
  const d = getDestination(destination);
  if (!d) notFound();

  const byCity = new Map();
  for (const h of d.hotels) {
    const city = h.city || "Elsewhere";
    byCity.set(city, [...(byCity.get(city) || []), h]);
  }
  const cities = [...byCity.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${SITE_URL}/hotels/${d.destination}#list`,
    name: `Luxury hotels in ${d.country}`,
    numberOfItems: d.count,
    itemListElement: d.hotels.map((h, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Hotel",
        "@id": `${SITE_URL}${h.path}#hotel`,
        name: h.name,
        url: `${SITE_URL}${h.path}`,
      },
    })),
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Hotels", item: `${SITE_URL}/hotels` },
      {
        "@type": "ListItem",
        position: 2,
        name: d.country,
        item: `${SITE_URL}/hotels/${d.destination}`,
      },
    ],
  };

  const withPerks = d.hotels.filter((h) => (h.vipUpgrades || []).length).length;
  const withOffers = d.hotels.filter((h) => h.hasPromotion).length;

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
            url: `${SITE_URL}/hotels/${d.destination}`,
            name: `Luxury hotels in ${d.country}`,
            publisher: orgRef(),
          }),
        }}
      />

      <nav className="answers-crumbs">
        <Link href="/hotels">Hotels</Link>
        <span aria-hidden="true"> / </span>
        <span>{d.country}</span>
      </nav>

      <header className="answers-head">
        <h1>Luxury hotels in {d.country}</h1>
        <p>
          {d.count.toLocaleString("en-US")}{" "}
          {d.count === 1 ? "property" : "properties"} across {cities.length}{" "}
          {cities.length === 1 ? "town" : "towns and cities"}. {withPerks} carry VIP
          benefits on file
          {withOffers > 0 ? `, and ${withOffers} have a current supplier offer` : ""}.
        </p>
      </header>

      {cities.map(([city, list]) => (
        <section key={city} className="answers-group">
          <h2>{city}</h2>
          <ul>
            {list
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((h) => (
                <li key={h.id}>
                  <Link href={h.path}>{h.name}</Link>
                  <span className="answers-desc">
                    {[
                      h.category,
                      h.program,
                      (h.vipUpgrades || []).length
                        ? `${h.vipUpgrades.length} benefits on file`
                        : null,
                      h.hasPromotion ? "current offer" : null,
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

// /hotels — the crawlable front door to the property atlas.
//
// A hub, not a map: 117 countries, each linking to a page that names every
// property we hold there. This is the page that gives the 2,240 detail pages
// somewhere to be linked from, which is the difference between a sitemap entry
// and a page anything will actually reach.

import Link from "next/link";
import { hotelDestinations, hotelCount } from "@/lib/seo/hotels";
import { SITE_URL } from "@/lib/answers";
import { orgRef } from "@/lib/seo/site";
import SiteFooter from "@/components/SiteFooter";

export const metadata = {
  title: "Luxury Hotels — Every Property in the Atlas, by Country",
  description:
    "The luxury hotels Aspen Travel Advisors books with VIP benefits: browse every property in the atlas by country, with the supplier's own description, benefits and current offers on each.",
  alternates: { canonical: `${SITE_URL}/hotels` },
};

export default function HotelsIndex() {
  const destinations = hotelDestinations();
  const total = hotelCount();

  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${SITE_URL}/hotels#page`,
    url: `${SITE_URL}/hotels`,
    name: "Luxury hotel atlas",
    description: `${total.toLocaleString("en-US")} vetted luxury properties, by country.`,
    publisher: orgRef(),
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: destinations.length,
      itemListElement: destinations.map((d, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: d.country,
        url: `${SITE_URL}/hotels/${d.destination}`,
      })),
    },
  };

  return (
    <div className="answers-wrap">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collection) }}
      />
      <header className="answers-head">
        <h1>Luxury hotels</h1>
        <p>
          {total.toLocaleString("en-US")} vetted properties across {destinations.length}{" "}
          countries — each with the supplier&apos;s own description, the VIP benefits
          on file for it, its rooms, and any current offer. Facts come from the
          Virtuoso Partner API; the curation, ranking and advisor access are ours.
          For the same inventory on a map, use the{" "}
          <Link href="/atlas/hotel">hotel atlas</Link>; for the questions travelers
          ask about it, <Link href="/answers">the answers</Link>.
        </p>
      </header>

      <section className="answers-group">
        <h2>By country</h2>
        <ul className="hotel-destinations">
          {destinations.map((d) => (
            <li key={d.destination}>
              <Link href={`/hotels/${d.destination}`}>{d.country}</Link>
              <span className="answers-desc">
                {d.count.toLocaleString("en-US")}{" "}
                {d.count === 1 ? "property" : "properties"}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <SiteFooter />
    </div>
  );
}

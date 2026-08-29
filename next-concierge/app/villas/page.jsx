// /villas — the crawlable front door to the villa atlas.
//
// A hub, not a map. The villa detail pages have existed since the villa atlas
// shipped; what they never had was anything linking to them — only the 114
// featured villas reached the sitemap, and the browse surface paginates on the
// client. See lib/seo/villas.js.

import Link from "next/link";
import { villaDestinations, villaCount } from "@/lib/seo/villas";
import { SITE_URL } from "@/lib/answers";
import { orgRef } from "@/lib/seo/site";
import SiteFooter from "@/components/SiteFooter";

export const metadata = {
  title: "Private Villas — Every Villa in the Atlas, by Destination",
  description:
    "Browse every private villa in the Expedition Bucket List atlas by destination — sleeps, bedrooms, location and current offers on each, arranged by Aspen Travel Advisors.",
  alternates: { canonical: `${SITE_URL}/villas` },
};

const nf = new Intl.NumberFormat("en-US");

export default function VillasIndex() {
  const destinations = villaDestinations();
  const total = villaCount();

  const ld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${SITE_URL}/villas#page`,
    url: `${SITE_URL}/villas`,
    name: "Villa atlas",
    description: `${nf.format(total)} private villas, by destination.`,
    publisher: orgRef(),
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: destinations.length,
      itemListElement: destinations.map((d, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: d.destination,
        url: `${SITE_URL}/villas/${d.destinationSlug}`,
      })),
    },
  };

  return (
    <div className="answers-wrap">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
      <header className="answers-head">
        <h1>Private villas</h1>
        <p>
          {nf.format(total)} villas across {destinations.length} destinations —
          each with its own page giving sleeps, bedrooms, bathrooms, where it
          actually sits and any current offer. For the same inventory on a map
          with filters, use the <Link href="/atlas/villa">villa atlas</Link>; for
          the questions travelers ask about villas,{" "}
          <Link href="/answers">the answers</Link>.
        </p>
      </header>

      <section className="answers-group">
        <h2>By destination</h2>
        <ul className="hotel-destinations">
          {destinations.map((d) => (
            <li key={d.destinationSlug}>
              <Link href={`/villas/${d.destinationSlug}`}>{d.destination}</Link>
              <span className="answers-desc">
                {nf.format(d.count)} {d.count === 1 ? "villa" : "villas"}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <SiteFooter />
    </div>
  );
}

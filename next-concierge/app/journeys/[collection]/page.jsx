// /journeys/[collection] — every itinerary in one collection, by operator.
//
// Static for all six: the largest is 902 rows, it changes only when the nightly
// sync moves inventory, and it is the page a crawler walks to reach the detail
// pages.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  JOURNEY_COLLECTIONS,
  journeysIn,
  collectionMeta,
} from "@/lib/seo/journeys";
import { SITE_URL } from "@/lib/answers";
import { orgRef } from "@/lib/seo/site";
import SiteFooter from "@/components/SiteFooter";

export const dynamicParams = false;

export function generateStaticParams() {
  return JOURNEY_COLLECTIONS.map((collection) => ({ collection }));
}

export async function generateMetadata({ params }) {
  const { collection } = await params;
  const meta = collectionMeta(collection);
  if (!meta) return {};
  const items = journeysIn(collection);
  return {
    title: `${meta.label} — ${items.length} Itineraries, Day by Day`,
    description: `${meta.blurb} ${items.length} itineraries in the atlas, each with its full route and every listed departure.`,
    alternates: { canonical: `${SITE_URL}/journeys/${collection}` },
  };
}

const nf = new Intl.NumberFormat("en-US");

export default async function CollectionPage({ params }) {
  const { collection } = await params;
  const meta = collectionMeta(collection);
  if (!meta) notFound();

  const items = journeysIn(collection);
  const departures = items.reduce((n, j) => n + j.departures.length, 0);

  const byOperator = new Map();
  for (const j of items) {
    const key = j.operator || "Other operators";
    byOperator.set(key, [...(byOperator.get(key) || []), j]);
  }
  const operators = [...byOperator.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${SITE_URL}/journeys/${collection}#list`,
    name: meta.label,
    numberOfItems: items.length,
    itemListElement: items.map((j, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "TouristTrip",
        "@id": `${SITE_URL}${j.path}#trip`,
        name: j.title,
        url: `${SITE_URL}${j.path}`,
      },
    })),
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Journeys", item: `${SITE_URL}/journeys` },
      {
        "@type": "ListItem",
        position: 2,
        name: meta.label,
        item: `${SITE_URL}/journeys/${collection}`,
      },
    ],
  };

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
            url: `${SITE_URL}/journeys/${collection}`,
            name: meta.label,
            publisher: orgRef(),
          }),
        }}
      />

      <nav className="answers-crumbs">
        <Link href="/journeys">Journeys</Link>
        <span aria-hidden="true"> / </span>
        <span>{meta.label}</span>
      </nav>

      <header className="answers-head">
        <h1>{meta.label}</h1>
        <p>
          {nf.format(items.length)} itineraries from {operators.length} operators,{" "}
          {nf.format(departures)} departures between them. {meta.blurb} See the same
          inventory on the map in the{" "}
          <Link href={`/atlas/${collection}`}>{meta.label.toLowerCase()} atlas</Link>.
        </p>
      </header>

      {operators.map(([operator, list]) => (
        <section key={operator} className="answers-group">
          <h2>{operator}</h2>
          <ul>
            {list
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((j) => (
                <li key={j.slug}>
                  <Link href={j.path}>{j.title}</Link>
                  <span className="answers-desc">
                    {[
                      j.days ? `${j.days} days` : null,
                      j.vessels.join(", ") || null,
                      j.regions.join(", ") || null,
                      j.onDemand
                        ? "on request"
                        : `${j.departures.length} departure${j.departures.length === 1 ? "" : "s"}`,
                      j.promotions.length ? "current offer" : null,
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

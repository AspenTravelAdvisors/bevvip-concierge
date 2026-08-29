// /journeys — the crawlable front door to the six route atlases.

import Link from "next/link";
import { journeyCollections } from "@/lib/seo/journeys";
import { SITE_URL } from "@/lib/answers";
import { orgRef } from "@/lib/seo/site";
import SiteFooter from "@/components/SiteFooter";

export const metadata = {
  title: "Journeys — Expedition Cruises, World Cruises, Rail, Jets and Safaris",
  description:
    "Every itinerary in the Expedition Bucket List atlas, day by day: expedition sailings, world cruises, hotel-brand yacht voyages, luxury rail, private jet journeys and safaris — with all their departures listed.",
  alternates: { canonical: `${SITE_URL}/journeys` },
};

const nf = new Intl.NumberFormat("en-US");

export default function JourneysIndex() {
  const collections = journeyCollections();
  const itineraries = collections.reduce((n, c) => n + c.itineraries, 0);
  const departures = collections.reduce((n, c) => n + c.departures, 0);

  const ld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${SITE_URL}/journeys#page`,
    url: `${SITE_URL}/journeys`,
    name: "Journey atlas",
    description: `${nf.format(itineraries)} itineraries across ${collections.length} collections.`,
    publisher: orgRef(),
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: collections.length,
      itemListElement: collections.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.label,
        url: `${SITE_URL}/journeys/${c.type}`,
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
        <h1>Journeys</h1>
        <p>
          {nf.format(itineraries)} itineraries, {nf.format(departures)} departures
          behind them. A page here is an itinerary rather than a sailing date —
          one expedition itinerary can carry two hundred departures, and the
          question worth answering on a page is &ldquo;what is this journey, and
          when does it run&rdquo;. Facts come from the Virtuoso Partner API and
          refresh nightly. For the same inventory on a map, use the{" "}
          <Link href="/atlas/cruise">atlas</Link>; for the questions travelers
          ask about it, <Link href="/answers">the answers</Link>.
        </p>
      </header>

      <section className="answers-group">
        <h2>By collection</h2>
        <ul>
          {collections.map((c) => (
            <li key={c.type}>
              <Link href={`/journeys/${c.type}`}>{c.label}</Link>
              <span className="answers-desc">
                {nf.format(c.itineraries)} itineraries ·{" "}
                {nf.format(c.departures)} departures — {c.blurb}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <SiteFooter />
    </div>
  );
}

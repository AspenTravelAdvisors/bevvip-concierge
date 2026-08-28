// /hotels/[destination]/[slug] — one property, in full, as HTML.
//
// The atlas has always known all of this. None of it was ever crawlable: the
// map is a client component, the dossier fetches /api/hotel/luxury-hotels/:id,
// and robots.txt disallows /api/. So the site could say "1,930 Virtuoso
// properties" and not name one in a form a search or answer engine could read,
// which is the weakest possible position for a page whose entire claim is
// first-hand knowledge of specific hotels.
//
// This is that knowledge, server-rendered: the supplier's own description, the
// year-stamped benefits, coordinates, room counts, the live offers, each with
// Hotel + BreadcrumbList JSON-LD. Prebuilt for a wide slice at deploy and held
// by ISR for the rest — the arrangement the villa detail pages already use.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getHotelBySlug,
  featuredHotelParams,
  relatedHotels,
  activePromotions,
  hotelJsonLd,
  hotelBreadcrumbJsonLd,
} from "@/lib/seo/hotels";
import { SITE_URL } from "@/lib/answers";
import SiteFooter from "@/components/SiteFooter";

export const revalidate = 86400;
export const dynamicParams = true;

export function generateStaticParams() {
  return featuredHotelParams();
}

export async function generateMetadata({ params }) {
  const { destination, slug } = await params;
  const h = getHotelBySlug(destination, slug);
  if (!h) return {};
  const where = [h.city, h.adminRegion, h.country].filter(Boolean).join(", ");
  return {
    title: `${h.name} — ${where}`,
    description:
      (h.summary || h.description || "").slice(0, 240) ||
      `${h.name} in ${where}: VIP benefits, rooms and what our advisors know about it.`,
    alternates: { canonical: `${SITE_URL}${h.path}` },
    openGraph: {
      title: h.name,
      description: (h.summary || h.description || "").slice(0, 240),
      type: "website",
      url: `${SITE_URL}${h.path}`,
      images: h.thumb ? [h.thumb] : undefined,
    },
  };
}

function Facts({ h }) {
  const rows = [
    ["Where", [h.address, h.city, h.adminRegion, h.country].filter(Boolean).join(", ")],
    ["Category", h.category],
    ["Property type", h.propertyType],
    ["Brand", h.brand],
    ["Hotel group", h.chain],
    ["Rooms", Number.isFinite(h.numberOfRooms) ? h.numberOfRooms.toLocaleString("en-US") : null],
    ["Room types", Number.isFinite(h.roomTypeCount) ? h.roomTypeCount : null],
    [
      "Nearest airport",
      h.nearestAirport
        ? Number.isFinite(h.nearestAirportMiles)
          ? `${h.nearestAirport} · ${h.nearestAirportMiles} miles`
          : h.nearestAirport
        : null,
    ],
    ["Advisor programme", h.program],
    ["Style", (h.vibes || []).join(", ") || null],
    ["Known for", (h.experiences || []).join(", ") || null],
    ["Sustainability", (h.sustainability || []).join(", ") || null],
  ].filter(([, v]) => v != null && v !== "");

  return (
    <div className="answers-table-scroll">
      <table>
        <caption>The facts, as the supplier files them</caption>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function HotelPage({ params }) {
  const { destination, slug } = await params;
  const h = getHotelBySlug(destination, slug);
  if (!h) notFound();

  const where = [h.city, h.adminRegion, h.country].filter(Boolean).join(", ");
  const offers = activePromotions(h);
  const related = relatedHotels(h);
  const askHref = `/?ask=${encodeURIComponent(
    `Tell me about ${h.name} in ${where} — would it suit my trip, and what do I get booking it through you?`,
  )}`;

  return (
    <article className="answers-wrap answers-article hotel-detail">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(hotelJsonLd(h)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(hotelBreadcrumbJsonLd(h)) }}
      />

      <nav className="answers-crumbs">
        <Link href="/hotels">Hotels</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/hotels/${h.destination}`}>{h.country}</Link>
        <span aria-hidden="true"> / </span>
        <span>{h.name}</span>
      </nav>

      <h1>{h.name}</h1>
      <p className="answers-updated">
        {where}
        {h.program ? ` · ${h.program}` : ""}
        {h.perksYear ? ` · ${h.perksYear} benefits` : ""}
      </p>

      {h.thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="hotel-hero" src={h.thumb} alt={h.name} loading="eager" />
      )}

      {/* The direct answer to "what is this place", in the supplier's own
          words — first, before any of our framing, because it is the part an
          answer engine will lift. */}
      {(h.summary || h.description) && (
        <div className="answers-lead">
          <p>{h.summary || h.description}</p>
          {h.summary && h.description && h.description !== h.summary && (
            <p>{h.description}</p>
          )}
        </div>
      )}

      {(h.vipUpgrades || []).length > 0 && (
        <section>
          <h2>
            What you get booking it through us
            {h.perksYear ? ` (${h.perksYear} benefits)` : ""}
          </h2>
          <ul>
            {h.vipUpgrades.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <p>
            These are the {h.program || "preferred partner"} benefits on file for this
            property, on top of the hotel&apos;s own best flexible rate — not a
            discount and not a package.{" "}
            <Link href="/answers/virtuoso-perks-vs-booking-direct">
              How the benefit stack compares to booking direct
            </Link>
            .
          </p>
        </section>
      )}

      {offers.length > 0 && (
        <section>
          <h2>Current offers</h2>
          <ul>
            {offers.map((o) => (
              <li key={o.id}>
                <strong>{o.name}</strong>
                {o.endDate ? ` — through ${o.endDate}` : ""}
                {o.description ? <> · {o.description}</> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {h.inTheKnow && (
        <section>
          <h2>In the know</h2>
          <p>{h.inTheKnow}</p>
        </section>
      )}

      <section>
        <h2>The property, in facts</h2>
        <Facts h={h} />
      </section>

      {(h.rooms || []).length > 0 && (
        <section>
          <h2>Rooms and suites</h2>
          <ul>
            {h.rooms.map((r, i) => (
              <li key={i}>
                <strong>{r.name}</strong>
                {r.description ? ` — ${r.description}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(h.roomAmenities || []).length > 0 && (
        <section>
          <h2>In the room</h2>
          <p>{h.roomAmenities.join(" · ")}</p>
        </section>
      )}

      {/* Attributed rather than marked up as our own rating. These are
          Virtuoso ADVISOR reviews collected by the supplier, and "% who
          recommend" is not a star rating — so the number is stated with its
          source and deliberately kept out of the JSON-LD. See the note on
          hotelJsonLd in lib/seo/hotels.js. */}
      {h.reviews && h.reviews.total > 0 && (
        <section>
          <h2>What advisors say</h2>
          <p>
            {h.reviews.recommendedPercent}% of the {h.reviews.total} Virtuoso advisors
            who have filed a review of this property recommend it. Those reviews are
            collected by Virtuoso from advisors who have stayed, not by us and not from
            the public.
          </p>
        </section>
      )}

      {related.length > 0 && (
        <section>
          <h2>Nearby in the atlas</h2>
          <ul>
            {related.map((r) => (
              <li key={r.id}>
                <Link href={r.path}>{r.name}</Link> — {[r.city, r.country].filter(Boolean).join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <aside className="answers-related">
        <h2>Book it, or ask about it</h2>
        <p className="answers-cta">
          <Link href={askHref}>Ask The Guide about {h.name}</Link> — our AI concierge —
          or have our advisors price it with the benefits above included.{" "}
          <Link href={`/atlas/hotel?ids=${encodeURIComponent(h.id)}`}>
            See it on the map
          </Link>
          .
        </p>
      </aside>
      <SiteFooter />
    </article>
  );
}

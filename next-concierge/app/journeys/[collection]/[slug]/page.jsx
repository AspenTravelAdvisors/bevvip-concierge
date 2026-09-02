// /journeys/[collection]/[slug] — one itinerary, with every departure of it.
//
// Grouped by itinerary rather than by departure on purpose; the argument is in
// lib/seo/journeys.js and it is the difference between 902 substantial pages
// and 3,662 near-identical ones.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getJourney,
  featuredJourneyParams,
  relatedJourneys,
  collectionMeta,
  journeyJsonLd,
  journeyBreadcrumbJsonLd,
} from "@/lib/seo/journeys";
import { SITE_URL } from "@/lib/answers";
import SiteFooter from "@/components/SiteFooter";

/*
 * Never regenerate on a timer. See "The ISR writes were paying for nothing"
 * in STATE.md.
 *
 * This page renders from JSON committed to the repository, so it cannot change
 * between deployments. `revalidate = 86400` re-rendered identical bytes from an
 * identical file every day, and every regeneration is a billed ISR write.
 * `false` holds each entry for the life of the deployment instead; the nightly
 * sync's commit is what publishes new data, and a deploy starts a fresh cache,
 * so the pages are exactly as fresh as they were before.
 */
export const revalidate = false;
export const dynamicParams = true;

export function generateStaticParams() {
  return featuredJourneyParams();
}

export async function generateMetadata({ params }) {
  const { collection, slug } = await params;
  const j = getJourney(collection, slug);
  if (!j) return {};
  const meta = collectionMeta(collection);
  const where = j.regions.join(", ");
  return {
    title: `${j.title}${j.operator ? ` — ${j.operator}` : ""}`,
    description:
      (j.description || "").slice(0, 240) ||
      `${j.title}: ${j.days ? `${j.days} days, ` : ""}${
        j.departures.length
      } departure${j.departures.length === 1 ? "" : "s"}${
        where ? ` in ${where}` : ""
      }, day by day — a ${meta.noun} in the Expedition Bucket List atlas.`,
    alternates: { canonical: `${SITE_URL}${j.path}` },
    openGraph: {
      title: j.title,
      description: (j.description || "").slice(0, 240),
      type: "website",
      url: `${SITE_URL}${j.path}`,
      images: j.thumb ? [j.thumb] : undefined,
    },
  };
}

function dayLabel(row) {
  if (row.startDay == null) return null;
  return row.endDay && row.endDay !== row.startDay
    ? `Days ${row.startDay}–${row.endDay}`
    : `Day ${row.startDay}`;
}

export default async function JourneyPage({ params }) {
  const { collection, slug } = await params;
  const j = getJourney(collection, slug);
  if (!j) notFound();
  const meta = collectionMeta(collection);

  const related = relatedJourneys(j);
  const askHref = `/?ask=${encodeURIComponent(
    `Tell me about ${j.title}${j.operator ? ` with ${j.operator}` : ""}. Which departure would suit me, and what would it cost?`,
  )}`;

  const dated = j.departures.filter((d) => d.startDate);
  const facts = [
    ["Operator", j.operator],
    [meta.noun === "sailing" || meta.noun === "voyage" ? "Ship" : "Vessel", j.vessels.join(", ") || null],
    ["Length", j.days ? `${j.days} days` : null],
    ["Region", j.regions.join(", ") || null],
    ["Countries", j.countries.join(", ") || null],
    [
      "Departures",
      j.onDemand
        ? j.window || "On request, year-round"
        : `${j.departures.length} listed${
            dated.length ? ` · ${dated[0].startDate} to ${dated[dated.length - 1].startDate}` : ""
          }`,
    ],
  ].filter(([, v]) => v != null && v !== "");

  return (
    <article className="answers-wrap answers-article hotel-detail">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(journeyJsonLd(j)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(journeyBreadcrumbJsonLd(j)) }}
      />

      <nav className="answers-crumbs">
        <Link href="/journeys">Journeys</Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/journeys/${j.collection}`}>{meta.label}</Link>
        <span aria-hidden="true"> / </span>
        <span>{j.title}</span>
      </nav>

      <h1>{j.title}</h1>
      <p className="answers-updated">
        {[j.operator, j.vessels.join(", "), j.days ? `${j.days} days` : null]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {j.thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="hotel-hero" src={j.thumb} alt={j.title} loading="eager" />
      )}

      {j.description && (
        <div className="answers-lead">
          <p>{j.description}</p>
        </div>
      )}

      <section>
        <h2>The {meta.noun}, in facts</h2>
        <div className="answers-table-scroll">
          <table>
            <tbody>
              {facts.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {j.itinerary.length > 0 && (
        <section>
          <h2>Day by day</h2>
          <div className="answers-table-scroll">
            <table>
              <caption>
                The route as the supplier files it. Ports and stops without a
                coordinate are still listed — they are calls, not gaps.
              </caption>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Where</th>
                </tr>
              </thead>
              <tbody>
                {j.itinerary.map((row, i) => (
                  <tr key={i}>
                    <th scope="row">{dayLabel(row) || "—"}</th>
                    <td>{row.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* The whole reason this page is an itinerary and not a departure. */}
      <section>
        <h2>Every departure</h2>
        {j.onDemand ? (
          <p>
            This {meta.noun} runs on request rather than to a fixed calendar
            {j.window ? ` — ${j.window}` : ""}. Dates are built around you.
          </p>
        ) : (
          <div className="answers-table-scroll">
            <table>
              <caption>
                {j.departures.length} departure
                {j.departures.length === 1 ? "" : "s"} of this itinerary in the
                atlas. Dates come from the supplier feed and are refreshed nightly.
              </caption>
              <thead>
                <tr>
                  <th>Departs</th>
                  <th>Returns</th>
                  <th>Days</th>
                  <th>Ship</th>
                  <th>Offer</th>
                </tr>
              </thead>
              <tbody>
                {j.departures.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">{d.startDate || d.window || "On request"}</th>
                    <td>{d.endDate || "—"}</td>
                    <td>{d.days ?? "—"}</td>
                    <td>{d.vessel || "—"}</td>
                    <td>{d.hasPromotion ? "Yes" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {j.included.length > 0 && (
        <section>
          <h2>What the fare includes</h2>
          <ul>
            {j.included.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {j.promotions.length > 0 && (
        <section>
          <h2>Current offers</h2>
          <ul>
            {j.promotions.map((p, i) => (
              <li key={i}>
                <strong>{p.name}</strong>
                {p.dates ? ` — ${p.dates}` : p.endDate ? ` — through ${p.endDate}` : ""}
                {p.description ? <> · {p.description}</> : null}
              </li>
            ))}
          </ul>
          <p>
            Supplier offers, from the Virtuoso promotions feed. They stack with the
            advisor benefits on the booking rather than replacing them —{" "}
            <Link href="/answers/virtuoso-perks-vs-booking-direct">
              how that works
            </Link>
            .
          </p>
        </section>
      )}

      {related.length > 0 && (
        <section>
          <h2>Related in the atlas</h2>
          <ul>
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={r.path}>{r.title}</Link>
                {r.operator ? ` — ${r.operator}` : ""}
                {r.days ? `, ${r.days} days` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <aside className="answers-related">
        <h2>Book it, or ask about it</h2>
        <p className="answers-cta">
          <Link href={askHref}>Ask The Guide about this {meta.noun}</Link> — our AI
          concierge — or have our advisors price a departure with VIP benefits
          included.{" "}
          <Link href={`/atlas/${j.collection}?ids=${encodeURIComponent(j.departures[0].id)}`}>
            See it on the map
          </Link>
          .
        </p>
      </aside>
      <SiteFooter />
    </article>
  );
}

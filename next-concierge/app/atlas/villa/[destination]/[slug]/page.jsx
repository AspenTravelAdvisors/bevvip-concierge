// /atlas/villa/[destination]/[slug] — villa detail. The 114 featured villas
// are prebuilt at deploy; the other ~3,800 render on demand and stick around
// via ISR for a day (the dataset only changes when the source JSON is
// re-uploaded). All data resolves server-side from lib/villas — the client
// receives finished HTML, never the dataset.

import Link from "next/link";
import { notFound } from "next/navigation";
import { IBM_Plex_Mono } from "next/font/google";
import { getVillaBySlug, featuredVillaParams } from "@/lib/villas.js";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const revalidate = 86400;
export const dynamicParams = true;

export function generateStaticParams() {
  return featuredVillaParams();
}

export async function generateMetadata({ params }) {
  const { destination, slug } = await params;
  const v = getVillaBySlug(destination, slug);
  if (!v) return {};
  return {
    title: `${v.name} · Villa Atlas`,
    description: v.summary || `${v.name}, a private villa in ${v.location}, ${v.destination}.`,
  };
}

export default async function VillaDetailPage({ params }) {
  const { destination, slug } = await params;
  const v = getVillaBySlug(destination, slug);
  if (!v) notFound();

  const where = [v.location, v.destination].filter(Boolean).join(", ");
  const askHref = `/?ask=${encodeURIComponent(
    `Tell me about the villa ${v.name} in ${where}. Would it fit my trip?`,
  )}`;
  const requestHref = `/?ask=${encodeURIComponent(
    `I'd like to request the villa ${v.name} in ${where} through my advisor. Can you set that up?`,
  )}`;
  const stats = [
    v.sleeps != null ? `Sleeps ${v.sleeps}` : "Capacity on request",
    v.bedrooms ? `${v.bedrooms} bedrooms` : null,
    v.bathrooms ? `${v.bathrooms} bathrooms` : null,
  ].filter(Boolean);

  return (
    <div className={`villa-atlas villa-detail ${mono.variable}`}>
      <nav className="villa-crumbs mono">
        <Link href="/atlas/villa">Villa Atlas</Link>
        {v.region && (
          <>
            {" / "}
            <Link href={`/atlas/villa?region=${encodeURIComponent(v.region)}`}>{v.region}</Link>
          </>
        )}
        {v.destination && (
          <>
            {" / "}
            <Link href={`/atlas/villa?destination=${encodeURIComponent(v.destination)}`}>
              {v.destination}
            </Link>
          </>
        )}
      </nav>

      <div className="villa-hero">
        {v.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.imageUrl} alt={v.name} />
        )}
        <div className="villa-hero-badges">
          {v.featured && <span className="villa-badge">Featured</span>}
          {v.hasSpecials && (
            <span className="villa-badge special">{v.specialCategory || "Special offer"}</span>
          )}
        </div>
      </div>

      <div className="villa-detail-body">
        <h1>{v.name}</h1>
        <p className="villa-detail-where mono">
          {[v.location, v.destination, v.region].filter(Boolean).join(" · ")}
        </p>
        <p className="villa-detail-stats mono">
          {stats.join(" · ")} · <b>{v.priceDisplay}</b>
        </p>
        {v.nightlyFromUsd == null && (
          <p className="villa-detail-cfp">
            Pricing for this villa is on request. Your advisor confirms the rate for your
            dates and party.
          </p>
        )}
        {v.summary && <p className="villa-detail-summary">{v.summary}</p>}

        {v.specials.length > 0 && (
          <div className="villa-detail-specials">
            <h2>Current offers</h2>
            <ul>
              {v.specials.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p className="villa-detail-note">
              Offers are confirmed by your advisor at the time of request.
            </p>
          </div>
        )}

        <div className="villa-detail-ctas">
          <Link className="villa-cta-primary" href={requestHref}>
            Request this villa through your advisor →
          </Link>
          <Link className="villa-cta-secondary" href={askHref}>
            Ask the Guide about this villa
          </Link>
        </div>

        <p className="villa-detail-value">
          Arranged by your Aspen Travel Advisor. VIP travel benefits, zero membership fees.
        </p>

        {v.supplierDeepLink && (
          <p className="villa-supplier-ref mono">
            Internal reference:{" "}
            <a href={v.supplierDeepLink} target="_blank" rel="noreferrer">
              supplier listing ↗
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

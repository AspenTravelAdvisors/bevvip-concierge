// /atlas/villa/[destination]/[slug] — villa detail. The 114 featured villas
// are prebuilt at deploy; the other ~3,800 render on demand and stick around
// via ISR until the next deploy (the dataset only changes when the source JSON
// is re-uploaded, and re-uploading it IS a deploy). All data resolves
// server-side from lib/villas — the client receives finished HTML, never the
// dataset.

import Link from "next/link";
import { notFound } from "next/navigation";
import { IBM_Plex_Mono } from "next/font/google";
import { SITE_URL } from "@/lib/answers";
import { getVillaBySlug, featuredVillaParams } from "@/lib/villas.js";
import { villaJsonLd, villaBreadcrumbJsonLd } from "@/lib/seo/villas";
import SiteFooter from "@/components/SiteFooter";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

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
  return featuredVillaParams();
}

export async function generateMetadata({ params }) {
  const { destination, slug } = await params;
  const v = getVillaBySlug(destination, slug);
  if (!v) return {};
  const where = [v.location, v.destination].filter(Boolean).join(", ");
  return {
    title: `${v.name} · Villa Atlas`,
    description: v.summary || `${v.name}, a private villa in ${where}.`,
    alternates: {
      canonical: `${SITE_URL}/atlas/villa/${v.destinationSlug}/${v.slug}`,
    },
    /*
     * Noindex, follow — 3,902 pages taken out of the index deliberately.
     *
     * These are generated from one feed through one template: the same stat
     * row, the same two ask-The-Guide links, the same footer, and a summary
     * that is the supplier's own copy where there is one at all. At this volume
     * that is a thin-content pattern, and a crawler that meets 3,902 of them
     * spends its budget there rather than on the pages worth ranking. The
     * destination hubs at /villas/<destination> are those pages: they carry the
     * same inventory as text, grouped, in numbers a crawler can read.
     *
     * `follow` keeps every outbound link live, so nothing this page points at
     * is orphaned by the directive. The self-canonical above is left in place
     * on purpose — noindex takes precedence over it, and if these pages are
     * ever admitted back to the index the correct canonical is already there
     * rather than something to remember to re-add.
     *
     * The pages themselves stay: they are live URLs, linked from the hubs and
     * from The Guide's answers, and a traveller following one still lands on a
     * real page. This changes what search does with them, not whether they
     * exist. The sitemap drops them for the same reason — see app/sitemap.js.
     */
    robots: { index: false, follow: true },
    openGraph: {
      title: v.name,
      description: v.summary || `${v.name}, a private villa in ${where}.`,
      type: "website",
      url: `${SITE_URL}/atlas/villa/${v.destinationSlug}/${v.slug}`,
      images: v.imageUrl ? [v.imageUrl] : undefined,
    },
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
  // The supplier's bookable bedroom counts, which are not always the villa's
  // size: 698 villas rent a menu of counts, and 45 rent a count the `bedrooms`
  // field does not list at all. The detail page has room to say it exactly.
  const options = v.bedroomOptions && v.bedroomOptions.length ? v.bedroomOptions : [];
  const bedroomStat = options.length
    ? options.length === 1
      ? `${options[0]} bedrooms`
      : `${options[0]}–${options[options.length - 1]} bedrooms`
    : v.bedrooms
      ? `${v.bedrooms} bedrooms`
      : null;
  const bedroomOptionsNote =
    options.length > 1
      ? `Bookable as ${options.slice(0, -1).join(", ")} or ${options[options.length - 1]} bedrooms.`
      : null;
  const stats = [
    v.sleeps != null ? `Sleeps ${v.sleeps}` : "Capacity on request",
    bedroomStat,
    v.bathrooms ? `${v.bathrooms} bathrooms` : null,
  ].filter(Boolean);

  return (
    <div className={`villa-atlas villa-detail ${mono.variable}`}>
      {/* The first structured data these pages have ever carried. A villa page
          knows the name, the place, the coordinate (where it is the villa's
          own), the sleeps and the bedroom count, and published none of it in a
          form a machine reads. See lib/seo/villas.js for what is deliberately
          left out — the "from" rate, and the geo of the 236 villas placed on a
          locality centroid. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(villaJsonLd(v)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(villaBreadcrumbJsonLd(v)) }}
      />
      <nav className="villa-crumbs mono">
        <Link href="/villas">Villas</Link>
        {" / "}
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
        {bedroomOptionsNote && <p className="villa-detail-note">{bedroomOptionsNote}</p>}
        {v.nightlyFromUsd == null && (
          <p className="villa-detail-cfp">
            Pricing for this villa is on request. Your advisor confirms the rate for your
            dates and party.
          </p>
        )}
        {!v.exactLocation && (
          <p className="villa-detail-note">
            Location is approximate: this villa is placed at the centre of{" "}
            {v.location || v.destination} rather than its own address, which the supplier does
            not publish. Your advisor confirms exactly where it sits.
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
      <SiteFooter />
    </div>
  );
}

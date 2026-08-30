import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import AdvisorRequest from "@/components/AdvisorRequest";
import IntroTour from "@/components/IntroTour";
import SiteNav from "@/components/SiteNav";
import { MAPBOX_JS, MAPBOX_CSS } from "@/lib/mapbox-cdn";
import { SITE_URL } from "@/lib/answers";
import { siteGraphJsonLd } from "@/lib/seo/site";
import "./globals.css";

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});

const sans = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  // Imported, not retyped. The sitemap, robots.txt, the JSON-LD on every
  // answer page and the line in the header below all resolve to this same
  // constant — see SITE_URL. A second literal here is how the header came to
  // advertise an address the canonical URLs disagreed with.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Expedition Bucket List · The Guide — Aspen Travel Advisors",
    template: "%s — Aspen Travel Advisors",
  },
  description:
    "Expedition Bucket List — Aspen Travel Advisors' AI travel concierge. Approved luxury hotels, expedition cruises, private jet journeys and luxury hotel yachts — framed, mapped and booked by The Guide.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        {/* Mapbox boots from a client component, so without hints the browser
            only discovers mapbox-gl.js after the app chunks execute (~1.6s of
            dead air on mobile). React hoists these into <head>: the script and
            stylesheet download in parallel with the Next chunks, and the
            crossorigin preconnect warms the socket the style/tile fetches use.
            URLs come from lib/mapbox-cdn.ts — keep loader and hints in sync. */}
        <link rel="preconnect" href="https://api.mapbox.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.mapbox.com" />
        <link rel="preload" as="script" href={MAPBOX_JS} />
        <link rel="preload" as="style" href={MAPBOX_CSS} />
        {/* The publisher, defined once for the whole site. Every other JSON-LD
            block — answers, hotel pages, destination hubs — references this
            node by @id rather than describing the agency again, so an engine
            reading any two pages knows they have the same author. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteGraphJsonLd()) }}
        />
        <div className="app">
          {/* Three proper nouns, and no more: Expedition Bucket List (the
              product), Aspen Travel Advisors (the agency standing behind it),
              The Guide (the concierge). A name earns capitals when it names an
              actor with a job — "The Guide" tells you to talk to it in
              sentences. The old "Base Camp" and "Living Atlas" named things the
              visitor was already looking at (an app, a map), so they cost a
              decode step and returned nothing. The map is now "the atlas",
              lowercase, everywhere. */}
          <header className="site">
            {/* One destination. The mark and the wordmark are the BRAND and go
                out to expeditionbucketlist.com — the visitor who clicks a brand
                expects the brand.

                A second line used to sit under the wordmark carrying this app's
                own address as a link home. It is gone: the app now lives at a
                subdomain of the brand it was spelling out, so the line said the
                brand's name twice, once in a serif wordmark and once in 9.5px
                uppercase tracking. The wrapper below stays as the header's
                layout hook. */}
            <div className="brand">
              <a
                className="brand-face"
                href="https://expeditionbucketlist.com"
                target="_blank"
                rel="noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="brand-logo"
                  src="/aspen-advisors-mark.png"
                  srcSet="/aspen-advisors-mark.png 1x, /aspen-advisors-mark@2x.png 2x"
                  alt="Aspen Travel Advisors"
                  width={40}
                  height={40}
                />
                <span className="mark">
                  Expedition <b>Bucket List</b>
                </span>
              </a>
            </div>
            <span className="tag">
              Private travel, powered by{" "}
              <a
                 className="byline"
                href="https://www.virtuoso.com/advisor/brianharris/travel"
                target="_blank"
                rel="noreferrer"
              >
                Virtuoso®
              </a>{" "}
              · Arranged by{" "}
              <a
              className="byline"
                href="https://aspentraveladvisors.com"
                target="_blank"
                rel="noreferrer"
              >
                Aspen Travel Advisors
              </a>
            </span>
            <SiteNav />
          </header>
          <main className="page">{children}</main>
          {/* Mounted app-wide so the route to a human is available from every
              page, including ones with no chat on them. */}
          <AdvisorRequest />
          <IntroTour />
        </div>
        <Analytics />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import AdvisorRequest from "@/components/AdvisorRequest";
import IntroTour from "@/components/IntroTour";
import SiteNav from "@/components/SiteNav";
import { MAPBOX_JS, MAPBOX_CSS } from "@/lib/mapbox-cdn";
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
  metadataBase: new URL("https://basecamp.aspentraveladvisors.com"),
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
            {/* Two destinations stacked, because they are two different places:
                the mark and the wordmark are the BRAND and still go out to
                expeditionbucketlist.com, while the line under them is the
                address of this app and goes to its home. Keeping the wordmark's
                external link is the point — the visitor who clicks a brand
                expects the brand, and the app's own URL is the thing that
                should bring them back here. */}
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
              <Link className="brand-url" href="/">
                TheTravelGuideAi.com
              </Link>
            </div>
            <span className="tag">
              Private travel, arranged by{" "}
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

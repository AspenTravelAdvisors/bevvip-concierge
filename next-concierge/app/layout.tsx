import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import IntroTour from "@/components/IntroTour";
import NavTabs from "@/components/NavTabs";
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
    default: "Base Camp · The Guide — Aspen Travel Advisors",
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
          <header className="site">
            <a
              className="mark"
              href="https://expeditionbucketlist.com"
              target="_blank"
              rel="noreferrer"
            >
              Expedition <b>Bucket List</b>
            </a>
            <span className="tag">
              Base Camp · The Guide · By{" "}
              <a
                className="byline"
                href="https://aspentraveladvisors.com"
                target="_blank"
                rel="noreferrer"
              >
                Aspen Travel Advisors
              </a>
            </span>
            <NavTabs />
          </header>
          <main className="page">{children}</main>
          <IntroTour />
        </div>
      </body>
    </html>
  );
}

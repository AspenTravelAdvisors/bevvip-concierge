import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import IntroTour from "@/components/IntroTour";
import NavTabs from "@/components/NavTabs";
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

import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Cormorant_Garamond, Inter } from "next/font/google";
import IntroTour from "@/components/IntroTour";
import GuideTab from "@/components/GuideTab";
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
            <nav>
              <GuideTab />
              <Link className="tab-color" style={{ "--tab": "#e6d488" } as React.CSSProperties} href="/atlas/hotel">Hotels</Link>
              <Link className="tab-color" style={{ "--tab": "#5aa9e6" } as React.CSSProperties} href="/atlas/cruise">Expeditions</Link>
              <Link className="tab-color" style={{ "--tab": "#dfe5f2" } as React.CSSProperties} href="/atlas/jet">Jets</Link>
              <Link className="tab-color" style={{ "--tab": "#e0b84a" } as React.CSSProperties} href="/atlas/yacht">Yachts</Link>
              <Link className="tab-color" style={{ "--tab": "#45d6c2" } as React.CSSProperties} href="/atlas/worldcruise">World</Link>
              <Link className="tab-color" style={{ "--tab": "#e08d5f" } as React.CSSProperties} href="/atlas/train">Rails</Link>
            </nav>
          </header>
          <main className="page">{children}</main>
          <IntroTour />
        </div>
      </body>
    </html>
  );
}

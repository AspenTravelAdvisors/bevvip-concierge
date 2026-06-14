import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import Link from "next/link";
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
    "BeVvip's AI travel concierge. Approved luxury hotels, expedition cruises, private jet journeys and hotel-brand yachts — framed, mapped and booked by The Guide.",
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
            <span className="mark">
              Be<b>Vvip</b>
            </span>
            <span className="tag">Base Camp · The Guide</span>
            <nav>
              <Link href="/">The Guide</Link>
              <Link href="/atlas/hotel">Hotels</Link>
              <Link href="/atlas/cruise">Cruises</Link>
              <Link href="/atlas/jet">Jets</Link>
              <Link href="/atlas/yacht">Yachts</Link>
              <Link href="/atlas/worldcruise">World</Link>
            </nav>
          </header>
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}

// The footer — a server-rendered set of links, which the site did not have.
//
// Worth stating plainly, because it looks like decoration and is not: every
// path into the inventory ran through SiteNav's Explore menu, which renders its
// links only after a click. A crawler (or an answer engine, or a visitor with
// JS still loading) arriving on the home page found "The Guide", "Answers",
// "How this works" and a map canvas. The 2,240 property pages, the seven
// atlases and the country hubs were reachable only from the sitemap, and a URL
// that nothing links to is a URL search treats as an orphan.
//
// So these are the same destinations the menu offers, in plain HTML, at the
// foot of every document route. NOT in the root layout: `.app` is pinned to
// 100dvh and never scrolls, because the atlas fills the stage edge to edge —
// a footer there would take a strip off the map on every page. It goes inside
// the surfaces that scroll, which are exactly the surfaces a crawler reads.

import Link from "next/link";
import { COLLECTIONS } from "@/lib/atlas-config";
import { AGENCY_NAME, AGENCY_URL, VIRTUOSO_ADVISOR_URL } from "@/lib/seo/site";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Site">
        <Link href="/">The Guide</Link>
        <Link href="/answers">Answers</Link>
        <Link href="/hotels">Hotels A–Z</Link>
        {COLLECTIONS.map((c) => (
          <Link key={c.type} href={`/atlas/${c.type}`}>
            {c.nav}
          </Link>
        ))}
      </nav>
      <p>
        Property, journey and benefit facts are synced from the Virtuoso Partner API;
        curation and advisor access are {AGENCY_NAME}&apos;s own. We hold no rates and
        no live availability — those come from an advisor.{" "}
        <a href={AGENCY_URL} target="_blank" rel="noreferrer">
          {AGENCY_NAME}
        </a>{" "}
        ·{" "}
        <a href={VIRTUOSO_ADVISOR_URL} target="_blank" rel="noreferrer">
          Virtuoso profile
        </a>
      </p>
    </footer>
  );
}

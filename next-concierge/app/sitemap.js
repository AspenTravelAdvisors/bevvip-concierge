// sitemap.xml — the discovery surface for crawlers.
//
// It used to list 147 URLs while the atlas held 11,102 stays and journeys,
// because there were no pages to list. There are now, for all of them: every
// property, every itinerary, every villa, and a hub above each. Answer pages
// carry their content's last-verified date.
//
// Villas are the exception, and the reason is worth stating because this file
// once went the other way. 3,902 villa detail pages existed with 114 of them
// listed here and nothing linking to the rest; the fix was hubs at /villas and
// /villas/<destination>, which is what a crawler is now pointed at. The detail
// pages under /atlas/villa are noindex, follow and are NOT listed — they are
// one template over one feed, 3,902 times, and the hubs above them say the same
// thing in text. Reachable, crawled, followed, deliberately not submitted.

import { ALL_ANSWERS, SITE_URL } from "@/lib/answers";
import { hotelSitemapEntries } from "@/lib/seo/hotels";
import { journeySitemapEntries } from "@/lib/seo/journeys";
import { villaSitemapEntries } from "@/lib/seo/villas";

export default function sitemap() {
  const now = new Date();

  // The eight /atlas/<type> shells used to be listed here, derived from
  // COLLECTIONS. They are gone, along with the 3,902 /atlas/villa/<destination>
  // /<slug> detail pages that villaSitemapEntries() used to append — all of it
  // now carries `robots: { index: false, follow: true }` at the page, and a
  // sitemap entry for a noindexed URL is a request to index a page that answers
  // "no". The pages are still crawled and still link onward; what a crawler is
  // being pointed AT is the hub tree that says the same things in readable
  // text. See the note in app/atlas/[type]/page.tsx.
  const core = [
    { url: `${SITE_URL}/`, lastModified: now, priority: 1 },
    { url: `${SITE_URL}/answers`, lastModified: now, priority: 0.9 },
  ];

  const answers = ALL_ANSWERS.map((a) => ({
    url: `${SITE_URL}/answers/${a.slug}`,
    lastModified: new Date(a.updated),
    priority: 0.9,
  }));

  // Every property, itinerary and villa, plus the hubs above them.
  // lastModified is the build, which is the honest answer: these pages are
  // rendered from the feed the nightly sync committed, so they are as fresh as
  // the deploy that carried it.
  // Each entry function owns its whole tree INCLUDING its root hub. Listing
  // /hotels, /villas and /journeys in `core` as well is how /villas and
  // /journeys shipped twice in one sitemap.
  const entities = [
    ...hotelSitemapEntries(),
    ...journeySitemapEntries(),
    ...villaSitemapEntries(),
  ].map((e) => ({ ...e, lastModified: now }));

  return [...core, ...answers, ...entities];
}

// sitemap.xml — the discovery surface for crawlers.
//
// It used to list 147 URLs while the atlas held 11,102 stays and journeys,
// because there were no pages to list. There are now, for all of them: every
// property, every itinerary, every villa, and a hub above each. Answer pages
// carry their content's last-verified date.
//
// The villa half is the correction worth noting: 3,902 villa detail pages have
// existed since the villa atlas shipped and only the 114 featured ones were
// ever listed here. The other 3,788 were rendered, reachable by URL, and
// invisible.

import { ALL_ANSWERS, SITE_URL } from "@/lib/answers";
import { COLLECTIONS } from "@/lib/atlas-config";
import { hotelSitemapEntries } from "@/lib/seo/hotels";
import { journeySitemapEntries } from "@/lib/seo/journeys";
import { villaSitemapEntries } from "@/lib/seo/villas";

export default function sitemap() {
  const now = new Date();

  const core = [
    { url: `${SITE_URL}/`, lastModified: now, priority: 1 },
    { url: `${SITE_URL}/answers`, lastModified: now, priority: 0.9 },
    // Derived from the registry, not typed. The hand-kept list this replaces
    // named seven collections and the atlas ships eight — safari shipped after
    // it was written and was never added, so the one atlas whose inventory was
    // actively growing was the one not being listed. That is the same failure
    // audit-listings.mjs documents in its own SHIPPED table.
    ...COLLECTIONS.map((c) => ({
      url: `${SITE_URL}/atlas/${c.type}`,
      lastModified: now,
      priority: 0.8,
    })),
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

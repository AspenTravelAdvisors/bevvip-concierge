// sitemap.xml — the discovery surface for crawlers.
//
// It used to list 147 URLs while the atlas held 2,240 hotels, because there
// were no hotel pages to list. There are now: every property has one, every
// country has a hub, and both are here. Answer pages carry their content's
// last-verified date; featured villa details round it out.

import { ALL_ANSWERS, SITE_URL } from "@/lib/answers";
import { featuredVillaParams } from "@/lib/villas.js";
import { hotelSitemapEntries } from "@/lib/seo/hotels";

export default function sitemap() {
  const now = new Date();

  const core = [
    { url: `${SITE_URL}/`, lastModified: now, priority: 1 },
    { url: `${SITE_URL}/answers`, lastModified: now, priority: 0.9 },
    { url: `${SITE_URL}/hotels`, lastModified: now, priority: 0.9 },
    ...["hotel", "cruise", "jet", "yacht", "worldcruise", "train", "villa"].map(
      (t) => ({
        url: `${SITE_URL}/atlas/${t}`,
        lastModified: now,
        priority: 0.8,
      }),
    ),
  ];

  const answers = ALL_ANSWERS.map((a) => ({
    url: `${SITE_URL}/answers/${a.slug}`,
    lastModified: new Date(a.updated),
    priority: 0.9,
  }));

  // Every property and every country hub. lastModified is the build, which is
  // the honest answer: these pages are rendered from the feed the nightly sync
  // committed, so they are as fresh as the deploy that carried it.
  const hotels = hotelSitemapEntries().map((e) => ({ ...e, lastModified: now }));

  const villas = featuredVillaParams().map(({ destination, slug }) => ({
    url: `${SITE_URL}/atlas/villa/${destination}/${slug}`,
    lastModified: now,
    priority: 0.5,
  }));

  return [...core, ...answers, ...hotels, ...villas];
}

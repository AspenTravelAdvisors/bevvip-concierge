// sitemap.xml — the discovery surface for crawlers. Answer pages carry their
// content's last-verified date; atlas surfaces and featured villa details
// round out the crawlable site.

import { ALL_ANSWERS, SITE_URL } from "@/lib/answers";
import { featuredVillaParams } from "@/lib/villas.js";

export default function sitemap() {
  const now = new Date();

  const core = [
    { url: `${SITE_URL}/`, lastModified: now, priority: 1 },
    { url: `${SITE_URL}/answers`, lastModified: now, priority: 0.9 },
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

  const villas = featuredVillaParams().map(({ destination, slug }) => ({
    url: `${SITE_URL}/atlas/villa/${destination}/${slug}`,
    lastModified: now,
    priority: 0.5,
  }));

  return [...core, ...answers, ...villas];
}

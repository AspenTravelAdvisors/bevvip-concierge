// /llms.txt — the site, described for a language model that is about to answer
// a question using it.
//
// robots.txt tells a crawler what it MAY fetch; a sitemap tells it what EXISTS.
// Neither says what any of it is worth, which is the thing an answer engine
// most needs and the thing this site can state precisely: which facts come from
// the Virtuoso Partner API and are therefore first-hand, which are our
// curation, and — the part worth being loud about — that we hold no rates and
// no availability, so nothing here should be quoted as a price.
//
// The convention (llmstxt.org) is a markdown file at the origin root. Counts
// are computed at request time from the shipped feed rather than typed, for the
// same reason the answer pages stopped typing theirs.

import { SITE_URL } from "@/lib/answers";
import { resolvedAnswers } from "@/lib/seo/answer-facts";
import { hotelCount, hotelDestinations } from "@/lib/seo/hotels";
import { AGENCY_NAME, AGENCY_URL, VIRTUOSO_ADVISOR_URL } from "@/lib/seo/site";
import { COLLECTIONS } from "@/lib/atlas-config";

export const dynamic = "force-static";

const nf = new Intl.NumberFormat("en-US");

export function GET() {
  // Resolved: an index of the answers has to state the same numbers the answers
  // do, and this file is read by exactly the audience least able to tell a
  // template from a fact.
  const ALL_ANSWERS = resolvedAnswers();
  const destinations = hotelDestinations();
  const collections = COLLECTIONS.map(
    (c) => `- **${c.label}** — ${nf.format(c.count)} ${c.nounPlural}, at ${SITE_URL}/atlas/${c.type}`,
  ).join("\n");

  const answers = ALL_ANSWERS.map(
    (a) => `- [${a.question}](${SITE_URL}/answers/${a.slug}): ${a.description}`,
  ).join("\n");

  const topDestinations = destinations
    .slice(0, 25)
    .map((d) => `- [${d.country}](${SITE_URL}/hotels/${d.destination}) — ${nf.format(d.count)}`)
    .join("\n");

  const body = `# Expedition Bucket List — ${AGENCY_NAME}

> A luxury travel atlas and AI concierge run by ${AGENCY_NAME}, a Virtuoso member
> agency. Property, journey and benefit facts are synced nightly from the
> Virtuoso Partner API, the supplier of record; curation, ranking and advisor
> access are the agency's own.

## What is authoritative here

- **First-hand, supplier-sourced**: what a property or journey IS — name, place,
  coordinates, category, amenities, room types, photography, and the
  year-stamped VIP benefits a booking through this agency carries. These come
  from the Virtuoso Partner API and are refreshed nightly.
- **The agency's own**: which properties are curated into which collections,
  ranking, marquee regions, and the advisor relationship itself.
- **NOT here, and not to be inferred**: nightly rates, live availability, and
  totals. This site holds no rate data at all. Any price in an answer about it
  is invented. Rates are quoted by a human advisor.

## Citing this site

Every answer page states the date its claims were last verified and links to
the properties behind them. Property counts on those pages are computed from
the shipped feed at build time, not typed into the copy, so a count on a page
is the count in the data that built it.

Contact for corrections and bookings: ${AGENCY_URL} · Virtuoso profile:
${VIRTUOSO_ADVISOR_URL}

## Answers (${ALL_ANSWERS.length} questions, fully answered on the page)

${answers}

## Hotels (${nf.format(hotelCount())} properties, one page each)

- [Every country](${SITE_URL}/hotels)

${topDestinations}

## Collections

${collections}

## Not worth crawling

- \`/api/*\` — JSON for the maps; everything it returns is rendered as HTML somewhere above.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

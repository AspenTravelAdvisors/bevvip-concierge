// Registry for the /answers question pages. Server-only: imported by the
// answers routes, sitemap and robots — never from a "use client" file.

import { expeditionAnswers } from "@/data/answers/expedition";
import { hotelAnswers } from "@/data/answers/hotels";
import { villaAnswers } from "@/data/answers/villas";
import { journeyAnswers } from "@/data/answers/journeys";

/**
 * Canonical origin for absolute URLs in metadata, sitemap, robots and JSON-LD.
 *
 * THE one place the app's own address is written down. It used to be written
 * twice — here and as `metadataBase` in app/layout.tsx — which is how the
 * header ended up advertising "TheTravelGuideAi.com" while the canonical URLs
 * pointed somewhere else entirely: three spellings of one address, none of
 * them checked against the others. layout.tsx now imports this.
 *
 * Naming note: this is the ADDRESS, not the brand. The wordmark above it still
 * reads "Expedition Bucket List" and still links to expeditionbucketlist.com —
 * a visitor who clicks a brand expects the brand. Only the line underneath,
 * which is this app's own front door, changed.
 */
export const SITE_URL = "https://theaitravelguide.com";

/**
 * The same address, cased for a human to read: "TheAiTravelGuide.com".
 *
 * Domains are case-insensitive and an all-lowercase run of nineteen letters is
 * not — "theaitravelguide.com" makes a reader parse "thea", "itravel". The
 * capitals are word boundaries, and they are the whole reason this is a
 * separate constant rather than `new URL(SITE_URL).host`.
 *
 * The assertion below is what keeps it a display variant rather than a second
 * source of truth: change one and the build fails until you change the other.
 * That is not hypothetical here — the header used to read "TheTravelGuideAi",
 * the right words in the wrong order, and nothing anywhere noticed.
 */
export const SITE_LABEL = "TheAiTravelGuide.com";

if (SITE_LABEL.toLowerCase() !== new URL(SITE_URL).host.toLowerCase()) {
  throw new Error(
    `SITE_LABEL (${SITE_LABEL}) and SITE_URL (${SITE_URL}) name different addresses`,
  );
}

export const ALL_ANSWERS = [
  ...expeditionAnswers,
  ...hotelAnswers,
  ...villaAnswers,
  ...journeyAnswers,
];

const BY_SLUG = new Map(ALL_ANSWERS.map((a) => [a.slug, a]));

export function getAnswer(slug) {
  return BY_SLUG.get(slug) || null;
}

export function answerParams() {
  return ALL_ANSWERS.map((a) => ({ slug: a.slug }));
}

// Category display order for the index page.
export const CATEGORY_ORDER = ["Expedition", "Hotels", "Villas", "Voyages", "Rails", "Yachts", "Planning"];

export function answersByCategory() {
  const groups = new Map();
  for (const a of ALL_ANSWERS) {
    if (!groups.has(a.category)) groups.set(a.category, []);
    groups.get(a.category).push(a);
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => ({
    category: c,
    answers: groups.get(c),
  }));
}

// FAQPage JSON-LD: the page's own question (answered by the lead paragraphs)
// plus its FAQ items — the shape answer engines lift citations from.
export function faqJsonLd(a) {
  const main = [
    {
      "@type": "Question",
      name: a.question,
      acceptedAnswer: { "@type": "Answer", text: a.answer.join(" ") },
    },
    ...a.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: main,
    url: `${SITE_URL}/answers/${a.slug}`,
    dateModified: a.updated,
    publisher: {
      "@type": "Organization",
      name: "Aspen Travel Advisors",
      url: "https://aspentraveladvisors.com",
    },
  };
}

export function breadcrumbJsonLd(a) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Expedition Bucket List", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Answers", item: `${SITE_URL}/answers` },
      { "@type": "ListItem", position: 3, name: a.question, item: `${SITE_URL}/answers/${a.slug}` },
    ],
  };
}

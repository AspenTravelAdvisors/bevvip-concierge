// Registry for the /answers question pages. Server-only: imported by the
// answers routes, sitemap and robots — never from a "use client" file.

import { expeditionAnswers } from "@/data/answers/expedition";
import { hotelAnswers } from "@/data/answers/hotels";
import { villaAnswers } from "@/data/answers/villas";
import { journeyAnswers } from "@/data/answers/journeys";

// Canonical origin for absolute URLs in metadata, sitemap and JSON-LD.
export const SITE_URL = "https://basecamp.aspentraveladvisors.com";

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
      { "@type": "ListItem", position: 1, name: "Base Camp", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Answers", item: `${SITE_URL}/answers` },
      { "@type": "ListItem", position: 3, name: a.question, item: `${SITE_URL}/answers/${a.slug}` },
    ],
  };
}

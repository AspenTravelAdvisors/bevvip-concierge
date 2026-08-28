// The structured data an answer page emits.
//
// Moved out of lib/answers.js on purpose. That file is the registry, and it is
// imported by robots.js and sitemap.js, which must stay free of the atlas and
// of the identity graph. Schema that references the publisher belongs next to
// the publisher's definition.
//
// Four blocks per page now, where there were two:
//
//   FAQPage        the question and its FAQ items — unchanged in shape, but the
//                  publisher is now a reference to the one Organization node
//                  rather than a fourth inline description of the agency.
//   Article        who wrote it, when it was verified, and — via `speakable` —
//                  which parts of it answer the question out loud.
//   BreadcrumbList unchanged.
//   ItemList       the properties the answer's evidence table names, each
//                  linked to its own page. This is the block that did not exist
//                  before the Virtuoso sync, because there were no property
//                  pages to point at.

import { SITE_URL } from "@/lib/answers";
import { orgRef, SITE_ID } from "@/lib/seo/site";

const pageUrl = (a) => `${SITE_URL}/answers/${a.slug}`;

/**
 * The lead answer as one paragraph of plain text.
 *
 * `capsule` is the 40-60 word direct answer written for extraction; where an
 * answer has one, it is what the machine-readable `acceptedAnswer` says, and
 * the long-form lead follows it for a human. Where it does not, the lead is
 * used as before, so adding capsules is incremental rather than a migration.
 */
export const acceptedAnswerText = (a) =>
  a.capsule ? `${a.capsule} ${a.answer.join(" ")}` : a.answer.join(" ");

export function faqJsonLd(a) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${pageUrl(a)}#faq`,
    url: pageUrl(a),
    dateModified: a.updated,
    isPartOf: { "@id": SITE_ID },
    publisher: orgRef(),
    mainEntity: [
      {
        "@type": "Question",
        name: a.question,
        acceptedAnswer: { "@type": "Answer", text: acceptedAnswerText(a) },
      },
      ...a.faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    ],
  };
}

/**
 * The page as an authored, dated article.
 *
 * FAQPage says what the answers are; it says nothing about who stands behind
 * them or when they were last checked — the two things that decide whether an
 * answer engine treats a page as citable. `speakable` names the two selectors
 * that hold the direct answer, which is also the honest summary of how the
 * page is built: capsule first, lead second.
 */
export function articleJsonLd(a) {
  const url = pageUrl(a);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    headline: a.title || a.question,
    description: a.description,
    url,
    mainEntityOfPage: url,
    inLanguage: "en",
    datePublished: a.updated,
    dateModified: a.updated,
    author: orgRef(),
    publisher: orgRef(),
    isPartOf: { "@id": SITE_ID },
    articleSection: a.category,
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: [".answers-capsule", ".answers-lead"],
    },
    // What the claims rest on, named rather than implied.
    citation: {
      "@type": "CreativeWork",
      name: "Virtuoso Partner API — hotel, cruise, tour and promotion feeds",
      publisher: { "@type": "Organization", name: "Virtuoso", url: "https://www.virtuoso.com" },
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
      { "@type": "ListItem", position: 3, name: a.question, item: pageUrl(a) },
    ],
  };
}

/** The evidence table as a list of real, resolvable hotel entities. */
export function evidenceJsonLd(a, evidence) {
  if (!evidence || !evidence.rows.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${pageUrl(a)}#evidence`,
    name: evidence.h2,
    numberOfItems: evidence.total,
    itemListElement: evidence.rows.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Hotel",
        "@id": `${SITE_URL}${r.href}#hotel`,
        name: r.name,
        url: `${SITE_URL}${r.href}`,
      },
    })),
  };
}

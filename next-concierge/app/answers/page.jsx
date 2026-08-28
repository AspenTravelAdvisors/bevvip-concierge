// /answers — index of every question page, grouped by category. Fully
// server-rendered: this page and its children are the crawlable, citable
// surface of the site, so no client JS is required to read any of it.

import Link from "next/link";
import { SITE_URL } from "@/lib/answers";
import { resolvedAnswers, resolvedAnswersByCategory } from "@/lib/seo/answer-facts";
import SiteFooter from "@/components/SiteFooter";

export const metadata = {
  title: "Answers — Straight Answers to the Questions Luxury Travelers Ask",
  description:
    "Direct, data-backed answers from Aspen Travel Advisors: expedition cruising, luxury hotel programs, villas, world cruises and more — grounded in the Expedition Bucket List atlas.",
  alternates: { canonical: `${SITE_URL}/answers` },
};

export default function AnswersIndex() {
  // Resolved, not raw: these descriptions carry the same {{…}} fact tokens the
  // pages do, and an unresolved token in a link summary is published text.
  const groups = resolvedAnswersByCategory();
  const ALL_ANSWERS = resolvedAnswers();
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Expedition Bucket List Answers",
    numberOfItems: ALL_ANSWERS.length,
    itemListElement: ALL_ANSWERS.map((a, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: a.question,
      url: `${SITE_URL}/answers/${a.slug}`,
    })),
  };

  return (
    <div className="answers-wrap">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
      />
      <header className="answers-head">
        <h1>Answers</h1>
        <p>
          The questions luxury travelers actually ask, answered directly and
          grounded in the Expedition Bucket List atlas — {""}
          <Link href="/atlas/hotel">2,382 vetted hotels</Link>,{" "}
          <Link href="/atlas/cruise">3,542 expedition sailings</Link>,{" "}
          <Link href="/atlas/villa">3,902 villas</Link>, plus world cruises,
          rails, jets and yachts. When you want the answer priced for your
          dates, <Link href="/">ask The Guide</Link>.
        </p>
      </header>

      {groups.map(({ category, answers }) => (
        <section key={category} className="answers-group">
          <h2>{category}</h2>
          <ul>
            {answers.map((a) => (
              <li key={a.slug}>
                <Link href={`/answers/${a.slug}`}>{a.question}</Link>
                <span className="answers-desc">{a.description}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <SiteFooter />
    </div>
  );
}

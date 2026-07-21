// /answers — index of every question page, grouped by category. Fully
// server-rendered: this page and its children are the crawlable, citable
// surface of Base Camp, so no client JS is required to read any of it.

import Link from "next/link";
import { ALL_ANSWERS, answersByCategory, SITE_URL } from "@/lib/answers";

export const metadata = {
  title: "Answers — Straight Answers to the Questions Luxury Travelers Ask",
  description:
    "Direct, data-backed answers from Aspen Travel Advisors: expedition cruising, luxury hotel programs, villas, world cruises and more — grounded in the Base Camp Living Atlas.",
  alternates: { canonical: `${SITE_URL}/answers` },
};

export default function AnswersIndex() {
  const groups = answersByCategory();
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Base Camp Answers",
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
          grounded in the Base Camp Living Atlas — {""}
          <Link href="/atlas/hotel">2,501 vetted hotels</Link>,{" "}
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
    </div>
  );
}

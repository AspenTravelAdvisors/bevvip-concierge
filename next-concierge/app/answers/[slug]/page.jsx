// /answers/[slug] — one question, answered. Statically generated for every
// registered answer; the full text (lead answer, sections, tables, FAQs) is
// server-rendered HTML with FAQPage + BreadcrumbList JSON-LD so answer
// engines can read and cite it without executing anything.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAnswer,
  answerParams,
  faqJsonLd,
  breadcrumbJsonLd,
  SITE_URL,
} from "@/lib/answers";

export const dynamicParams = false;

export function generateStaticParams() {
  return answerParams();
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const a = getAnswer(slug);
  if (!a) return {};
  return {
    title: a.title,
    description: a.description,
    alternates: { canonical: `${SITE_URL}/answers/${a.slug}` },
    openGraph: {
      title: a.question,
      description: a.description,
      type: "article",
      url: `${SITE_URL}/answers/${a.slug}`,
    },
  };
}

function AnswerTable({ table }) {
  return (
    <div className="answers-table-scroll">
      <table>
        {table.caption && <caption>{table.caption}</caption>}
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AnswerPage({ params }) {
  const { slug } = await params;
  const a = getAnswer(slug);
  if (!a) notFound();

  return (
    <article className="answers-wrap answers-article">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(a)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(a)) }}
      />

      <nav className="answers-crumbs">
        <Link href="/answers">Answers</Link>
        <span aria-hidden="true"> / </span>
        <span>{a.category}</span>
      </nav>

      <h1>{a.question}</h1>
      <p className="answers-updated">
        By Aspen Travel Advisors · Last verified{" "}
        <time dateTime={a.updated}>{a.updated}</time> · Grounded in the{" "}
        <Link href="/atlas/hotel">Base Camp Living Atlas</Link>
      </p>

      <div className="answers-lead">
        {a.answer.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {a.sections.map((s, i) => (
        <section key={i}>
          {s.h2 && <h2>{s.h2}</h2>}
          {s.table && <AnswerTable table={s.table} />}
          {(s.paras || []).map((p, j) => (
            <p key={j}>{p}</p>
          ))}
          {s.list && (
            <ul>
              {s.list.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="answers-faq">
        <h2>Frequently asked</h2>
        {a.faqs.map((f, i) => (
          <details key={i} open>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      <aside className="answers-related">
        <h2>Go deeper</h2>
        <ul>
          {a.related.map((r, i) => (
            <li key={i}>
              <Link href={r.href}>{r.label}</Link>
            </li>
          ))}
        </ul>
        <p className="answers-cta">
          Want this answered for your dates and budget?{" "}
          <Link href={`/?ask=${encodeURIComponent(a.question)}`}>
            Ask The Guide
          </Link>{" "}
          — Base Camp&apos;s concierge — or have our advisors price it with
          VIP benefits included.
        </p>
      </aside>
    </article>
  );
}

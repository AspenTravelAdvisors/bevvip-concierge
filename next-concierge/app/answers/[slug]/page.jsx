// /answers/[slug] — one question, answered. Statically generated for every
// registered answer; the full text (capsule, lead answer, sections, tables,
// live evidence, FAQs) is server-rendered HTML with FAQPage + Article +
// BreadcrumbList + ItemList JSON-LD so answer engines can read and cite it
// without executing anything.
//
// Two things changed when Virtuoso became the supplier of record:
//
//   1. The copy no longer hard-codes counts. `{{hotels:program=Marriott
//      STARS}}` is resolved from the shipped feed at render, so a sentence
//      cannot outlive the number in it.
//   2. An answer can carry an `evidence` query, and the page renders the actual
//      properties that satisfy it — named, linked to their own pages, and
//      counted. A claim about "the Preferred Partner properties" now arrives
//      with the properties.

import Link from "next/link";
import { notFound } from "next/navigation";
import { answerParams, SITE_URL } from "@/lib/answers";
import {
  faqJsonLd,
  articleJsonLd,
  breadcrumbJsonLd,
  evidenceJsonLd,
} from "@/lib/seo/answer-schema";
import { answerEvidence, resolvedAnswer } from "@/lib/seo/answer-facts";
import SiteFooter from "@/components/SiteFooter";

export const dynamicParams = false;

export function generateStaticParams() {
  return answerParams();
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const a = resolvedAnswer(slug);
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
      modifiedTime: a.updated,
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

/**
 * The properties behind the claim.
 *
 * Deliberately a table of entities rather than prose: every row links to a page
 * that carries the supplier's own description, coordinates, benefit list and
 * live offers, which is what turns a general answer into one an engine can
 * follow to a specific, checkable fact.
 */
function Evidence({ evidence }) {
  return (
    <section className="answers-evidence">
      <h2>{evidence.h2}</h2>
      {evidence.note && <p>{evidence.note}</p>}
      <div className="answers-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Where</th>
              <th>Rooms</th>
              <th>Benefits listed</th>
            </tr>
          </thead>
          <tbody>
            {evidence.rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <Link href={r.href}>{r.name}</Link>
                </th>
                <td>{r.where}</td>
                <td>{r.rooms ?? "—"}</td>
                <td>{r.perks || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {evidence.total > evidence.shown && (
        <p className="answers-evidence-more">
          Showing {evidence.shown} of {evidence.total.toLocaleString("en-US")} matching
          properties in the atlas.
        </p>
      )}
    </section>
  );
}

export default async function AnswerPage({ params }) {
  const { slug } = await params;
  const a = resolvedAnswer(slug);
  if (!a) notFound();

  const evidence = answerEvidence(a);
  const evidenceLd = evidenceJsonLd(a, evidence);

  return (
    <article className="answers-wrap answers-article">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(a)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd(a)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(a)) }}
      />
      {evidenceLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(evidenceLd) }}
        />
      )}

      <nav className="answers-crumbs">
        <Link href="/answers">Answers</Link>
        <span aria-hidden="true"> / </span>
        <span>{a.category}</span>
      </nav>

      <h1>{a.question}</h1>
      <p className="answers-updated">
        By Aspen Travel Advisors · Last verified{" "}
        <time dateTime={a.updated}>{a.updated}</time> · Counts drawn live from the{" "}
        <Link href="/hotels">Virtuoso-sourced atlas</Link>
      </p>

      {/* The extractable answer: one paragraph, no preamble, no link needed to
          understand it. Marked with its own class because that selector is what
          the Article block's `speakable` names. */}
      {a.capsule && <p className="answers-capsule">{a.capsule}</p>}

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

      {evidence && evidence.rows.length > 0 && <Evidence evidence={evidence} />}

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
          — our AI concierge — or have our advisors price it with
          VIP benefits included.
        </p>
      </aside>
      <SiteFooter />
    </article>
  );
}

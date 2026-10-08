"use client";

// The advisor button on an answer page.
//
// Answer pages are where the AI assistants send people: ChatGPT cites one, the
// traveler clicks through, and lands on a page whose only advisor prompt used
// to be a sentence at the very bottom, with "have our advisors price it" not
// even a link. The header button exists, but a reader deep in an answer is not
// looking at the header. This puts the same dialog at the two places a reader
// decides: right after the short answer, and at the end.
//
// It opens the one shared dialog (components/AdvisorRequest.tsx) with source
// "answer", so the click and the request are counted apart from the header's,
// and the lead email names the page the traveler was reading.

import { openAdvisor, ADVISOR_CTA_COLD, ADVISOR_SLA } from "./AdvisorRequest";

export default function AnswerAdvisorCta({ lead }: { lead: string }) {
  return (
    <div className="answers-advisor">
      <p>{lead}</p>
      <button type="button" className="nav-cta" onClick={() => openAdvisor({ source: "answer" })}>
        {ADVISOR_CTA_COLD}
      </button>
      <span className="answers-advisor-sla">{ADVISOR_SLA}</span>
    </div>
  );
}

"use client";

// AdvisorRequest — the one place a traveler hands off to a human.
//
// This is the conversion event the whole product exists to produce, so there is
// exactly one implementation of it and exactly one label for it. It opens as a
// dialog from anywhere via:
//
//   window.dispatchEvent(new CustomEvent("bevvip:advisor-open", { detail }))
//
// Two things it does that the old inline version did not:
//   1. It is reachable cold, from the header, with no search behind it. The
//      previous form only rendered on chat turns that returned inventory, so a
//      visitor who arrived wanting a person had no route to one.
//   2. It shows the traveler the brief being sent. It's their own words, and
//      seeing them is what makes a contact form feel worth completing.

import { useCallback, useEffect, useRef, useState } from "react";
import type { GuideTurn } from "@/lib/types";
import {
  briefLines,
  buildAdvisorContext,
  HANDOFF_BLURB,
  type AdvisorContext,
} from "@/lib/handoff";
import { peekTurns } from "@/lib/conversation-store";
import { advisorRequestSent, advisorCtaClicked, type AdvisorSource } from "@/lib/analytics";

/** The single, never-varying label. Say it the same way every time. */
export const ADVISOR_CTA = "Send this to an advisor";
/** Cold version, where there is no "this" yet. */
export const ADVISOR_CTA_COLD = "Talk to an advisor";
/** The promise. Verified: every inquiry is answered within 24 hours. */
export const ADVISOR_SLA = "You'll hear back within 24 hours.";

export interface AdvisorOpenDetail {
  source: AdvisorSource;
  /** Supplied by the chat, which already has the turns in memory. */
  context?: AdvisorContext;
}

/** Open the advisor dialog from anywhere. */
export function openAdvisor(detail: AdvisorOpenDetail) {
  advisorCtaClicked(detail.context?.category ?? "generic", detail.source);
  window.dispatchEvent(new CustomEvent("bevvip:advisor-open", { detail }));
}

/** Build context from persisted turns — for entry points with no chat state. */
function contextFromStorage(): AdvisorContext {
  const turns: GuideTurn[] = peekTurns();
  return buildAdvisorContext(turns);
}

export default function AdvisorRequest() {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<AdvisorSource>("header");
  const [context, setContext] = useState<AdvisorContext | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const restoreFocusTo = useRef<Element | null>(null);

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<AdvisorOpenDetail>).detail;
      restoreFocusTo.current = document.activeElement;
      setSource(detail?.source ?? "header");
      setContext(detail?.context ?? contextFromStorage());
      setOpen(true);
    }
    window.addEventListener("bevvip:advisor-open", onOpen as EventListener);
    return () => window.removeEventListener("bevvip:advisor-open", onOpen as EventListener);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // Return focus where it came from — a dialog that strands the keyboard is
    // worse than no dialog.
    if (restoreFocusTo.current instanceof HTMLElement) restoreFocusTo.current.focus();
  }, []);

  // Esc closes; Tab is trapped inside the dialog while it's up.
  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'input, textarea, button, [href], select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open || !context) return null;

  return (
    <div className="adv-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="adv-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="adv-title"
        ref={dialogRef}
      >
        <AdvisorForm context={context} source={source} onClose={close} />
      </div>
    </div>
  );
}

function AdvisorForm({
  context,
  source,
  onClose,
}: {
  context: AdvisorContext;
  source: AdvisorSource;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"form" | "sending" | "done">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);

  const lines = briefLines(context.brief);
  const hasContext = lines.length > 0 || context.shortlist.length > 0;

  const submit = async () => {
    const cleanEmail = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      setError("Please enter a valid email so the specialist can reach you.");
      emailRef.current?.focus();
      return;
    }
    setPhase("sending");
    setError("");
    try {
      const res = await fetch("/api/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: context.category,
          action: ADVISOR_CTA,
          source,
          brief: context.brief,
          shortlist: context.shortlist,
          shortlistSource: context.shortlistSource,
          shortlistTotal: context.shortlistTotal,
          deepLink: context.deepLink,
          contact: { name: name.trim(), email: cleanEmail, phone: phone.trim() },
          notes: notes.trim(),
          transcript: context.transcript,
          pageUrl: typeof window !== "undefined" ? window.location.href : "",
        }),
      });
      if (!res.ok) {
        let msg = `Could not send (${res.status}).`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(msg);
      }
      advisorRequestSent(context.category, context.shortlist.length);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send. Please try again.");
      setPhase("form");
    }
  };

  if (phase === "done") {
    return (
      <>
        <div className="adv-head">
          <h2 id="adv-title">Sent</h2>
          <button type="button" className="adv-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="adv-done">
          An Aspen Travel Advisors specialist has your{" "}
          {context.shortlist.length === 0
            ? "notes"
            : context.shortlistSource === "bucket"
              ? "bucket list"
              : "shortlist"}{" "}
          and
          everything you described. They&rsquo;ll reach you at <b>{email.trim()}</b> within 24
          hours. Keep exploring in the meantime — anything else you find, you can send across the
          same way.
        </p>
        <div className="adv-actions">
          <button type="button" className="adv-submit" onClick={onClose}>
            Back to The Guide
          </button>
        </div>
      </>
    );
  }

  const sending = phase === "sending";

  return (
    <>
      <div className="adv-head">
        <h2 id="adv-title">{hasContext ? ADVISOR_CTA : ADVISOR_CTA_COLD}</h2>
        <button
          type="button"
          className="adv-close"
          aria-label="Close"
          disabled={sending}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <p className="adv-note">
        {HANDOFF_BLURB[context.category] ?? HANDOFF_BLURB.generic} <b>{ADVISOR_SLA}</b>
      </p>

      {/* Show the traveler exactly what goes with the message. The brief is
          assembled from their own words, and seeing it is what makes the form
          feel like a hand-off rather than a lead-capture toll gate. */}
      {hasContext && (
        <div className="adv-brief">
          <div className="adv-brief-cap">Going with your message</div>
          {lines.map(([label, value]) => (
            <div className="adv-brief-row" key={label}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
          {context.shortlist.length > 0 && (
            <div className="adv-brief-row">
              {/* Named for what it IS. A traveller who spent a week building a
                  bucket list should see their list going, not a generic
                  "Shortlist" that reads like something we assembled. */}
              <span>{context.shortlistSource === "bucket" ? "Your bucket list" : "Shortlist"}</span>
              <b>
                {context.shortlist.join(" · ")}
                {context.shortlistTotal > context.shortlist.length
                  ? ` — and ${context.shortlistTotal - context.shortlist.length} more`
                  : ""}
              </b>
            </div>
          )}
        </div>
      )}

      <input
        ref={emailRef}
        className="adv-field"
        type="email"
        inputMode="email"
        placeholder="Email"
        aria-label="Email"
        value={email}
        disabled={sending}
        onChange={(e) => {
          setEmail(e.target.value);
          if (error) setError("");
        }}
      />
      <div className="adv-row">
        <input
          className="adv-field"
          type="text"
          placeholder="Name"
          aria-label="Name"
          value={name}
          disabled={sending}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="adv-field"
          type="tel"
          inputMode="tel"
          placeholder="Phone (optional)"
          aria-label="Phone, optional"
          value={phone}
          disabled={sending}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <textarea
        className="adv-field adv-notes"
        rows={2}
        placeholder={
          hasContext
            ? "Anything else the advisor should know? (optional)"
            : "What are you thinking about? A region, a season, an occasion…"
        }
        aria-label="Notes for the advisor"
        value={notes}
        disabled={sending}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && (
        <div className="adv-error" role="alert">
          {error}
        </div>
      )}

      <div className="adv-actions">
        <button type="button" className="adv-submit" disabled={sending} onClick={submit}>
          {sending ? "Sending…" : "Send"}
        </button>
        <button type="button" className="adv-cancel" disabled={sending} onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}

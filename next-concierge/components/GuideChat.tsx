"use client";

// The Guide — streaming chat client. Consumes the /api/guide SSE stream
// (status → delta* → meta → done) and renders the reply as it types, with
// inventory result cards and an "Open in Atlas" handoff from the meta frame.

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, GuideFrame, GuideMeta, GuideTurn, TripState } from "@/lib/types";
import { clearTrip, getTrip, onTrip, setTrip } from "@/lib/trip-state";
import {
  buildAdvisorContext,
  hasBrief,
  shortlistNames,
  stripControlTags,
} from "@/lib/handoff";
import {
  clearConversation,
  describeAge,
  loadConversation,
  saveConversation,
} from "@/lib/conversation-store";
import { askSent, resultsReturned, tourOpened, type AskSource } from "@/lib/analytics";
import { collectionsSummary } from "@/lib/atlas-config";
import { registerGuideHost } from "@/lib/atlas/ask";
import { openAdvisor, ADVISOR_CTA, ADVISOR_SLA } from "./AdvisorRequest";
import BookingStrip from "./BookingStrip";
import ResultCards from "./ResultCards";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "Mar 14–21" (same month) or "Mar 14 – Apr 2" for the folded trip chip.
function formatTripDates(checkIn: string | null, checkOut: string | null): string {
  const parse = (s: string | null) => {
    const m = String(s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? { mo: Number(m[2]) - 1, day: Number(m[3]) } : null;
  };
  const a = parse(checkIn);
  const b = parse(checkOut);
  if (a && b) {
    return a.mo === b.mo
      ? `${MONTHS_SHORT[a.mo]} ${a.day}–${b.day}`
      : `${MONTHS_SHORT[a.mo]} ${a.day} – ${MONTHS_SHORT[b.mo]} ${b.day}`;
  }
  if (a) return `${MONTHS_SHORT[a.mo]} ${a.day}`;
  return "";
}

// "Mar 14–21 · 2 adults · 2 kids" — the one-line trip summary on the chip.
function tripSummary(trip: TripState): string {
  const parts: string[] = [];
  const dates = formatTripDates(trip.checkIn, trip.checkOut);
  if (dates) parts.push(dates);
  else if (trip.destination) parts.push(trip.destination);
  parts.push(`${trip.adults} ${trip.adults === 1 ? "adult" : "adults"}`);
  if (trip.childrenAges.length) {
    parts.push(`${trip.childrenAges.length} ${trip.childrenAges.length === 1 ? "kid" : "kids"}`);
  }
  return parts.join(" · ");
}

// The seed prompts on the empty state.
//
// There were five, and they were written to demonstrate the engine's range —
// "Galápagos Expedition Cruise journeys in January", "What world Cruises call
// on Sydney, Australia in 2027". Those are impressive and they are also a
// specification: they teach the visitor that questions must be phrased with a
// category, a proper noun and a date, which is the opposite of the thing being
// sold. Three now, short, and deliberately vaguer than the search engine
// underneath — because the point is that vague is allowed.
export const GUIDE_CHIPS = [
  "Antarctica in January",
  "Somewhere warm in February",
  "Four Seasons in the Caribbean",
];

type Turn = GuideTurn;

// What the product contains, read from the one canonical list so the promise
// on the empty state can never drift from what the map actually plots. The old
// blurb named four collections; the nav offered seven.
const COLLECTION_SUMMARY = collectionsSummary();

export default function GuideChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Shared trip state (dates/party), kept live so the folded summary chip and
  // the booking CTAs react the moment the strip or the Guide captures dates.
  const [trip, setLocalTrip] = useState<TripState | null>(null);
  const [editingTrip, setEditingTrip] = useState(false);
  // The booking strip is no longer the front door — see the empty state below.
  const [datesOpen, setDatesOpen] = useState(false);
  // A conversation found in localStorage that's old enough to confirm before
  // restoring, rather than silently resurrecting it under the traveler.
  const [resume, setResume] = useState<{ turns: Turn[]; updatedAt: number } | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  // Session "generation": bumped by Start over so an in-flight stream from the
  // previous conversation can't write back into the freshly cleared transcript.
  const genRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Restore after mount (not during render) so server and first client paint
  // agree and React does not flag a hydration mismatch. A recent conversation
  // comes straight back; an older one is offered rather than imposed.
  useEffect(() => {
    const saved = loadConversation();
    if (saved) {
      if (saved.stale) setResume({ turns: saved.turns, updatedAt: saved.updatedAt });
      else setTurns(saved.turns);
    }
    setHydrated(true);
  }, []);

  // Mirror the shared trip store into local state (initial read + subscription)
  // so the summary chip and card CTAs re-render when where/when/who changes.
  useEffect(() => {
    setLocalTrip(getTrip());
    return onTrip(setLocalTrip);
  }, []);

  useEffect(() => {
    if (!hydrated) return; // don't clobber saved turns before the restore runs
    // An unanswered resume offer must not be overwritten by the empty transcript
    // sitting in front of it.
    if (resume && turns.length === 0) return;
    saveConversation(turns);
  }, [turns, hydrated, resume]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    // Empty state: keep the opening question pinned at the top. Once a
    // conversation exists, follow it to the newest reply.
    el.scrollTop = turns.length === 0 ? 0 : el.scrollHeight;
  }, [turns, status]);

  // Deep-link from an atlas card: ?ask=… opens The Guide already asking about
  // that specific sailing / expedition / jet / yacht. Fires once, after the
  // session restore, then strips ask/src from the URL so a refresh won't repeat.
  const askConsumed = useRef(false);
  useEffect(() => {
    if (!hydrated || askConsumed.current) return;
    let ask = "";
    try {
      ask = new URLSearchParams(window.location.search).get("ask") || "";
    } catch {
      /* no query / unavailable */
    }
    if (!ask.trim()) return;
    askConsumed.current = true;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("ask");
      url.searchParams.delete("src");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {
      /* leave the URL as-is */
    }
    send(ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // External surfaces (the mobile atlas dock's prompt chips, atlas pins) ask The
  // Guide by dispatching "bevvip:guide-ask" — routed through the same send
  // pipeline as typing. A ref keeps the listener stable while send closes over
  // fresh state.
  const sendRef = useRef<(text: string, source?: AskSource) => void>(() => {});
  sendRef.current = send;
  /*
   * Claim asks for this page.
   *
   * Any surface can now ask The Guide about a specific thing (lib/atlas/ask),
   * and the question is delivered in place wherever a chat is mounted — here.
   * Registering from the chat itself rather than from a particular dock is what
   * makes that true on the home globe as well as on the atlases: a pin's "Ask
   * The Guide" beside an already-open chat must not reload the page to reach it.
   */
  useEffect(() => registerGuideHost(), []);

  useEffect(() => {
    function onAsk(e: Event) {
      const detail = (e as CustomEvent<{ text?: string; source?: AskSource }>).detail;
      const text = detail?.text ?? "";
      if (text.trim()) sendRef.current(text, detail?.source ?? "dock");
    }
    window.addEventListener("bevvip:guide-ask", onAsk as EventListener);
    return () => window.removeEventListener("bevvip:guide-ask", onAsk as EventListener);
  }, []);

  async function send(text: string, source: AskSource = "composer") {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    askSent(source, turns.length === 0);
    // Tie this turn to the current session generation and a fresh abort
    // controller, so Start over can cancel it cleanly mid-stream.
    const gen = genRef.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setInput("");
    setBusy(true);
    setStatus("Reaching The Guide...");

    const history: ChatMessage[] = [
      ...turns.map(({ role, content }) => ({ role, content })),
      { role: "user", content: trimmed },
    ];
    setTurns((t) => [...t, { role: "user", content: trimmed }, { role: "assistant", content: "" }]);

    const patchReply = (fn: (turn: Turn) => Turn) =>
      setTurns((t) => {
        // The session was reset (or moved on) while this stream was open: drop
        // the write rather than mutate a cleared/foreign transcript.
        if (genRef.current !== gen || t.length === 0) return t;
        const next = [...t];
        next[next.length - 1] = fn(next[next.length - 1]);
        return next;
      });

    try {
      const res = await fetch("/api/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => "");
        throw new Error(err || `Guide unavailable (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() || "";
        for (const raw of frames) {
          const data = raw
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          const frame: GuideFrame = JSON.parse(data);
          if (frame.type === "status") setStatus(frame.text);
          if (frame.type === "delta") {
            setStatus(null);
            patchReply((turn) => ({ ...turn, content: turn.content + frame.text }));
          }
          if (frame.type === "meta") {
            const { type: _t, ...meta } = frame;
            patchReply((turn) => ({
              ...turn,
              meta,
              // The tool loop spent its whole budget without the model writing a
              // reply, so the transcript would otherwise end on an empty bubble
              // that reads as a hang. The server has always reported why on the
              // meta frame; nothing was reading it.
              content:
                meta.stopReason === "max_tool_rounds" && !turn.content.trim()
                  ? "That question reached further than I can search in one pass. Narrow it to a single destination, or one way of travelling, and I will go properly deep on it."
                  : turn.content,
            }));
            const lead = [...(meta.tools ?? [])]
              .reverse()
              .find((t) => (t.results ?? []).length > 0);
            resultsReturned(
              String(lead?.type ?? ""),
              (meta.tools ?? []).reduce((n, t) => n + (t.results?.length ?? 0), 0),
            );
            // Broadcast to the Living Atlas so it fits + satellites the results —
            // unless the session was reset out from under this stream.
            if (typeof window !== "undefined" && genRef.current === gen) {
              window.dispatchEvent(new CustomEvent("bevvip:atlas-plot", { detail: meta }));
              // Chat-first capture: dates/party the Guide extracted ride back on
              // the tool meta; persist them into the shared trip state the
              // booking CTAs (and the advisor brief) read.
              for (const tool of meta.tools ?? []) {
                if (tool.trip) setTrip(tool.trip, "guide");
              }
            }
          }
          if (frame.type === "error") throw new Error(frame.error);
        }
      }
    } catch (err) {
      // A Start over aborts the fetch on purpose — that's not an error to show.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const detail = err instanceof Error ? err.message : String(err);
        patchReply((turn) => ({
          ...turn,
          // A reply that died mid-stream used to be left exactly as it was: the
          // fallback only fired when NOTHING had arrived, so a stream that broke
          // after two of three recommendations read as a finished answer that
          // simply stopped. Mark where it ended instead of substituting for it,
          // so the part that did arrive stays useful.
          content: turn.content.trim()
            ? `${turn.content.trimEnd()}\n\nThat reply was cut off before I finished it (${detail}). Ask again and I will pick it back up.`
            : `I hit a snag reaching the inventory — ${detail}. Please try again.`,
        }));
      }
    } finally {
      // Only clear the busy/status if this is still the live turn; a reset (or a
      // newer send) already owns that state otherwise.
      if (genRef.current === gen) {
        setBusy(false);
        setStatus(null);
      }
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  // Stop the current reply and keep everything else. Previously the only way
  // out of a slow answer was Start over, which also wiped the transcript and
  // the captured trip — a destructive escape hatch for a non-destructive
  // problem. Aborting without bumping genRef lets the partial reply stand as
  // written, exactly as if the Guide had finished there.
  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStatus(null);
  }

  // Restart everything: end any in-flight stream, wipe the conversation and its
  // saved state, and tell the map to drop plotted results and return to its
  // resting state. The guide-session effect below then fires inactive (turns is
  // empty), so the mobile shell un-collapses back to the idle home.
  function startOver() {
    genRef.current += 1; // invalidate any open stream's writebacks
    abortRef.current?.abort();
    abortRef.current = null;
    setTurns([]);
    setInput("");
    setBusy(false);
    setStatus(null);
    setResume(null);
    clearConversation();
    clearTrip(); // trip state shares the conversation's lifetime
    setEditingTrip(false);
    setDatesOpen(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("bevvip:atlas-reset"));
    }
    transcriptRef.current?.scrollTo({ top: 0 });
  }

  // The first thing the traveler asked, as a one-line session summary for the
  // mobile session bar (e.g. "Four Seasons in the Caribbean").
  const firstAsk = turns.find((t) => t.role === "user")?.content.trim() ?? "";

  // Broadcast idle↔session transitions so the mobile shell can collapse the home
  // into the conversation view and demote the Living Atlas to a swipe-up peek.
  // Desktop/tablet ignore this — their side-by-side split is unchanged.
  useEffect(() => {
    if (!hydrated) return;
    window.dispatchEvent(
      new CustomEvent("bevvip:guide-session", {
        detail: { active: turns.length > 0, summary: firstAsk },
      }),
    );
  }, [hydrated, turns.length, firstAsk]);

  return (
    <section className="chat">
      {/* The session bar carried its own "↺ Start over" while an identical one
          sat in the composer toolbar — same glyph, same words, both on screen
          at once. The composer keeps it (it's where the traveler's hands are);
          this bar is now purely context. */}
      {turns.length > 0 && (
        <div className="guide-sessionbar">
          <button
            type="button"
            className="gsb-main"
            title="Back to the top of the conversation"
            onClick={() => transcriptRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <span className="gsb-av">G</span>
            <span className="gsb-meta">
              <span className="gsb-who">The Guide</span>
              {firstAsk && <span className="gsb-ctx">{firstAsk}</span>}
            </span>
          </button>
          {/* Reachable the moment there's anything worth handing over, rather
              than only on turns that happened to return inventory. */}
          {(hasBrief(turns) || turns.length >= 3) && (
            <button
              type="button"
              className="gsb-advisor"
              onClick={() => openAdvisor({ source: "chat", context: buildAdvisorContext(turns) })}
            >
              Talk to an advisor
            </button>
          )}
        </div>
      )}
      <div className="transcript" ref={transcriptRef}>
        {turns.length === 0 ? (
          /* The empty state used to stack five things: a headline, a paragraph,
             a "How The Guide works" disclosure, a full where/when/who search
             form with a "See VIP rates" button, an "or explore" divider, and
             five long example prompts — three different search paradigms
             competing in 400px, with the most search-engine-looking one
             (the date form) hard-framing a seven-collection concierge as a
             hotel booking box. One opening move now: say what you want. Dates
             are an optional refinement, behind a single line, where they
             belong. */
          <div className="empty">
            {resume ? (
              <div className="resume">
                <p>
                  You were planning a trip here {describeAge(resume.updatedAt)} &mdash;{" "}
                  <b>&ldquo;{resume.turns.find((t) => t.role === "user")?.content.trim()}&rdquo;</b>
                </p>
                <div className="resume-actions">
                  <button
                    type="button"
                    className="resume-yes"
                    onClick={() => {
                      setTurns(resume.turns);
                      setResume(null);
                    }}
                  >
                    Pick up where I left off
                  </button>
                  <button
                    type="button"
                    className="resume-no"
                    onClick={() => {
                      setResume(null);
                      clearConversation();
                    }}
                  >
                    Start fresh
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h1>Where are you headed next?</h1>
                <p>
                  Describe the trip in your own words &mdash; a region, a season, an occasion.
                  The Guide searches {COLLECTION_SUMMARY}, then an Aspen advisor takes it from
                  there. {ADVISOR_SLA}
                </p>

                <div className="chips">
                  {GUIDE_CHIPS.map((chip) => (
                    <button key={chip} className="chip" onClick={() => send(chip, "chip")}>
                      {chip}
                    </button>
                  ))}
                </div>

                {/* The tour's only other entry point is "How this works" in the
                    header, which is display:none below 720px — so on a phone the
                    tour was unreachable. It belongs here anyway: this is the
                    first screen a first-timer sees, and an empty transcript is
                    by definition the only moment "what is this?" is still the
                    question. It disappears the instant they send anything.

                    Above the dates disclosure, not below it, and that ordering
                    is the point. The phone sheet rests at 46dvh with a budget
                    tuned to fit "headline, subhead, prompts and composer" — a
                    fifth block has to displace something, and a first-timer's
                    "what is this?" outranks "I already have dates", which is
                    the refinement of someone who has already decided. */}
                <button
                  type="button"
                  className="empty-tour"
                  onClick={() => {
                    tourOpened();
                    window.dispatchEvent(new Event("bevvip:start-tour"));
                  }}
                >
                  New here? See how this works
                </button>

                {datesOpen ? (
                  <BookingStrip
                    onSearch={(ask) => send(ask, "strip")}
                    initial={trip}
                    onCancel={() => setDatesOpen(false)}
                  />
                ) : (
                  <button
                    type="button"
                    className="empty-toggle"
                    onClick={() => setDatesOpen(true)}
                  >
                    Have dates and a party size? Add them
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="wrap">
            {turns.map((turn, i) => (
              <Message key={i} turn={turn} turns={turns} onPick={send} busy={busy} />
            ))}
            {status && <div className="status">{status}</div>}
          </div>
        )}
      </div>
      <div className="composer">
        {turns.length > 0 && (
          <div className="composer-tools">
            {trip && (trip.checkIn || trip.destination) && !editingTrip && (
              <button
                type="button"
                className="trip-chip"
                title="Edit dates and party"
                onClick={() => setEditingTrip(true)}
              >
                {tripSummary(trip)} <span className="trip-edit">✎</span>
              </button>
            )}
            <button
              type="button"
              className="restart"
              title="Clear this conversation and reset the map"
              onClick={startOver}
            >
              ↺ Start over
            </button>
          </div>
        )}
        {turns.length > 0 && editingTrip && (
          <BookingStrip
            compact
            initial={trip}
            onCancel={() => setEditingTrip(false)}
            onSearch={(ask) => {
              setEditingTrip(false);
              send(ask, "strip");
            }}
          />
        )}
        {/* The textarea used to be disabled while a reply streamed, so a
            traveler could not write down the next thought while reading the
            current answer, and the only way out of a slow reply was the
            destructive Start over. Typing is always allowed now; Send waits its
            turn, and Stop ends the stream without costing anything. */}
        <div className="row">
          <textarea
            rows={1}
            placeholder="Ask The Guide…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!busy) send(input);
              }
            }}
          />
          {busy ? (
            <button className="send send-stop" onClick={stop} title="Stop this reply">
              Stop
            </button>
          ) : (
            <button className="send" disabled={!input.trim()} onClick={() => send(input)}>
              Send
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Message({
  turn,
  turns,
  onPick,
  busy,
}: {
  turn: Turn;
  turns: Turn[];
  onPick: (text: string, source: AskSource) => void;
  busy: boolean;
}) {
  const isUser = turn.role === "user";
  const options = isUser ? [] : extractOptions(turn.content);
  const hasResults =
    !isUser && !!turn.meta && (!!turn.meta.deepLink || shortlistNames(turn.meta).length > 0);
  return (
    <div className={`msg ${isUser ? "user" : "guide"}`}>
      <div className="who">{isUser ? "You" : "G"}</div>
      <div className="body">
        {renderText(turn.content)}
        {turn.meta && <ResultCards meta={turn.meta} />}
        {options.length > 0 && (
          <div className="quick-replies">
            <div className="qr-cap">Tap a reply, or type your own</div>
            <div className="qr-row">
              {options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  className="qr-chip"
                  disabled={busy}
                  onClick={() => onPick(opt, "quickreply")}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}
        {hasResults && turn.meta && <ChatMoves meta={turn.meta} turns={turns} busy={busy} />}
      </div>
    </div>
  );
}

// The close-out of a results block.
//
// This used to render its own copy of the contact form inline, behind one of
// six different button labels ("Prepare My Hotel Shortlist", "Find My Best
// Expeditions", "Show My Best Yacht Options"…). Six grammars for one action
// meant the most important control in the app was never twice the same, and a
// second, near-identical implementation of the form lived in this file.
//
// Now: one label, every time, opening the one shared dialog. The category still
// speaks — through HANDOFF_BLURB, in the explanation, where specificity helps
// instead of costing recognition.
function ChatMoves({ meta, turns, busy }: { meta: GuideMeta; turns: Turn[]; busy: boolean }) {
  return (
    <div className="moves">
      <button
        type="button"
        className="move move-primary"
        disabled={busy}
        onClick={() => openAdvisor({ source: "chat", context: buildAdvisorContext(turns, meta) })}
      >
        {ADVISOR_CTA}
      </button>
      <span className="moves-hint">{ADVISOR_SLA} Nothing is booked until you say so.</span>
    </div>
  );
}

// Pull the [[OPTIONS: a | b | c]] tag (if any) into up to 4 quick-reply strings.
function extractOptions(text: string): string[] {
  const m = text.match(/\[\[OPTIONS:\s*([^\]]+)\]\]/i);
  if (!m) return [];
  return m[1]
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
}

// Minimal markdown: headings (#), paragraphs, **bold**, *italic*, "- " bullet
// lists, and GitHub-style pipe tables (used by the structured comparison view).
// Lines are grouped so a table or heading mixed into a block still renders right
// instead of leaking raw "| a | b |" pipes into the reply.
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l.trim());
const isListItem = (l: string) => /^\s*[-•]\s+/.test(l);
const isHeading = (l: string) => /^\s*#{1,6}\s+\S/.test(l);
// ---, *** or ___ alone on a line — otherwise it leaks into the reply as text.
const isHr = (l: string) => /^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(l);
const isTableDivider = (l: string) =>
  splitTableCells(l).every((c) => /^:?-{2,}:?$/.test(c.replace(/\s+/g, "")));

function splitTableCells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function renderText(text: string) {
  const lines = stripControlTags(text).split("\n");
  const out: React.ReactNode[] = [];
  let key = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (isTableRow(line)) {
      const rows: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) { rows.push(lines[i]); i++; }
      out.push(renderTable(rows, key++));
      continue;
    }
    if (isHeading(line)) {
      out.push(
        <p key={key++} className="reply-h">
          {inline(line.replace(/^\s*#{1,6}\s+/, ""))}
        </p>,
      );
      i++;
      continue;
    }
    if (isHr(line)) {
      out.push(<hr key={key++} className="reply-hr" />);
      i++;
      continue;
    }
    if (isListItem(line)) {
      const items: string[] = [];
      while (i < lines.length && isListItem(lines[i])) { items.push(lines[i].replace(/^\s*[-•]\s+/, "")); i++; }
      out.push(
        <ul key={key++}>
          {items.map((it, j) => <li key={j}>{inline(it)}</li>)}
        </ul>,
      );
      continue;
    }
    // Paragraph: gather consecutive plain lines.
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !isTableRow(lines[i]) && !isListItem(lines[i]) && !isHeading(lines[i]) && !isHr(lines[i])
    ) { para.push(lines[i]); i++; }
    out.push(<p key={key++}>{inline(para.join(" "))}</p>);
  }
  return out;
}

function renderTable(rows: string[], key: number) {
  const parsed = rows.map(splitTableCells);
  const hasHeader = parsed.length > 1 && isTableDivider(rows[1]);
  const header = hasHeader ? parsed[0] : null;
  const body = parsed.filter((_, idx) => !(idx === 0 && hasHeader) && !(idx === 1 && hasHeader));
  return (
    <div className="cmp-wrap" key={key}>
      <table className="cmp">
        {header && (
          <thead>
            <tr>{header.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {body.map((cells, r) => (
            <tr key={r}>{cells.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// **bold** / *italic* within a run of plain (non-link) text.
function emphasis(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <b key={`${keyPrefix}b${i}`}>{part.slice(2, -2)}</b>;
    if (part.startsWith("*") && part.endsWith("*")) return <i key={`${keyPrefix}i${i}`}>{part.slice(1, -1)}</i>;
    return part;
  });
}

// Markdown links [label](https://…) the Guide emits (e.g. a result's Book /
// Inquire URL) render as real clickable anchors instead of leaking the raw
// "[label](url)" text into the reply. Emphasis is applied around them.
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    if (m.index > last) out.push(...emphasis(text.slice(last, m.index), `e${idx}-`));
    out.push(
      <a key={`lnk${idx}`} className="reply-link" href={m[2]} target="_blank" rel="noreferrer">
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
    idx++;
  }
  if (last < text.length) out.push(...emphasis(text.slice(last), `e${idx}-`));
  return out;
}

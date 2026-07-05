"use client";

// The Guide — streaming chat client. Consumes the /api/guide SSE stream
// (status → delta* → meta → done) and renders the reply as it types, with
// inventory result cards and an "Open in Atlas" handoff from the meta frame.

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, GuideFrame, GuideMeta } from "@/lib/types";
import { clearTrip, setTrip } from "@/lib/trip-state";
import ResultCards from "./ResultCards";

// The five seed prompts on the empty state. Each leads into a pillar AND
// quietly demonstrates a capability: cross-pillar + region search (a hotel ask
// that also surfaces yachts), month-only search, two-brand comparison, an
// around-the-world theme, and port-of-call search on a grand voyage.
const CHIPS = [
  "Four Seasons in Caribbean",
  "Galápagos Expedition Cruise journeys in January",
  "Aman vs. Orient Express Luxury Yachts",
  "Around the world by private jet trips in 2026",
  "What world Cruises call on Sydney, Australia in 2027",
];

interface Turn extends ChatMessage {
  meta?: GuideMeta;
}

// The conversation survives leaving and returning to Base Camp (opening a full
// Atlas, a card, or the header links). It is persisted per browser session so
// the traveler is never dropped back to a blank slate mid-trip-planning.
const STORAGE_KEY = "bevvip.guide.turns";

export default function GuideChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  // Session "generation": bumped by Start over so an in-flight stream from the
  // previous conversation can't write back into the freshly cleared transcript.
  const genRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Restore after mount (not during render) so server and first client paint
  // agree and React does not flag a hydration mismatch.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setTurns(JSON.parse(raw));
    } catch {
      /* storage unavailable: start fresh */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return; // don't clobber saved turns before the restore runs
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
    } catch {
      /* over quota or unavailable: best effort */
    }
  }, [turns, hydrated]);

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

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
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
            patchReply((turn) => ({ ...turn, meta }));
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
        patchReply((turn) => ({
          ...turn,
          content:
            turn.content ||
            `I hit a snag reaching the inventory — ${err instanceof Error ? err.message : err}. Please try again.`,
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

  // Restart everything: end any in-flight stream, wipe the conversation and its
  // saved session, and tell the Living Atlas to drop plotted results and return
  // to its resting state. The guide-session effect below then fires inactive
  // (turns is empty), so the mobile shell un-collapses back to the idle home.
  function startOver() {
    genRef.current += 1; // invalidate any open stream's writebacks
    abortRef.current?.abort();
    abortRef.current = null;
    setTurns([]);
    setInput("");
    setBusy(false);
    setStatus(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable: nothing persisted to clear */
    }
    clearTrip(); // trip state shares the conversation's lifetime
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
          <button
            type="button"
            className="gsb-restart"
            title="Start a new conversation"
            aria-label="Start over"
            onClick={startOver}
          >
            ↺ Start over
          </button>
        </div>
      )}
      <div className="transcript" ref={transcriptRef}>
        {turns.length === 0 ? (
          <div className="empty">
            <h1>Where are you headed next?</h1>
            <p>
              A region, a season, a hotel, or simply the kind of journey you&rsquo;re craving.
              I&rsquo;ll help frame the trip, surface the right possibilities, and guide the first
              elegant move.
            </p>
            <div className="chips">
              {CHIPS.map((chip) => (
                <button key={chip} className="chip" onClick={() => send(chip)}>
                  {chip}
                </button>
              ))}
            </div>
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
            <button
              type="button"
              className="restart"
              title="Clear this conversation and reset the Living Atlas"
              onClick={startOver}
            >
              ↺ Start over
            </button>
          </div>
        )}
        <div className="row">
          <textarea
            rows={1}
            placeholder="Ask The Guide…"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button className="send" disabled={busy || !input.trim()} onClick={() => send(input)}>
            Send
          </button>
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
  onPick: (text: string) => void;
  busy: boolean;
}) {
  const isUser = turn.role === "user";
  const options = isUser ? [] : extractOptions(turn.content);
  // Show the advisor handoff once a turn has surfaced inventory (cards or an
  // Atlas deep link) — this is where the traveler hands the shortlist off.
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
                  onClick={() => onPick(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}
        {hasResults && turn.meta && (
          <ChatMoves meta={turn.meta} turns={turns} busy={busy} />
        )}
      </div>
    </div>
  );
}

// The close-out of a results block. The primary move is a category-aware
// hand-off: tapping it opens a light contact capture, then POSTs the qualified
// brief + shortlist + transcript to /api/handoff so the advisor reaches the
// traveler already knowing how to follow up. Email and phone stay as secondary
// conveniences. Replaces the old four-button renderMoves().
function ChatMoves({
  meta,
  turns,
  busy,
}: {
  meta: GuideMeta;
  turns: Turn[];
  busy: boolean;
}) {
  const category = handoffCategory(meta);
  const ctaLabel = HANDOFF_CTA[category] ?? HANDOFF_CTA.generic;

  // "idle" → the CTA; "form" → contact capture; "sending"/"done"/"error".
  const [phase, setPhase] = useState<"idle" | "form" | "sending" | "done" | "error">("idle");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    const cleanEmail = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      setError("Please enter a valid email so the specialist can reach you.");
      setPhase("form");
      return;
    }
    setPhase("sending");
    setError("");
    try {
      const res = await fetch("/api/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          action: ctaLabel,
          brief: latestBrief(turns),
          shortlist: shortlistNames(meta),
          deepLink: meta.deepLink ?? null,
          contact: { name: name.trim(), email: cleanEmail, phone: phone.trim() },
          notes: notes.trim(),
          transcript: transcript(turns),
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
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send. Please try again.");
      setPhase("error");
    }
  };

  if (phase === "done") {
    return (
      <div className="moves-done">
        <p>
          Done — an Aspen Travel Advisors specialist is joining the conversation. They have your shortlist and
          the details of what we discussed, and will be in touch at {email.trim()}. You can
          keep exploring here in the meantime.
        </p>
      </div>
    );
  }

  if (phase === "form" || phase === "sending" || phase === "error") {
    const sending = phase === "sending";
    return (
      <div className="moves-capture">
        <div className="mc-lead">Bring in an advisor</div>
        <div className="mc-note">
          An Aspen Travel Advisors specialist will pick up this conversation with your
          shortlist in hand and reach out to take it from here.
        </div>
        <input
          className="mc-field"
          type="text"
          placeholder="Name"
          value={name}
          disabled={sending}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="mc-field"
          type="email"
          inputMode="email"
          placeholder="Email"
          value={email}
          disabled={sending}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="mc-field"
          type="tel"
          inputMode="tel"
          placeholder="Phone (optional)"
          value={phone}
          disabled={sending}
          onChange={(e) => setPhone(e.target.value)}
        />
        <textarea
          className="mc-field mc-notes"
          rows={2}
          placeholder="Anything you'd like the advisor to know? (optional)"
          value={notes}
          disabled={sending}
          onChange={(e) => setNotes(e.target.value)}
        />
        {error && <div className="mc-error">{error}</div>}
        <div className="mc-actions">
          <button type="button" className="move move-primary" disabled={sending} onClick={submit}>
            {sending ? "Sending…" : "Connect me with an advisor"}
          </button>
          <button
            type="button"
            className="move"
            disabled={sending}
            onClick={() => {
              setPhase("idle");
              setError("");
            }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="moves">
      <button
        type="button"
        className="move move-primary"
        disabled={busy}
        onClick={() => setPhase("form")}
      >
        {ctaLabel}
      </button>
      <span className="moves-hint">Brings an Aspen Travel Advisors specialist into the conversation</span>
    </div>
  );
}

// The top result names from a meta frame, carried to the advisor. Mirrors the
// card collection order (latest tool first) without the per-brand card caps.
function shortlistNames(meta: GuideMeta): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const tool of [...(meta.tools ?? [])].reverse()) {
    for (const r of tool.results ?? []) {
      const name = typeof r?.name === "string" ? r.name.trim() : "";
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names.slice(0, 5);
}

// A compact, plain-text rendering of the conversation for the email handoff:
// control tags stripped, each turn labelled, capped so the mailto body stays
// within what mail clients accept.
function transcript(turns: Turn[]): string {
  const lines = turns
    .filter((t) => t.content && t.content.trim())
    .map((t) => `${t.role === "user" ? "You" : "The Guide"}: ${stripControlTags(t.content)}`);
  let out = lines.join("\n\n");
  const CAP = 4000;
  if (out.length > CAP) out = "…(earlier messages trimmed)…\n\n" + out.slice(out.length - CAP);
  return out;
}

// Strip control tags ([[CHART:..]], [[OPTIONS:..]]) and any trailing partial
// tag still mid-stream, so they never flash as raw text in the revealed reply.
function stripControlTags(s: string): string {
  return s
    .replace(/\[\[CHART:\s*[a-z ]+\]\]/gi, "")
    .replace(/\[\[OPTIONS:[^\]]*\]\]/gi, "")
    .replace(/\[\[BRIEF:[^\]]*\]\]/gi, "")
    .replace(/\n*\s*\[\[[^\]]*$/, "")
    .trim();
}

// The qualified advisor brief, carried silently in a [[BRIEF: ...]] tag the
// Guide emits once it has enough signal. It is the structured "how to follow
// up" the human advisor receives, instead of re-reading the whole transcript.
interface Brief {
  destination?: string;
  when?: string;
  party?: string;
  budget?: string;
  style?: string;
  considering?: string;
}

// Parse the latest [[BRIEF: dest=.. | when=.. | ...]] tag out of one message.
function extractBrief(text: string): Brief | null {
  const m = text.match(/\[\[BRIEF:\s*([^\]]+)\]\]/i);
  if (!m) return null;
  const kv: Record<string, string> = {};
  for (const pair of m[1].split("|")) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    const k = pair.slice(0, i).trim().toLowerCase();
    const v = pair.slice(i + 1).trim();
    if (v) kv[k] = v;
  }
  const brief: Brief = {
    destination: kv.dest || kv.destination,
    when: kv.when,
    party: kv.party,
    budget: kv.budget,
    style: kv.style,
    considering: kv.considering,
  };
  return Object.values(brief).some(Boolean) ? brief : null;
}

// The most recent brief across the whole conversation (the Guide re-emits an
// updated tag as it learns more; the latest one wins).
function latestBrief(turns: Turn[]): Brief {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role !== "assistant") continue;
    const b = extractBrief(turns[i].content);
    if (b) return b;
  }
  return {};
}

// Which pillar the hand-off should speak to, derived from the inventory that
// surfaced. Antarctica is split out from generic expedition cruising because
// the ship-vs-destination decision there warrants its own framing.
function handoffCategory(meta: GuideMeta): string {
  const region = (meta.chartRegion || "").toLowerCase();
  const tools = [...(meta.tools ?? [])].reverse();
  const tool = tools.find((t) => (t.results ?? []).length > 0) ?? tools[0];
  const type = (tool?.type || "").toLowerCase();
  if (type === "hotel") return "hotel";
  if (type === "jet") return "jet";
  if (type === "yacht") return "yacht";
  if (type === "worldcruise") return "worldcruise";
  if (type === "cruise") return region === "antarctica" ? "antarctica" : "expedition";
  return "generic";
}

// The category-aware primary call to action. The searching is done; this is the
// "a specialist does the next layer" move, not "contact an advisor."
const HANDOFF_CTA: Record<string, string> = {
  hotel: "Prepare My Hotel Shortlist",
  expedition: "Find My Best Expeditions",
  antarctica: "Compare Antarctica Options",
  jet: "Compare Private Jet Journeys",
  yacht: "Show My Best Yacht Options",
  worldcruise: "Compare World Cruises",
  generic: "Continue With A Specialist",
};

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
      !isTableRow(lines[i]) && !isListItem(lines[i]) && !isHeading(lines[i])
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

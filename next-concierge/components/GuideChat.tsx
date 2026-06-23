"use client";

// The Guide — streaming chat client. Consumes the /api/guide SSE stream
// (status → delta* → meta → done) and renders the reply as it types, with
// inventory result cards and an "Open in Atlas" handoff from the meta frame.

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, GuideFrame, GuideMeta } from "@/lib/types";
import ResultCards from "./ResultCards";

const CHIPS = [
  "Four Seasons in Caribbean",
  "Galápagos Expedition Cruise journeys in January",
  "Aman vs. Orient Express Luxury Yachts",
  "Around the world by private jet trips in 2026",
];

// Advisor handoff target — the human advisor closes and books. Kept in sync
// with the standalone Atlas client (CONTACT in public/index.html).
const CONTACT = { email: "Book@BeVvip.com", tel: "970.925.1002", telHref: "tel:+19709251002" };

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
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, status]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
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
        const next = [...t];
        next[next.length - 1] = fn(next[next.length - 1]);
        return next;
      });

    try {
      const res = await fetch("/api/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
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
            // Broadcast to the Living Atlas so it fits + satellites the results.
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("bevvip:atlas-plot", { detail: meta }));
            }
          }
          if (frame.type === "error") throw new Error(frame.error);
        }
      }
    } catch (err) {
      patchReply((turn) => ({
        ...turn,
        content:
          turn.content ||
          `I hit a snag reaching the inventory — ${err instanceof Error ? err.message : err}. Please try again.`,
      }));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <section className="chat">
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
          <ChatMoves meta={turn.meta} turns={turns} onPick={onPick} busy={busy} />
        )}
      </div>
    </div>
  );
}

// The four "moves" that close out a results block: email the shortlist (with a
// transcript of the conversation so the advisor has full context), call, or
// inquire. Ported from renderMoves() in the standalone Atlas client.
function ChatMoves({
  meta,
  turns,
  onPick,
  busy,
}: {
  meta: GuideMeta;
  turns: Turn[];
  onPick: (text: string) => void;
  busy: boolean;
}) {
  const emailResults = () => {
    const subject = "My BeVvip shortlist";
    const names = shortlistNames(meta);
    const lines: string[] = ["Please send details and hold availability for:"];
    if (names.length) {
      for (const n of names) lines.push(" • " + n);
    } else {
      lines.push(" • (see the conversation below)");
    }
    if (meta.deepLink) lines.push("", "See them on the Atlas: " + meta.deepLink);
    lines.push("", "— Our conversation —", transcript(turns));
    lines.push("", "Name:", "Travel dates:", "Party:");
    launch(mailto(subject, lines.join("\n")));
  };

  return (
    <div className="moves">
      <button type="button" className="move" disabled={busy} onClick={emailResults}>
        Email my results
      </button>
      <button
        type="button"
        className="move"
        disabled={busy}
        onClick={() => onPick("I'd like to request VIP planning for this trip.")}
      >
        Request VIP planning
      </button>
      <button type="button" className="move" onClick={() => launch(CONTACT.telHref)}>
        Talk to an advisor
      </button>
      <button
        type="button"
        className="move"
        onClick={() => launch(mailto("Inquiry — BeVvip", ""))}
      >
        Inquire
      </button>
    </div>
  );
}

// Use a transient anchor + click to launch mailto/tel — assigning
// location.href can trigger a full page navigation on some mobile browsers.
function launch(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function mailto(subject: string, body: string): string {
  const q = body
    ? `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : `?subject=${encodeURIComponent(subject)}`;
  return `mailto:${CONTACT.email}${q}`;
}

// The top result names from a meta frame, for the email shortlist. Mirrors the
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
    .replace(/\[\[CHART:\s*[a-z]+\]\]/gi, "")
    .replace(/\[\[OPTIONS:[^\]]*\]\]/gi, "")
    .replace(/\n*\s*\[\[[^\]]*$/, "")
    .trim();
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

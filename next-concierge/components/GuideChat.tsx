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

interface Turn extends ChatMessage {
  meta?: GuideMeta;
}

export default function GuideChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

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
              <Message key={i} turn={turn} onPick={send} busy={busy} />
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
  onPick,
  busy,
}: {
  turn: Turn;
  onPick: (text: string) => void;
  busy: boolean;
}) {
  const isUser = turn.role === "user";
  const options = isUser ? [] : extractOptions(turn.content);
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
      </div>
    </div>
  );
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

// Minimal markdown: paragraphs, **bold**, *italic*, and "- " bullet lists.
function renderText(text: string) {
  const blocks = stripControlTags(text).split(/\n{2,}/).filter(Boolean);
  return blocks.map((block, i) => {
    const lines = block.split("\n");
    const isList = lines.every((l) => /^\s*[-•]\s+/.test(l));
    if (isList) {
      return (
        <ul key={i}>
          {lines.map((l, j) => (
            <li key={j}>{inline(l.replace(/^\s*[-•]\s+/, ""))}</li>
          ))}
        </ul>
      );
    }
    return <p key={i}>{inline(block)}</p>;
  });
}

function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <b key={i}>{part.slice(2, -2)}</b>;
    if (part.startsWith("*") && part.endsWith("*")) return <i key={i}>{part.slice(1, -1)}</i>;
    return part;
  });
}

"use client";

// Mobile-only dock floating over the Living Atlas canvas (phones only — hidden
// by CSS everywhere else, and whenever the chat sheet is up). Three stacked
// layers, bottom-up:
//   · the "Ask The Guide" pill — the persistent entry into the chat sheet;
//   · quick-start prompt chips on the idle home, so discovery starts from the
//     map rather than a copy block;
//   · a swipeable strip of result cards once the Guide has plotted a shortlist —
//     the cards ride over the map instead of replacing it.
// The dock listens to the same events the Living Atlas does (bevvip:atlas-plot /
// bevvip:atlas-reset) and restores the last plot from sessionStorage, so a
// return visit re-opens on the strip the persisted chat still shows.

import { useEffect, useState } from "react";
import type { GuideMeta } from "@/lib/types";
import ResultCards from "./ResultCards";
import { GUIDE_CHIPS } from "./GuideChat";

// Shared with AtlasShell, which writes it on every plot.
const PLOT_STORAGE_KEY = "bevvip:atlas:last-plot";

export default function AtlasDock({
  onOpenChat,
}: {
  onOpenChat: (focus: boolean) => void;
}) {
  const [meta, setMeta] = useState<GuideMeta | null>(null);
  const [sessionActive, setSessionActive] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PLOT_STORAGE_KEY);
      if (raw) setMeta(JSON.parse(raw));
    } catch {
      /* storage unavailable — start with the idle dock */
    }
    function onPlot(e: Event) {
      const m = (e as CustomEvent<GuideMeta>).detail;
      if (m) setMeta(m);
    }
    function onReset() {
      setMeta(null);
    }
    function onSession(e: Event) {
      setSessionActive(!!(e as CustomEvent<{ active?: boolean }>).detail?.active);
    }
    window.addEventListener("bevvip:atlas-plot", onPlot as EventListener);
    window.addEventListener("bevvip:atlas-reset", onReset);
    window.addEventListener("bevvip:guide-session", onSession as EventListener);
    return () => {
      window.removeEventListener("bevvip:atlas-plot", onPlot as EventListener);
      window.removeEventListener("bevvip:atlas-reset", onReset);
      window.removeEventListener("bevvip:guide-session", onSession as EventListener);
    };
  }, []);

  // A chip is a real question: hand it to The Guide (same send pipeline as
  // typing) and raise the sheet to half so the streaming reply shows with the
  // map still visible — and moving — above it.
  const ask = (text: string) => {
    window.dispatchEvent(new CustomEvent("bevvip:guide-ask", { detail: { text } }));
    onOpenChat(false);
  };

  const hasCards = !!meta && (meta.tools ?? []).some((t) => (t.results ?? []).length > 0);

  return (
    <div className="atlas-dock">
      {hasCards && meta ? (
        <div className="dock-results">
          <div className="dock-results-cap">
            <span>On the map above</span>
            <button type="button" className="dock-results-open" onClick={() => onOpenChat(false)}>
              The Guide&rsquo;s notes →
            </button>
          </div>
          <ResultCards meta={meta} />
        </div>
      ) : (
        !sessionActive && (
          <div className="dock-chips">
            {GUIDE_CHIPS.map((chip) => (
              <button key={chip} type="button" className="chip" onClick={() => ask(chip)}>
                {chip}
              </button>
            ))}
          </div>
        )
      )}
      <button type="button" className="dock-pill" onClick={() => onOpenChat(true)}>
        <span className="dock-pill-av" aria-hidden="true">
          G
        </span>
        <span className="dock-pill-text">Ask The Guide…</span>
        <span className="dock-pill-hint">{sessionActive ? "Continue" : "Chat"}</span>
      </button>
    </div>
  );
}

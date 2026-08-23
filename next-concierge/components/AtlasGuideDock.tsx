"use client";

/**
 * The Guide, on an atlas page.
 *
 * Until now the chat existed on exactly one route — the home page — and every
 * ask from an atlas was a navigation to it: `/?ask=…`, which unloads the map,
 * the filters, the pinned property and the camera in order to ask a question
 * *about* the map, the filters, the pinned property and the camera. That cost
 * is why the atlases felt like a different product from the chat, and why the
 * per-card "Ask The Guide" button was easy to write off as a link out.
 *
 * `GuideChat` needs no props and persists its own conversation
 * (lib/conversation-store), so the same session continues here: a question
 * asked from the hotel atlas lands in the thread the traveller started on the
 * home page, and its answers plot onto THIS map through the same
 * `bevvip:atlas-plot` event the home globe listens for.
 *
 * Mounting it also flips `registerGuideHost()`, which is what tells every ask
 * affordance in the app — cards, pins, the dossier — to deliver in place rather
 * than navigate. Nothing has to know whether a chat is present; it just asks.
 */

import { useEffect, useRef, useState } from "react";
import GuideChat from "./GuideChat";
import { registerGuideHost } from "@/lib/atlas/ask";
import type { AskSource } from "@/lib/analytics";

export default function AtlasGuideDock() {
  const [open, setOpen] = useState(false);
  /**
   * The chat is not mounted until it is first opened.
   *
   * GuideChat restores a persisted conversation and subscribes to a handful of
   * events; doing that on every atlas page load, for a panel most visitors
   * never open, is work nobody asked for. Once mounted it STAYS mounted —
   * closing the sheet must not throw away a streaming reply.
   */
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => registerGuideHost(), []);

  /**
   * A question that arrived before the chat existed.
   *
   * The first ask on a page hits this dock while GuideChat is still unmounted,
   * so nothing is listening on `bevvip:guide-ask` yet and the question is
   * dropped — the sheet opens, empty, and the traveller's click did nothing.
   * That is the one failure mode a lazily-mounted chat has and an always-
   * mounted one does not, so the dock catches the question and replays it once
   * the chat is up.
   */
  const pendingAsk = useRef<{ text: string; source?: AskSource } | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    /*
     * An ask from anywhere on the page opens the sheet.
     *
     * Sent by lib/atlas/ask alongside the question itself, because a question
     * delivered to a chat the traveller cannot see is the same as no answer:
     * the old navigation at least showed them where the reply would appear.
     */
    function onOpen() {
      setEverOpened(true);
      setOpen(true);
    }
    function onAsk(e: Event) {
      // Only while the chat is absent. Once it is mounted it hears these
      // itself, and buffering them here too would send every question twice.
      if (mountedRef.current) return;
      const detail = (e as CustomEvent<{ text?: string; source?: AskSource }>).detail;
      const text = String(detail?.text || "").trim();
      if (text) pendingAsk.current = { text, source: detail?.source };
    }
    window.addEventListener("bevvip:guide-ask", onAsk as EventListener);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("bevvip:guide-open", onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("bevvip:guide-ask", onAsk as EventListener);
      window.removeEventListener("bevvip:guide-open", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  /**
   * Replay the held question.
   *
   * Child effects run before parent effects, so by the time this runs the chat
   * below has already subscribed — which is exactly the ordering the first ask
   * needed and did not have.
   */
  useEffect(() => {
    if (!everOpened) return;
    mountedRef.current = true;
    const held = pendingAsk.current;
    if (!held) return;
    pendingAsk.current = null;
    window.dispatchEvent(new CustomEvent("bevvip:guide-ask", { detail: held }));
  }, [everOpened]);

  return (
    <>
      <button
        type="button"
        className={`atlas-guide-pill${open ? " on" : ""}`}
        aria-expanded={open}
        onClick={() => {
          setEverOpened(true);
          setOpen((v) => !v);
        }}
      >
        <span className="agp-av" aria-hidden="true">
          G
        </span>
        <span className="agp-text">{open ? "Hide The Guide" : "Ask The Guide…"}</span>
      </button>

      {/*
        Kept in the tree once opened, hidden with a class rather than unmounted:
        a reply still streaming when the sheet is closed should still be there
        when it comes back.
      */}
      {everOpened && (
        <div className={`atlas-guide-sheet${open ? " open" : ""}`} aria-hidden={!open}>
          <div className="ags-head">
            <span>The Guide</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close The Guide">
              ✕
            </button>
          </div>
          <div className="ags-body">
            <GuideChat />
          </div>
        </div>
      )}
    </>
  );
}

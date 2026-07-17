"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import AtlasDock from "./AtlasDock";

// Base Camp is atlas-first at every size: the Living Atlas owns the full stage
// and The Guide floats over it.
//
// Desktop/tablet (>640px): the chat is a docked panel on the left — Google
// Maps' desktop grammar. Its width drags at the right edge (persisted), a tab
// on that edge collapses it to a floating "Ask The Guide" pill for full-map
// immersion, and the collapsed/open state is the home--panel-closed class.
//
// Phones (≤640px): the chat is a bottom sheet with three detents — parked
// off-screen behind the atlas dock's pill, half-height (map animating above),
// or nearly full for reading — driven by the home--sheet-* classes. The two
// state machines are independent; each breakpoint's CSS reads only its own.
//
// Whenever either state changes the panel/sheet footprint, we dispatch
// "bevvip:atlas-refit" so the atlas re-frames plotted results (and recenters
// its ambient camera) into the strip of map that remains visible.

const WIDTH_KEY = "bevvip.basecamp.guideW";
const MIN_W = 340; // the transcript stays readable…
const MAX_W = 680; // …and the map keeps the frame.
const DEFAULT_W = 440;
const PANEL_GAP = 16; // .home-chat's CSS left offset

type SheetState = "pill" | "half" | "full";

export default function HomeSplit({ chat, atlas }: { chat: ReactNode; atlas: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [guideW, setGuideW] = useState(DEFAULT_W);
  const [dragging, setDragging] = useState(false);

  // Desktop panel open/closed. Phones never toggle this (the tab and pill that
  // drive it are hidden there), so the sheet styles are unaffected by it.
  const [panelOpen, setPanelOpen] = useState(true);

  // Mobile chat-sheet detent.
  const [sheet, setSheet] = useState<SheetState>("pill");

  const requestRefit = useCallback(() => {
    window.setTimeout(() => window.dispatchEvent(new Event("bevvip:atlas-refit")), 420);
  }, []);

  // Transaction mode: an ?ask= deep link (from an atlas card or a campaign)
  // means the traveler arrives knowing what they want — surface the chat so the
  // auto-sent question and its streaming answer are in view. Discovery mode
  // (no ask) keeps the world primary: pill on phones, open panel on desktop.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("ask")?.trim()) {
        setSheet("half");
        setPanelOpen(true);
      }
    } catch {
      /* no query / unavailable */
    }
  }, []);

  // Starting the conversation over returns the phone stage to the idle,
  // map-first home. Desktop keeps whatever panel state the traveler chose.
  useEffect(() => {
    function onSession(e: Event) {
      const active = !!(e as CustomEvent<{ active?: boolean }>).detail?.active;
      if (!active) setSheet("pill");
    }
    window.addEventListener("bevvip:guide-session", onSession as EventListener);
    return () => window.removeEventListener("bevvip:guide-session", onSession as EventListener);
  }, []);

  const setSheetAndRefit = useCallback(
    (next: SheetState | ((s: SheetState) => SheetState)) => {
      setSheet((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        if (value !== prev) requestRefit();
        return value;
      });
    },
    [requestRefit],
  );

  const focusComposer = useCallback(() => {
    window.setTimeout(() => {
      document
        .querySelector<HTMLTextAreaElement>(".home-chat .composer textarea")
        ?.focus({ preventScroll: true });
    }, 460);
  }, []);

  // Open the sheet from the mobile dock. Focusing the composer (pill tap)
  // raises the keyboard; chip taps skip it so the streaming reply gets the room.
  const openChat = useCallback(
    (focus: boolean) => {
      setSheetAndRefit((s) => (s === "pill" ? "half" : s));
      if (focus) focusComposer();
    },
    [setSheetAndRefit, focusComposer],
  );

  const togglePanel = useCallback(
    (open: boolean, focus = false) => {
      setPanelOpen((prev) => {
        if (prev !== open) requestRefit();
        return open;
      });
      if (open && focus) focusComposer();
    },
    [requestRefit, focusComposer],
  );

  // Sheet handle gestures (phones): swipe up grows a detent, swipe down
  // shrinks; a tap toggles half ↔ full. The gesture flags itself so the
  // tap-click that follows touchend doesn't double-step.
  const swipeStartY = useRef<number | null>(null);
  const swipeConsumed = useRef(false);
  const onHandleTouchStart = useCallback((e: React.TouchEvent) => {
    swipeStartY.current = e.touches[0].clientY;
  }, []);
  const onHandleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const y0 = swipeStartY.current;
      swipeStartY.current = null;
      if (y0 == null) return;
      const dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dy) < 24) return; // a tap — let the click handler toggle
      swipeConsumed.current = true;
      setSheetAndRefit((s) => {
        if (dy < 0) return s === "half" ? "full" : s; // swipe up grows
        return s === "full" ? "half" : "pill"; // swipe down shrinks
      });
    },
    [setSheetAndRefit],
  );
  const onHandleClick = useCallback(() => {
    if (swipeConsumed.current) {
      swipeConsumed.current = false;
      return;
    }
    setSheetAndRefit((s) => (s === "full" ? "half" : "full"));
  }, [setSheetAndRefit]);

  // Restore a saved panel width on mount (client-only so SSR stays at the
  // default).
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= MIN_W && saved <= MAX_W) setGuideW(saved);
  }, []);

  const clampW = useCallback((w: number) => {
    const row = rowRef.current;
    // Never let the panel take more than ~55% of the stage from the map.
    const max = row ? Math.min(MAX_W, Math.round(row.getBoundingClientRect().width * 0.55)) : MAX_W;
    return Math.min(max, Math.max(MIN_W, Math.round(w)));
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const row = rowRef.current;
      if (!row) return;
      // Pointer measured from the panel's left edge → new panel width. The map
      // beneath is full-bleed and never resizes, so no Mapbox nudges needed.
      setGuideW(clampW(e.clientX - row.getBoundingClientRect().left - PANEL_GAP));
    };
    const onUp = () => {
      setDragging(false);
      setGuideW((w) => {
        window.localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
      requestRefit(); // plotted results re-frame beside the new width
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, clampW, requestRefit]);

  // Keyboard nudges for accessibility (focus the handle, then arrow keys).
  const onKeyDown = (e: React.KeyboardEvent) => {
    let next = guideW;
    if (e.key === "ArrowRight") next = clampW(guideW + 16); // wider panel
    else if (e.key === "ArrowLeft") next = clampW(guideW - 16); // more map
    else if (e.key === "Home") next = DEFAULT_W;
    else return;
    e.preventDefault();
    setGuideW(next);
    window.localStorage.setItem(WIDTH_KEY, String(next));
    requestRefit();
  };

  return (
    <div
      ref={rowRef}
      className={`home${dragging ? " dragging" : ""} home--sheet-${sheet}${
        panelOpen ? "" : " home--panel-closed"
      }`}
      style={{ "--guide-panel-w": `${guideW}px` } as CSSProperties}
    >
      <aside className="home-atlas">{atlas}</aside>
      <div className="home-chat">
        <div className="home-chat-handle">
          <button
            type="button"
            className="hch-drag"
            aria-label={
              sheet === "full" ? "Shrink The Guide to half height" : "Expand The Guide"
            }
            onClick={onHandleClick}
            onTouchStart={onHandleTouchStart}
            onTouchEnd={onHandleTouchEnd}
          >
            <span className="hch-grip" aria-hidden="true" />
            <span className="hch-label">
              The <b>Guide</b>
              {sheet === "full" ? " — swipe down" : " — swipe up"}
            </span>
          </button>
          <button
            type="button"
            className="hch-map"
            aria-label="Back to the map"
            onClick={() => setSheetAndRefit("pill")}
          >
            Map ▾
          </button>
        </div>
        {chat}
      </div>
      <div
        className="home-gutter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize The Guide panel"
        aria-valuenow={guideW}
        aria-valuemin={MIN_W}
        aria-valuemax={MAX_W}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onKeyDown={onKeyDown}
      >
        <span className="home-gutter-grip" aria-hidden="true" />
      </div>
      <button
        type="button"
        className="guide-tab"
        aria-expanded={panelOpen}
        aria-label="Hide The Guide panel"
        title="Hide The Guide — full map"
        onClick={() => togglePanel(false)}
      >
        ‹
      </button>
      <button type="button" className="guide-pill" onClick={() => togglePanel(true, true)}>
        <span className="gp-av" aria-hidden="true">
          G
        </span>
        Ask The Guide…
      </button>
      <AtlasDock onOpenChat={openChat} />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import AtlasDock from "./AtlasDock";

// Base Camp split: chat on the left, Living Atlas on the right, with a draggable
// gutter between them so guests can trade space toward more chat or more map.
// The ratio is the atlas pane's share of the row, clamped to sane bounds and
// remembered between visits. Mapbox only resizes off the *window* resize event,
// so each drag dispatches a (rAF-throttled) synthetic one to keep the globe
// fitted instead of letterboxed. Below 900px the panes stack (see globals.css)
// and the gutter hides, so this only governs the side-by-side desktop layout.
//
// Phones invert the pairing: the Living Atlas owns the whole stage and The
// Guide rides over it as a bottom sheet with three detents — parked off-screen
// behind the dock's "Ask The Guide" pill, half-height (map still visible and
// animating above as answers plot), or nearly full for reading. The sheet state
// is a class on .home (home--sheet-*) that only the phone breakpoint styles.

const STORAGE_KEY = "bevvip.basecamp.atlasPct";
const MIN_PCT = 28; // atlas can't get narrower than this…
const MAX_PCT = 68; // …or wider than this, so neither pane collapses.
const DEFAULT_PCT = 44; // matches the original flex-basis.

type SheetState = "pill" | "half" | "full";

export default function HomeSplit({ chat, atlas }: { chat: ReactNode; atlas: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [atlasPct, setAtlasPct] = useState(DEFAULT_PCT);
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef<number | null>(null);

  // Mobile chat-sheet detent. Inert on desktop/tablet — the CSS only acts on
  // the home--sheet-* classes below the phone breakpoint.
  const [sheet, setSheet] = useState<SheetState>("pill");

  // Transaction mode: an ?ask= deep link (from an atlas card or a campaign)
  // means the traveler arrives knowing what they want — open the sheet so the
  // auto-sent question and its streaming answer are in view, map above it.
  // Discovery mode (no ask) keeps the world full-screen behind the pill.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("ask")?.trim()) setSheet("half");
    } catch {
      /* no query / unavailable */
    }
  }, []);

  // Starting the conversation over returns the stage to the idle, map-first
  // home. (An active session never forces the sheet open — the map is primary.)
  useEffect(() => {
    function onSession(e: Event) {
      const active = !!(e as CustomEvent<{ active?: boolean }>).detail?.active;
      if (!active) setSheet("pill");
    }
    window.addEventListener("bevvip:guide-session", onSession as EventListener);
    return () => window.removeEventListener("bevvip:guide-session", onSession as EventListener);
  }, []);

  // Whenever the sheet changes detent, ask the atlas to re-frame any plotted
  // results into the strip of map that remains visible (after the slide).
  const setSheetAndRefit = useCallback((next: SheetState | ((s: SheetState) => SheetState)) => {
    setSheet((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      if (value !== prev) {
        window.setTimeout(() => window.dispatchEvent(new Event("bevvip:atlas-refit")), 460);
      }
      return value;
    });
  }, []);

  // Open the sheet from the dock. Focusing the composer (pill tap) raises the
  // keyboard; chip taps skip it so the streaming reply gets the room instead.
  const openChat = useCallback(
    (focus: boolean) => {
      setSheetAndRefit((s) => (s === "pill" ? "half" : s));
      if (focus) {
        window.setTimeout(() => {
          document
            .querySelector<HTMLTextAreaElement>(".home-chat .composer textarea")
            ?.focus({ preventScroll: true });
        }, 460);
      }
    },
    [setSheetAndRefit],
  );

  // The handle's label promises swiping, so honour a real swipe as well as a
  // tap. Swipe up grows the sheet a detent, swipe down shrinks it; a tap
  // toggles half ↔ full. The gesture flags itself so the tap-click that
  // follows touchend doesn't double-step.
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

  // Restore a saved ratio on mount (client-only so SSR stays at the default).
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= MIN_PCT && saved <= MAX_PCT) setAtlasPct(saved);
  }, []);

  const nudgeMapResize = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      window.dispatchEvent(new Event("resize"));
    });
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const row = rowRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      // Pointer measured from the right edge → atlas share of the row width.
      const pct = ((rect.right - e.clientX) / rect.width) * 100;
      const clamped = Math.min(MAX_PCT, Math.max(MIN_PCT, pct));
      setAtlasPct(clamped);
      nudgeMapResize();
    };
    const onUp = () => {
      setDragging(false);
      window.localStorage.setItem(STORAGE_KEY, String(Math.round(atlasPct)));
      window.dispatchEvent(new Event("resize"));
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
  }, [dragging, atlasPct, nudgeMapResize]);

  // Keyboard nudges for accessibility (focus the handle, then arrow keys).
  const onKeyDown = (e: React.KeyboardEvent) => {
    let next = atlasPct;
    if (e.key === "ArrowLeft") next = Math.min(MAX_PCT, atlasPct + 2); // more map
    else if (e.key === "ArrowRight") next = Math.max(MIN_PCT, atlasPct - 2); // more chat
    else if (e.key === "Home") next = DEFAULT_PCT;
    else return;
    e.preventDefault();
    setAtlasPct(next);
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(next)));
    nudgeMapResize();
  };

  return (
    <div
      ref={rowRef}
      className={`home${dragging ? " dragging" : ""} home--sheet-${sheet}`}
    >
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
        aria-label="Resize chat and atlas"
        aria-valuenow={Math.round(atlasPct)}
        aria-valuemin={MIN_PCT}
        aria-valuemax={MAX_PCT}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onKeyDown={onKeyDown}
      >
        <span className="home-gutter-grip" aria-hidden="true" />
      </div>
      <aside className="home-atlas" style={{ flexBasis: `${atlasPct}%` }}>
        {atlas}
      </aside>
      <AtlasDock onOpenChat={openChat} />
    </div>
  );
}

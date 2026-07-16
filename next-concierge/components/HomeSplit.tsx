"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// Base Camp split: chat on the left, Living Atlas on the right, with a draggable
// gutter between them so guests can trade space toward more chat or more map.
// The ratio is the atlas pane's share of the row, clamped to sane bounds and
// remembered between visits. Mapbox only resizes off the *window* resize event,
// so each drag dispatches a (rAF-throttled) synthetic one to keep the globe
// fitted instead of letterboxed. Below 900px the panes stack (see globals.css)
// and the gutter hides, so this only governs the side-by-side desktop layout.

const STORAGE_KEY = "bevvip.basecamp.atlasPct";
const MIN_PCT = 28; // atlas can't get narrower than this…
const MAX_PCT = 68; // …or wider than this, so neither pane collapses.
const DEFAULT_PCT = 44; // matches the original flex-basis.

export default function HomeSplit({ chat, atlas }: { chat: ReactNode; atlas: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [atlasPct, setAtlasPct] = useState(DEFAULT_PCT);
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef<number | null>(null);

  // Mobile-only state. `sessionActive` (broadcast by The Guide once a
  // conversation starts) collapses the home into the chat view and demotes the
  // Living Atlas to a swipe-up peek; `peekOpen` expands that peek back to the
  // live globe. Both classes are inert on desktop/tablet — the CSS only acts on
  // them below the phone breakpoint, so the side-by-side split is unchanged.
  const [sessionActive, setSessionActive] = useState(false);
  const [peekOpen, setPeekOpen] = useState(false);

  useEffect(() => {
    function onSession(e: Event) {
      const active = !!(e as CustomEvent<{ active?: boolean }>).detail?.active;
      setSessionActive(active);
      if (!active) setPeekOpen(false); // returning to the idle home closes the peek
    }
    window.addEventListener("bevvip:guide-session", onSession as EventListener);
    return () => window.removeEventListener("bevvip:guide-session", onSession as EventListener);
  }, []);

  // Mapbox only refits off a window resize, so nudge it after the sheet's height
  // transition settles when the peek opens/closes.
  const togglePeek = useCallback(() => {
    setPeekOpen((v) => !v);
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 460);
  }, []);

  // The handle's label promises "swipe up / swipe down", so honour a real swipe
  // as well as a tap. A vertical drag past the threshold toggles the peek and
  // flags the gesture so the tap-click that follows touchend doesn't undo it.
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
      setPeekOpen((v) => {
        const next = dy < 0; // swipe up opens, swipe down closes
        return next === v ? v : next;
      });
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 460);
    },
    [],
  );
  const onHandleClick = useCallback(() => {
    if (swipeConsumed.current) {
      swipeConsumed.current = false;
      return;
    }
    togglePeek();
  }, [togglePeek]);

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
      className={`home${dragging ? " dragging" : ""}${sessionActive ? " home--session" : ""}${
        peekOpen ? " home--peek-open" : ""
      }`}
    >
      <div className="home-chat">{chat}</div>
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
        <button
          type="button"
          className="home-atlas-handle"
          aria-expanded={peekOpen}
          aria-label={peekOpen ? "Collapse the Living Atlas" : "Open the Living Atlas"}
          onClick={onHandleClick}
          onTouchStart={onHandleTouchStart}
          onTouchEnd={onHandleTouchEnd}
        >
          <span className="hah-grip" aria-hidden="true" />
          <span className="hah-label">
            Living <b>Atlas</b>
            {peekOpen ? " — swipe down" : " — swipe up"}
          </span>
        </button>
        {atlas}
      </aside>
    </div>
  );
}

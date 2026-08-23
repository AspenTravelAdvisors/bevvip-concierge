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
/**
 * Longest the Guide will ever stay hidden waiting for the atlas to say it has
 * finished its ambient tour.
 *
 * This is a DEAD MAN'S SWITCH, not a schedule. The atlas emits
 * "bevvip:tour-ended" from every exit its tour has, and if that were the only
 * mechanism then any future edit that loses one of those exits — or a Mapbox
 * failure that means the tour never arms at all — would leave a visitor on a
 * page with no way to type and no indication anything was wrong. The failure
 * has to be a slightly early panel, never a missing one.
 *
 * Comfortably longer than the ~17.7s tour so it never pre-empts a healthy run,
 * and short enough that a broken one costs a few seconds rather than the visit.
 */
const TOUR_WAIT_CAP_MS = 22000;
const MIN_W = 420; // narrowest width where the booking strip's date windows still show a full mm/dd/yyyy
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
  //
  // STARTS CLOSED, and is opened by the atlas rather than by us — see the
  // "bevvip:tour-ended" listener below. The globe runs a short ambient tour on
  // arrival, and a panel covering a third of the stage while it plays is a
  // caption card competing with the thing it captions.
  const [panelOpen, setPanelOpen] = useState(false);

  // Mobile chat-sheet detent.
  //
  // "Opens at half, not pill" is still the rule — this now says WHEN, not
  // whether. The reasoning that put the composer on screen at load stands
  // unchanged: on a 390px screen the visitor should land able to type, and the
  // globe is beautiful but is not the thing being sold. What changed is that
  // there is now a ~17.7s ambient tour narrating the inventory, and on a phone
  // the sheet covers the half of the map the tour is drawing on.
  //
  // So the sheet still arrives on its own, unprompted, at "half" — it is just
  // sequenced after the tour instead of racing it, and any interaction with the
  // map brings it immediately (the atlas announces an interrupted tour the same
  // way it announces a finished one). The one thing this must never become is
  // the old behaviour, where the conversation waited behind a pill for the
  // visitor to go find it.
  const [sheet, setSheet] = useState<SheetState>("pill");
  const [tourWaiting, setTourWaiting] = useState(true);
  // The detent, readable from event handlers that must not re-subscribe every
  // time it changes — see the map-gesture listener's `down`.
  const sheetRef = useRef<SheetState>("pill");
  sheetRef.current = sheet;

  const requestRefit = useCallback(() => {
    window.setTimeout(() => window.dispatchEvent(new Event("bevvip:atlas-refit")), 420);
  }, []);

  /**
   * Reveal the Guide.
   *
   * Three ways in, in priority order:
   *
   *  1. An ?ask= deep link. The traveler arrived knowing what they want, from
   *     an atlas card or a campaign — there is nothing to demonstrate to them
   *     and the streaming answer needs to be in view. Skips the tour wait
   *     entirely and cancels the fallback.
   *  2. "bevvip:tour-ended" from the atlas — the normal path. Fires when the
   *     tour finishes and the globe resumes its idle spin, AND when the visitor
   *     interrupts it, AND when no tour was ever going to play (reduced motion,
   *     a flat projection, a map that failed to boot).
   *  3. The fallback timer. See TOUR_WAIT_CAP_MS.
   *
   * All three land on the same resting state — sheet at "half", desktop panel
   * open — which is the state the home page used to load in directly. Nothing
   * here can end with the Guide unreachable.
   */
  useEffect(() => {
    let done = false;
    // The composer is never auto-focused here, including in transaction mode:
    // raising the keyboard on a phone before the visitor has seen the answer
    // they were sent here for hides it behind the thing they'd type into.
    const reveal = () => {
      if (done) return;
      done = true;
      window.clearTimeout(fallback);
      window.removeEventListener("bevvip:tour-ended", reveal);
      setTourWaiting(false);
      setSheet("half");
      setPanelOpen(true);
      // The map has just resized under the panel; re-frame anything plotted.
      requestRefit();
    };

    const fallback = window.setTimeout(reveal, TOUR_WAIT_CAP_MS);
    window.addEventListener("bevvip:tour-ended", reveal);

    let askDeepLink = false;
    try {
      askDeepLink = !!new URLSearchParams(window.location.search).get("ask")?.trim();
    } catch {
      /* no query / unavailable */
    }
    if (askDeepLink) reveal();

    return () => {
      window.clearTimeout(fallback);
      window.removeEventListener("bevvip:tour-ended", reveal);
    };
  }, [requestRefit]);

  // Starting over returns the phone stage to the idle home — which is now the
  // composer at half height, not the map with the chat dismissed.
  useEffect(() => {
    function onSession(e: Event) {
      const active = !!(e as CustomEvent<{ active?: boolean }>).detail?.active;
      if (!active && !tourWaiting) setSheet("half");
    }
    window.addEventListener("bevvip:guide-session", onSession as EventListener);
    return () => window.removeEventListener("bevvip:guide-session", onSession as EventListener);
  }, [tourWaiting]);

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

  /*
   * An ask from the map raises the sheet.
   *
   * On a phone the chat is a bottom sheet resting at "pill", so a question sent
   * from a pin popup would stream its answer into something the traveller
   * cannot see. Same event the atlas dock opens on, so every surface that can
   * ask gets the same behaviour without knowing where it is.
   */
  useEffect(() => {
    const onOpen = () => openChat(false);
    window.addEventListener("bevvip:guide-open", onOpen);
    return () => window.removeEventListener("bevvip:guide-open", onOpen);
  }, [openChat]);

  /**
   * On a phone, ANY deliberate gesture on the map parks the Guide — tap, spin,
   * drag, pinch. Same result as "Full map ▾", minus having to find the button.
   *
   * It started as tap-only, which was too narrow: spinning the globe is the
   * clearest possible statement that you want to look at the map, and it left
   * the conversation covering half of it. Reaching for the map at all is the
   * signal; there is no separate decision to collect.
   *
   * Fires on pointerUP, not down, and that ordering is the whole trick. Parking
   * the sheet resizes the map, and resizing it mid-drag fights the gesture
   * you are still making — the globe stutters under your thumb. Waiting for the
   * gesture to finish costs nothing perceptible and keeps the spin smooth.
   *
   * Listeners are passive and on the capture phase: this observes the gesture,
   * it never intercepts it, so Mapbox still receives everything. Desktop is
   * untouched — there is no sheet, and the panel sits beside the map rather
   * than over it.
   */
  const atlasRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = atlasRef.current;
    if (!el) return;

    let armed = false;

    const down = (e: PointerEvent) => {
      // Re-checked per gesture rather than once on mount: a rotate or a resize
      // can cross the breakpoint without remounting this component.
      // `isPrimary` so the second finger of a pinch doesn't arm a second time.
      //
      // `sheetRef.current !== "pill"` is what keeps this rule from fighting the
      // ambient tour. Parking is for a sheet that was IN THE WAY when you
      // reached past it; a sheet already parked has nothing to get out of.
      // Without the check, touching the map during the tour ran both responses
      // on one gesture — the atlas announcing the interruption (which reveals
      // the Guide) and this parking it again — and whichever landed second won.
      // The visitor's own gesture would have decided it, at random.
      armed =
        window.matchMedia("(max-width: 640px)").matches &&
        e.isPrimary &&
        sheetRef.current !== "pill";
    };
    const settle = () => {
      if (!armed) return;
      armed = false;
      // Already parked → setSheetAndRefit sees no change and skips the refit,
      // so touching an already-full map costs nothing.
      setSheetAndRefit("pill");
    };

    el.addEventListener("pointerdown", down, { capture: true, passive: true });
    el.addEventListener("pointerup", settle, { capture: true, passive: true });
    el.addEventListener("pointercancel", settle, { capture: true, passive: true });
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointerup", settle, true);
      el.removeEventListener("pointercancel", settle, true);
    };
  }, [setSheetAndRefit]);

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
      className={`home${dragging ? " dragging" : ""}${
        tourWaiting ? " home--tour-waiting" : ""
      } home--sheet-${sheet}${panelOpen ? "" : " home--panel-closed"}`}
      style={{ "--guide-panel-w": `${guideW}px` } as CSSProperties}
    >
      <aside className="home-atlas" ref={atlasRef}>{atlas}</aside>
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
            {/* The label used to read "— swipe up", advertising a gesture as
                the way in, when the whole handle has always been tappable too.
                Naming the tap makes the sheet discoverable without teaching a
                gesture first; the swipe still works for those who try it. */}
            <span className="hch-label">
              The <b>Guide</b>
              {sheet === "full" ? " — tap to shrink" : " — tap to expand"}
            </span>
          </button>
          <button
            type="button"
            className="hch-map"
            aria-label="Hide the conversation and show the full map"
            onClick={() => setSheetAndRefit("pill")}
          >
            Full map ▾
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

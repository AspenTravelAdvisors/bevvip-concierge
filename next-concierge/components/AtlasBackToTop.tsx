"use client";

/*
 * "Back to top", on a phone.
 *
 * The atlas pages run several screens deep — a map band, a filter rail, a
 * count, then up to 120 cards — and the only way back to the map (and to the
 * filters that decide what the list even is) was to swipe the whole list back
 * up. That is a long way from card forty, and it is the one gesture the page
 * cannot help with: overscroll, the scrollbar and the URL bar all belong to the
 * browser. So the page offers the jump itself.
 *
 * Phones only. Desktop keeps the rail in view and has a scrollbar to drag, so
 * the same button would be clutter parked over the map.
 *
 * WHICH THING SCROLLS IS NOT FIXED, which is why this hunts for it instead of
 * calling `window.scrollTo` and hoping. /atlas/villa scrolls inside
 * `.villa-atlas` at every width, while the collection pages let the overflow
 * out to the body (see THE PAGE SCROLLS in globals.css) — and the body is a
 * scroll container in its own right here, so not even those move the window.
 * Same chrome, same gesture, three different things underneath it. The two
 * surfaces mark their own container `data-atlas-scroll`; a marked element
 * counts only while it is genuinely a scroller (hotel browse is one above 680px
 * and not below it), and `scroller()` falls through to the document and finally
 * the window.
 */

import { useCallback, useEffect, useState } from "react";
import { useIsMobile } from "@/lib/use-is-mobile";

/** How far down "scrolled down" starts: three quarters of a screen. */
const SHOW_AFTER = 0.75;

type Scroller = HTMLElement | Window;

const offsetOf = (s: Scroller) =>
  s === window ? window.scrollY : (s as HTMLElement).scrollTop;

const viewportOf = (s: Scroller) =>
  s === window ? window.innerHeight : (s as HTMLElement).clientHeight;

const scrolls = (el: HTMLElement) =>
  /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1;

/** Whatever is actually carrying this atlas's scroll, innermost first. */
function scroller(): Scroller {
  const candidates: HTMLElement[] = [
    ...document.querySelectorAll<HTMLElement>("[data-atlas-scroll]"),
    /*
     * `document.body`, and it is not a formality: `body` is `height: 100%` with
     * `overflow-x: hidden`, which makes it a scroll container in its own right,
     * so on the collection pages the list scrolls INSIDE the body element and
     * `window.scrollY` never leaves 0. Reading the window there would report a
     * page that has never moved — the button would never appear, and tapping it
     * would do nothing.
     */
    document.body,
    document.documentElement,
  ];
  return candidates.find(scrolls) ?? window;
}

export default function AtlasBackToTop({
  /** Focused after the jump, so the trip back is announced and not just made. */
  landing,
}: {
  landing?: React.RefObject<HTMLElement | null>;
}) {
  const phone = useIsMobile();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!phone) {
      setShown(false);
      return;
    }
    let queued = false;
    const measure = () => {
      queued = false;
      const s = scroller();
      setShown(offsetOf(s) > viewportOf(s) * SHOW_AFTER);
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    };
    // Capture, because a scroll event on a nested container does not bubble:
    // /atlas/villa scrolls inside itself and would otherwise never report.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    measure();
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  }, [phone]);

  const jump = useCallback(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = still ? "auto" : "smooth";
    const s = scroller();
    s.scrollTo({ top: 0, behavior });
    // The page may ALSO be scrolled: landing at the top of a list inside a
    // frame that has itself moved is still not the top of the atlas.
    if (s !== window) window.scrollTo({ top: 0, behavior });
    // Sighted travellers watch the map arrive; everyone else gets told.
    landing?.current?.focus({ preventScroll: true });
  }, [landing]);

  if (!phone) return null;

  return (
    <button
      type="button"
      className={`atlas-totop${shown ? " on" : ""}`}
      onClick={jump}
      // Hidden means gone, not merely invisible: a faded-out button that still
      // takes a tap (or a Tab stop) is worse than no button.
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
      title="Back to the top of the atlas"
      aria-label="Back to the top of the atlas"
    >
      <span aria-hidden="true">↑</span> Top
    </button>
  );
}

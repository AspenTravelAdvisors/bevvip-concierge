"use client";

// Intro tour overlay. A transparent, full-screen scrim that spotlights the real
// element behind it and floats a caption card beside it; where that element is
// hidden at this breakpoint the slide falls back to a centered card.
//
// IT NO LONGER OPENS ITSELF. It used to fire 700ms after first paint — seven
// dimming slides teaching the chrome before the visitor had seen any value,
// which converts curiosity into a dismissal reflex. It is now opt-in only, from
// "How this works" in the header (or a "bevvip:start-tour" event). A tour is a
// confession that the interface isn't self-evident; the fix for that is the
// interface, and everything else in this pass is that fix.
//
// It also got shorter. The slide explaining the desktop resize gutter is gone:
// a whole step of a guided tour spent on a layout preference almost nobody sets
// is a step spent not explaining what the product does.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { tourFinished } from "@/lib/analytics";

type Placement = "auto" | "center";

interface Slide {
  // CSS selector of the element to spotlight. Omitted → a centered slide.
  target?: string;
  // A centered slide still describes *something*. `requires` names the element
  // that has to be on the page for the slide to be worth showing — without it,
  // opening the tour from /answers would narrate a map that isn't there.
  requires?: string;
  // Preferred side for the caption card relative to the spotlight.
  placement?: Placement;
  badge: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    target: ".home-chat .composer",
    badge: "Asking",
    title: "Describe the trip in your own words",
    body: "A region, a season, an occasion, a hotel you already like — whatever you'd say to a person. You don't have to pick a category first; The Guide searches all seven and works out which ones fit.",
  },
  {
    // The map is the full-bleed stage — a spotlight ring around the whole
    // viewport reads as broken, so this slide centers over the open map.
    badge: "The map",
    title: "Answers land on the map",
    body: "Everything The Guide finds is plotted on the globe behind this card, so each suggestion has a place in the world you can zoom into. Click any pin to ask about it.",
    placement: "center",
    requires: ".atlas-map",
  },
  {
    target: ".nav-explore",
    badge: "Browsing",
    title: "Or browse the collection yourself",
    body: "Hotels, villas, expedition sailings, world cruises, rail journeys, hotel yachts and private jets — each on its own map, if you'd rather look around than ask.",
    placement: "auto",
  },
  {
    target: ".nav-cta",
    badge: "Advisors",
    title: "A person finishes the job",
    body: "Nothing here books itself. When you've found contenders — or if you'd rather just start with a human — this sends everything you've described to an Aspen Travel Advisors specialist, who replies within 24 hours.",
    placement: "auto",
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default function IntroTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  // The slides actually shown this run: SLIDES minus any whose subject isn't on
  // this page or at this breakpoint. Describing a control the traveler can't
  // see only confuses.
  const [slides, setSlides] = useState<Slide[]>(SLIDES);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);

  const slide = slides[step];
  const isLast = step === slides.length - 1;

  // Opt-in only — "How this works" in the header, or any other surface that
  // dispatches the event. There is deliberately no first-visit auto-open.
  useEffect(() => {
    function onStart() {
      setSlides(computeVisibleSlides());
      setStep(0);
      setOpen(true);
    }
    window.addEventListener("bevvip:start-tour", onStart);
    return () => window.removeEventListener("bevvip:start-tour", onStart);
  }, []);

  // How far anyone actually gets is the only evidence that will tell us whether
  // this should exist at all. Tracked through a ref so reporting it on close
  // doesn't schedule a state update on a closing overlay.
  const stepRef = useRef(0);
  stepRef.current = step;

  const close = useCallback(() => {
    setOpen(false);
    tourFinished(stepRef.current, slides.length);
  }, [slides.length]);

  // Measure the spotlight target whenever the slide, window size or scroll
  // changes. A missing/zero-size target (hidden on this breakpoint) → centered.
  const measure = useCallback(() => {
    if (!slide?.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(slide.target) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) {
      setRect(null);
      return;
    }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [slide]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  // Place the caption card: centered when there's no spotlight, otherwise on the
  // side of the target with the most room, clamped to stay on-screen.
  useLayoutEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    if (!card) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const M = 16; // viewport margin
    const GAP = 18; // gap between spotlight and card

    if (!rect || slide?.placement === "center") {
      // Centered slides position themselves in CSS (.tour-card.centered), so a
      // rotation/resize can never strand them — a JS-computed centre would go
      // stale: on resize measure() re-sets rect to null, React bails on the
      // identical value, and this effect would never re-run.
      setCardPos(null);
      return;
    }

    const spaceRight = vw - (rect.left + rect.width);
    const spaceLeft = rect.left;
    const spaceBelow = vh - (rect.top + rect.height);

    let left: number;
    let top: number;
    if (spaceRight >= cw + GAP + M) {
      // Card to the right of the spotlight.
      left = rect.left + rect.width + GAP;
      top = rect.top + rect.height / 2 - ch / 2;
    } else if (spaceLeft >= cw + GAP + M) {
      // Card to the left.
      left = rect.left - GAP - cw;
      top = rect.top + rect.height / 2 - ch / 2;
    } else if (spaceBelow >= ch + GAP + M) {
      // Card below (e.g. the header nav).
      top = rect.top + rect.height + GAP;
      left = rect.left + rect.width / 2 - cw / 2;
    } else {
      // Card above.
      top = rect.top - GAP - ch;
      left = rect.left + rect.width / 2 - cw / 2;
    }
    left = Math.max(M, Math.min(left, vw - cw - M));
    top = Math.max(M, Math.min(top, vh - ch - M));
    setCardPos({ top: Math.round(top), left: Math.round(left) });
  }, [open, rect, slide, step]);

  // Keyboard: Esc skips, arrows navigate.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, slides.length - 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, slides.length]);

  const next = () => {
    if (isLast) close();
    else setStep((s) => Math.min(s + 1, slides.length - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  if (!open || !slide) return null;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Take a tour">
      {/* The transparent scrim. With a spotlight, a ring with an enormous
          spread shadow dims everything *except* the highlighted element;
          without one, a plain dim backdrop sits behind the centered card. */}
      {rect ? (
        <div
          className="tour-spot"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      ) : (
        <div className="tour-scrim" onClick={close} />
      )}

      <div
        ref={cardRef}
        className={`tour-card${rect ? "" : " centered"}`}
        style={cardPos ? { top: cardPos.top, left: cardPos.left } : undefined}
      >
        {/* "Skip" made sense when the tour ambushed you. Opt-in, it's "Close". */}
        <button type="button" className="tour-skip" onClick={close}>
          Close
        </button>

        <div className="tour-badge">{slide.badge}</div>
        <h2 className="tour-title">{slide.title}</h2>
        <p className="tour-body">{slide.body}</p>

        <div className="tour-foot">
          <div className="tour-dots" aria-hidden="true">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`tour-dot${i === step ? " on" : ""}`}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
          <div className="tour-nav">
            {step > 0 && (
              <button type="button" className="tour-btn ghost" onClick={back}>
                Back
              </button>
            )}
            <button type="button" className="tour-btn primary" onClick={next}>
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// The slides to actually show this run: keep every targetless (centered) slide,
// and any whose spotlight target is currently on screen. Slides whose target is
// hidden at this breakpoint — the resize gutter on mobile, the map controls when
// the globe is in its fallback panel — drop out rather than describe something
// the traveler can't see.
function computeVisibleSlides(): Slide[] {
  return SLIDES.filter((s) => {
    if (s.requires && !document.querySelector(s.requires)) return false;
    if (!s.target) return true;
    const el = document.querySelector(s.target);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    // Off-viewport targets drop out too — on the map-first phone home the chat
    // sheet (and the empty-state chips inside it) park below the fold, where a
    // spotlight can't reach them.
    return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  });
}

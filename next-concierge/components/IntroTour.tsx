"use client";

// Intro "Take a tour" overlay. A transparent, full-screen scrim that walks a
// first-time traveler through the major parts of Base Camp in a few slides —
// The Guide, the quick-start prompts, the Living Atlas, its controls, the
// resize gutter and the header collections. Each slide spotlights the *real*
// element behind the scrim (a highlight ring punched out of the dim) and floats
// a caption card beside it; where that element is hidden (e.g. the gutter and
// globe collapse on mobile) the slide gracefully falls back to a centered card.
//
// It opens itself once per browser (a localStorage flag), carries a Skip button
// on every slide, and can be re-opened any time from the small "Tour" button it
// parks in the corner — or by dispatching a "bevvip:start-tour" event.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const SEEN_KEY = "bevvip.tour.seen";

type Placement = "auto" | "center";

interface Slide {
  // CSS selector of the element to spotlight. Omitted → a centered slide.
  target?: string;
  // Preferred side for the caption card relative to the spotlight.
  placement?: Placement;
  badge: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    badge: "Welcome",
    title: "This is Base Camp",
    body: "Your concierge for the world's most extraordinary journeys — approved hotels, expedition cruises, private jets and luxury hotel yachts, all in one place. Here's a 30-second tour of how it works.",
    placement: "center",
  },
  {
    target: ".home-chat",
    badge: "The Guide",
    title: "Ask The Guide anything",
    body: "Describe a region, a season, a hotel, or simply the kind of trip you're craving. The Guide frames the journey, searches the live collection and surfaces the right possibilities — conversationally.",
  },
  {
    target: ".chips",
    badge: "Quick start",
    title: "Or start with a prompt",
    body: "Not sure where to begin? Tap one of these starters. Each opens a real search — a hotel in a region, an expedition in a given month, two brands compared side by side — so you can see The Guide at work.",
  },
  {
    target: ".home-atlas",
    badge: "Living Atlas",
    title: "Watch it land on the globe",
    body: "The Living Atlas maps the entire collection worldwide. As The Guide returns recommendations, they're plotted right here — so every suggestion has a place on the map you can explore.",
  },
  {
    target: ".atlas-ctrls",
    badge: "Map controls",
    title: "Steer the view",
    body: "Go fullscreen, switch the basemap between Dark, Satellite and Warm, or flip between the 3D globe and a flat 2D map. Tap any pin to open its full atlas in a new tab.",
  },
  {
    target: ".home-gutter",
    badge: "Your layout",
    title: "Trade space as you like",
    body: "Drag this divider to give more room to the conversation or more room to the map — whichever you're leaning into. Your preference is remembered for next time.",
  },
  {
    target: "header.site nav",
    badge: "Collections",
    title: "Explore every collection",
    body: "Jump straight into a full atlas — Hotels, Expeditions, Jets, Yachts, World Cruises or Rail Journeys. And once you've found contenders, The Guide can hand your shortlist to an Aspen Travel Advisors specialist to take it from here.",
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
  // The slides actually shown this run: SLIDES minus any whose spotlight target
  // isn't on screen at this breakpoint (e.g. the resize gutter, which is hidden
  // on mobile — describing a control the traveler can't see only confuses).
  const [slides, setSlides] = useState<Slide[]>(SLIDES);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);

  const slide = slides[step];
  const isLast = step === slides.length - 1;

  // Open once per browser on first visit, plus on an explicit request.
  useEffect(() => {
    // Never auto-open inside an iframe: the marketing landers embed /atlas/*
    // (and Base Camp itself) as dimmed hero backgrounds, where the welcome
    // card would bleed through behind the lander's own headline.
    if (window.self !== window.top) return;
    // The slides spotlight home-page elements (.home-chat, .chips, the globe),
    // so first-visit auto-open only makes sense on the home route.
    if (window.location.pathname !== "/") return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* storage blocked: treat as unseen, but never crash */
    }
    if (!seen) {
      // Wait a beat so the chat + globe have painted and can be spotlighted.
      const t = window.setTimeout(() => {
        setSlides(computeVisibleSlides());
        setStep(0);
        setOpen(true);
      }, 700);
      return () => window.clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    function onStart() {
      setSlides(computeVisibleSlides());
      setStep(0);
      setOpen(true);
    }
    window.addEventListener("bevvip:start-tour", onStart);
    return () => window.removeEventListener("bevvip:start-tour", onStart);
  }, []);

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* best effort */
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    markSeen();
  }, [markSeen]);

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
        <button type="button" className="tour-skip" onClick={close}>
          Skip
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
              {isLast ? "Get started" : "Next"}
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
    if (!s.target) return true;
    const el = document.querySelector(s.target);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  });
}

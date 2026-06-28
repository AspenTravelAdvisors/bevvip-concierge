"use client";

import { useEffect, useState } from "react";
import GuideChat from "./GuideChat";

// The Guide in atlas view. It lives in a slim bottom button bar that sits below
// the embedded atlas (so the atlas's own dock stays visible just above it).
// Tapping the bar pops a semi-transparent sheet up over the map; the Guide's
// transcript and result cards populate upward from the input pinned at the
// sheet's foot, exactly as on the home page. The sheet minimizes back down to
// just the bar. GuideChat persists its conversation to sessionStorage, so a
// chat started on the Base Camp home carries straight into atlas view.
export default function AtlasGuideDock({ atlasLabel }: { atlasLabel: string }) {
  const [open, setOpen] = useState(false);
  // Mount GuideChat lazily — only once the sheet has been opened — so its
  // session restore / deep-link (?ask=) handling doesn't fire behind a closed
  // sheet, and the atlas gets the first paint to itself.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Esc minimizes the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`atlas-dock${open ? " atlas-dock--open" : ""}`}>
      <div className="atlas-guidesheet" aria-hidden={!open}>
        <div className="ags-grip">
          <span className="ags-grip-where">{atlasLabel}</span>
          <button
            type="button"
            className="ags-min"
            onClick={() => setOpen(false)}
            aria-label="Minimize The Guide"
            title="Minimize"
          >
            Minimize ↓
          </button>
        </div>
        <div className="ags-body">{mounted && <GuideChat />}</div>
      </div>

      <button
        type="button"
        className="atlas-guidebar"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="agb-av">G</span>
        <span className="agb-label">
          Ask <b>The Guide</b>
        </span>
        <span className="agb-hint">Hotels, cruises, jets &amp; yachts — mapped as you ask</span>
        <span className="agb-chev" aria-hidden="true">
          {open ? "▾" : "▴"}
        </span>
      </button>
    </div>
  );
}

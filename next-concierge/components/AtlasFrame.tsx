"use client";

// AtlasFrame — the consistent chrome around every collection map.
//
// Base Camp has three different map products: the Mapbox globe on the home
// page, six iframed Leaflet apps under /maps/*, and a server-rendered villa
// browser. They share no interaction grammar, no controls, no visual language
// and no state, so a visitor who learns one has learned nothing about the next.
// Unifying them for real is a port, not a patch, and it is scoped as its own
// project.
//
// What this does in the meantime is make the *frame* consistent: every
// collection route now opens with the same bar — where you are, how big the
// collection is, how to get back, and the one thing the foreign UI inside the
// iframe cannot offer you, which is a way to ask a question instead of
// operating a filter. That last part matters most: these maps are browse
// surfaces, and a visitor who is lost in one has, until now, had no route out
// except the browser's back button (unreliable across an iframe).
//
// The ask no longer costs the page. The Guide is mounted here as a dock, so a
// question is answered beside the map rather than by navigating away from it —
// which also gives every per-card, per-pin and per-property ask somewhere local
// to land. See components/AtlasGuideDock and lib/atlas/ask.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { OfferingType } from "@/lib/types";
import { ATLASES, collectionPhrase } from "@/lib/atlas-config";
import AtlasGuideDock from "./AtlasGuideDock";
import AtlasBackToTop from "./AtlasBackToTop";
import { askGuide, askGuideHref } from "@/lib/atlas/ask";

export default function AtlasFrame({
  type,
  children,
}: {
  type: OfferingType;
  children: React.ReactNode;
}) {
  const atlas = ATLASES[type];
  const router = useRouter();
  const [ask, setAsk] = useState("");
  // Where "back to top" lands, for anyone who cannot see that it happened.
  const titleRef = useRef<HTMLHeadingElement>(null);

  /**
   * Ask without leaving.
   *
   * This used to be `router.push("/?ask=…")` unconditionally — a question about
   * this collection, answered by throwing this collection away. The Guide is
   * mounted on this page now (AtlasGuideDock below), so the ask goes straight
   * into it and its results plot onto the map that is already open. The
   * navigation survives as the fallback for any surface without a chat.
   */
  const submit = () => {
    const q = ask.trim();
    if (!q) return;
    setAsk("");
    if (!askGuide(q, "strip")) router.push(askGuideHref(q, `atlas-${type}`));
  };

  return (
    <div className="atlas-frame-wrap">
      <div className="afw-bar">
        <div className="afw-where">
          <Link className="afw-back" href="/">
            ← The Guide
          </Link>
          <div className="afw-title">
            {/* `tabIndex={-1}`: not in the tab order, but focusable on purpose
                — AtlasBackToTop moves focus here so a screen reader says where
                the jump landed. */}
            <h1 ref={titleRef} tabIndex={-1}>
              {atlas.nav}
            </h1>
            <p>
              {collectionPhrase(atlas)} · {atlas.tagline}
            </p>
          </div>
        </div>

        <div className="afw-actions">
          <div className="afw-ask">
            <input
              type="text"
              value={ask}
              placeholder={`Ask about ${atlas.nav.toLowerCase()}…`}
              aria-label={`Ask The Guide about ${atlas.nav}`}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button type="button" onClick={submit} disabled={!ask.trim()}>
              Ask
            </button>
          </div>
          {/* The "Talk to an advisor" button used to live here too, directly
              under the identical one in SiteNav — two controls, same label,
              same modal, nine inches apart. The header's is app-wide and
              always visible, so this one only added noise. */}
        </div>
      </div>
      {children}
      {/*
        The Guide itself, as a dock over the collection.

        It is the same chat, the same session and the same plotting as the home
        page — so a shortlist asked for here appears on this map, and the
        per-card and per-pin asks stop being links out of the product.
      */}
      <AtlasGuideDock />
      {/*
        The way back up, on a phone.

        Every atlas under this frame is a long scroll — the map, the filters and
        the count all live at the top of it, and reaching them again from card
        forty was a swipe with no end in sight. It sits above the Guide's
        launcher rather than beside it: the bottom-right corner is spoken for,
        and the filter bar owns the rest of that strip.
      */}
      <AtlasBackToTop landing={titleRef} />
    </div>
  );
}

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

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OfferingType } from "@/lib/types";
import { ATLASES, collectionPhrase } from "@/lib/atlas-config";
import { openAdvisor, ADVISOR_CTA_COLD } from "./AdvisorRequest";

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

  // Hand the question to The Guide on the home page, which owns the chat and
  // the plotting. ?ask= is the existing deep-link contract.
  const submit = () => {
    const q = ask.trim();
    if (!q) return;
    router.push(`/?ask=${encodeURIComponent(q)}&src=atlas-${type}`);
  };

  return (
    <div className="atlas-frame-wrap">
      <div className="afw-bar">
        <div className="afw-where">
          <Link className="afw-back" href="/">
            ← The Guide
          </Link>
          <div className="afw-title">
            <h1>{atlas.nav}</h1>
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
          <button
            type="button"
            className="afw-advisor"
            onClick={() => openAdvisor({ source: "atlas" })}
          >
            {ADVISOR_CTA_COLD}
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { askGuide, askGuideHref } from "@/lib/atlas/ask";

// The in-app atlas surface: the original standalone atlas (its own Leaflet/3D
// map, filters and dock) rendered as-is inside an iframe. It shares Base Camp's
// origin (the page is copied into public/maps/<type>/), so its relative fetches
// and the Hotel Atlas API proxy (see next.config.ts) just work.
//
// The Guide is now mounted on the page AROUND this iframe (AtlasFrame's dock),
// so an ask from inside the frame no longer has to navigate: the embedded page
// posts { type: "ATLAS_ASK", text } up, and this relays it onto the same event
// bus every other ask affordance uses. The iframe cannot reach the chat itself
// — that is the whole nature of an iframe — but it can hand the question over.
// With `hero` (from /atlas/<type>?hero=1) the view is an ambient backdrop for
// the marketing landers: Base Camp's header is hidden via .atlas-view--hero.
export default function AtlasView({
  label,
  src,
  hero = false,
}: {
  label: string;
  src: string;
  hero?: boolean;
}) {
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Same-origin only: the embedded atlases are served from this app's own
      // public/ directory, so anything else posting here is not one of them.
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; text?: string } | null;
      if (data?.type !== "ATLAS_ASK") return;
      const text = String(data.text || "").trim();
      if (!text) return;
      if (!askGuide(text, "card")) window.location.assign(askGuideHref(text, "atlas-embed"));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className={`atlas-view${hero ? " atlas-view--hero" : ""}`}>
      <iframe className="atlas-frame" src={src} title={`${label} — interactive map`} />
    </div>
  );
}

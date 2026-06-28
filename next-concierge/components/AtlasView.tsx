"use client";

import type { OfferingType } from "@/lib/types";
import AtlasGuideDock from "./AtlasGuideDock";

// The in-app atlas surface: the original standalone atlas (its own Leaflet map,
// filters and dock) rendered as-is inside an iframe, with The Guide overlaid as
// a minimizable bottom sheet. The iframe shares Base Camp's origin (the page is
// copied into public/maps/<type>/), so its own relative fetches and the Hotel
// Atlas API proxy (see next.config.ts) just work, and we keep the door open to
// postMessage coupling later without a cross-origin barrier.
export default function AtlasView({
  type,
  label,
  src,
}: {
  type: OfferingType;
  label: string;
  src: string;
}) {
  return (
    <div className="atlas-view">
      <iframe className="atlas-frame" src={src} title={`${label} — Living Atlas`} />
      <AtlasGuideDock atlasLabel={label} />
    </div>
  );
}

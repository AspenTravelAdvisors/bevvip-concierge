"use client";

// components/ArrivalCapture.tsx — records which AI assistant, if any, sent this
// visitor, on the first page they land on. Renders nothing. See lib/arrival.ts.

import { useEffect } from "react";
import { aiArrival } from "@/lib/analytics";
import { captureArrival } from "@/lib/arrival";

export default function ArrivalCapture() {
  useEffect(() => {
    // `track()` drops an event outright when window.va does not exist yet, and
    // on first load it does not: <Analytics /> from @vercel/analytics/next
    // renders inside its own Suspense boundary (it reads useSearchParams), so
    // it mounts AFTER this effect has run. Every ai_arrival was lost that way —
    // none reached the dashboard in the first five days, while the later,
    // click-driven events arrived fine. Creating the queue here is the same
    // stub the library's own initQueue installs; its script drains `vaq` when
    // it loads, and its initQueue leaves an existing stub alone.
    if (!window.va) {
      // Window.va / Window.vaq are declared by @vercel/analytics itself.
      window.va = (event, properties) => {
        (window.vaq ??= []).push([event, properties]);
      };
    }
    const a = captureArrival();
    if (a) aiArrival(a.source, a.via, a.landing);
  }, []);
  return null;
}

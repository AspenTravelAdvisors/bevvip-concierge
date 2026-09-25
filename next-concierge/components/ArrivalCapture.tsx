"use client";

// components/ArrivalCapture.tsx — records which AI assistant, if any, sent this
// visitor, on the first page they land on. Renders nothing. See lib/arrival.ts.

import { useEffect } from "react";
import { aiArrival } from "@/lib/analytics";
import { captureArrival } from "@/lib/arrival";

export default function ArrivalCapture() {
  useEffect(() => {
    const a = captureArrival();
    if (a) aiArrival(a.source, a.via, a.landing);
  }, []);
  return null;
}

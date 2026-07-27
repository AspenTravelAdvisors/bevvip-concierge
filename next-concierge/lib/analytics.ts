// lib/analytics.ts — the lead funnel, in one place.
//
// Every design decision in this app was previously argued from taste, because
// nothing was measured. These are the five moments that decide whether Base
// Camp works as a lead engine, in order:
//
//   ask_sent → results_returned → advisor_cta_clicked → advisor_request_sent
//
// with booking_clicked as the parallel self-serve path. Anything that isn't on
// one of those two paths does not belong in this file: a metric nobody will act
// on is noise that makes the real numbers harder to read.
//
// Vercel Analytics only records custom events in production with the
// <Analytics /> component mounted (see app/layout.tsx). In dev, `track` is a
// no-op, so calling these is always safe.

import { track } from "@vercel/analytics";

type Props = Record<string, string | number | boolean | null>;

/** Where an ask entered the pipeline. Tells us which opening move actually works. */
export type AskSource = "composer" | "chip" | "strip" | "deeplink" | "dock" | "quickreply";

/** Where the advisor form was opened from. */
export type AdvisorSource = "chat" | "header" | "atlas";

function emit(event: string, props?: Props) {
  try {
    track(event, props);
  } catch {
    /* analytics must never break a user flow */
  }
}

export function askSent(source: AskSource, isFirst: boolean) {
  emit("ask_sent", { source, first: isFirst });
}

export function resultsReturned(type: string, count: number) {
  emit("results_returned", { type: type || "none", count });
}

export function advisorCtaClicked(category: string, source: AdvisorSource) {
  emit("advisor_cta_clicked", { category, source });
}

export function advisorRequestSent(category: string, shortlist: number) {
  emit("advisor_request_sent", { category, shortlist });
}

/** The self-serve path. `hasDates` separates real intent from a default stay. */
export function bookingClicked(type: string, hasDates: boolean) {
  emit("booking_clicked", { type, hasDates });
}

export function atlasOpened(type: string, source: "card" | "shortlist" | "nav") {
  emit("atlas_opened", { type, source });
}

/** Did anyone want the tour once it stopped opening itself? */
export function tourOpened() {
  emit("tour_opened");
}

export function tourFinished(step: number, total: number) {
  emit("tour_finished", { step, total, completed: step >= total - 1 });
}

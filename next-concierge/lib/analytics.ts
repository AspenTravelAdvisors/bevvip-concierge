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
export type AskSource =
  | "composer"
  | "chip"
  | "strip"
  | "deeplink"
  | "dock"
  | "quickreply"
  /** A map pin's popup — hotel field, or a plotted recommendation. */
  | "pin"
  /** A card in a collection's result list. */
  | "card"
  /** The property dossier, including the one beside the photoreal view. */
  | "dossier";

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

/**
 * A basemap never finished loading and the globe fell back to a classic style.
 *
 * On its face this breaks the "only the lead funnel belongs here" rule above —
 * it isn't an ask or a booking. It earns its place because the globe silently
 * failing IS a funnel event: on 2026-07-29 both Mapbox Standard-family styles
 * (standard-satellite and standard) stopped completing `style.load` for this
 * token, with every dependency still returning 200 and no error event, and the
 * home page showed "Map unavailable" instead of the thing the whole first
 * impression rests on. Nothing measured it. If it recurs we should see it in
 * the numbers, not by someone happening to load the page.
 */
export function mapStyleFallback(from: string, to: string) {
  emit("map_style_fallback", { from, to });
}

/**
 * A traveller opened the Google Photorealistic 3D view of a specific property.
 *
 * The work order calls this "the single most persuasive thing the app does",
 * and it has never been measured — so nobody knows whether anyone reaches it.
 * If the answer turns out to be "almost no one", that is an argument about
 * placement, not about the feature.
 */
export function hotel3dOpened(hotelId: string, source: "card" | "popup" | "engine") {
  emit("hotel_3d_opened", { hotelId, source });
}

/**
 * The photoreal engine was chosen on a map that offers it.
 *
 * `hotel_3d_opened` counts arrivals at ONE property's view; this counts someone
 * choosing to browse in 3D at all, which is a different question and the one
 * that says whether the engine earns its place in the menu. `ok` separates
 * "chose it and got it" from "chose it and the tiles never came" — the second
 * used to be indistinguishable from the first, because both showed a map.
 */
export function mapEngineChosen(type: string, engine: "mapbox" | "photoreal", ok: boolean) {
  emit("map_engine_chosen", { type, engine, ok });
}

/** Did anyone want the tour once it stopped opening itself? */
export function tourOpened() {
  emit("tour_opened");
}

export function tourFinished(step: number, total: number) {
  emit("tour_finished", { step, total, completed: step >= total - 1 });
}

/**
 * The home globe's scripted demonstration — `/?demo`.
 *
 * A capture mode, not a feature a traveller meets. It exists because the
 * legend is a FOCUS control (see soloLayer in AtlasShell): it can show one
 * collection or all of them, never "these three so far", so the one story the
 * globe tells best — watch it fill — could not be filmed by clicking. The demo
 * stages that build itself, then hands the floor to the real Guide answering a
 * real question live, which is the part no screen recording of a static site
 * can fake.
 *
 *   /?demo               the full script, ending on the default question
 *   /?demo=<question>    the same script, asking this instead (for a client)
 *   /?demo=layers        the build and the total only — no question asked
 *
 * Everything that reads the flag reads it from here, so "is this a demo" has
 * one answer across the shell, the split, the chat and the overlay.
 */

import type { OfferingType } from "./types";

export const DEMO_PARAM = "demo";

/**
 * Asked when `?demo` carries no question of its own.
 *
 * Two collections in one sentence on purpose: the Guide answers it with a
 * safari search AND a hotel search, so the globe plots a shortlist that no
 * single legend row could have produced. That is the beat the demo is for.
 */
export const DEMO_DEFAULT_QUESTION =
  "Two weeks in Africa next spring: the Great Migration on safari, then somewhere spectacular in Cape Town to finish.";

/**
 * The order collections switch on: sparsest first, densest last.
 *
 * By catalogue size rather than by the Explore menu's `order`, because the
 * build is a crescendo — 109 trains and 125 jets read as scattered points, and
 * the frame should only fill up once the villas and expedition sailings land.
 * Every collection is listed; the overlay skips any that is not on this globe.
 */
export const DEMO_BUILD_ORDER: OfferingType[] = [
  "train",
  "jet",
  "worldcruise",
  "safari",
  "yacht",
  "hotel",
  "villa",
  "cruise",
];

export type DemoMode = { kind: "off" } | { kind: "layers" } | { kind: "ask"; question: string };

/** What `?demo` asks for on this page load. Client only; "off" on the server. */
export function demoMode(): DemoMode {
  if (typeof window === "undefined") return { kind: "off" };
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(window.location.search).get(DEMO_PARAM);
  } catch {
    return { kind: "off" };
  }
  if (raw === null) return { kind: "off" };
  const value = raw.trim();
  if (value.toLowerCase() === "layers") return { kind: "layers" };
  // `?demo`, `?demo=` and `?demo=1` all mean the default script.
  if (!value || value === "1" || value.toLowerCase() === "true") {
    return { kind: "ask", question: DEMO_DEFAULT_QUESTION };
  }
  return { kind: "ask", question: value };
}

export function demoRequested(): boolean {
  return demoMode().kind !== "off";
}

/**
 * The stage: which collections the globe draws at all. `null` is "every
 * collection", the normal state; an array is the demo's partial build.
 */
export interface DemoStageDetail {
  keys: string[] | null;
}

/** Atlas → demo: the collections whose pins are on the map. */
export interface DemoLoadedDetail {
  keys: string[];
}

/** Demo → home split: show or park The Guide. */
export interface DemoGuideDetail {
  open: boolean;
}

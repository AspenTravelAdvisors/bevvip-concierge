// lib/trip-state.ts — shared trip state (BOOKING-SPEC §1).
// One where/when/who object, persisted per browser session beside the Guide
// transcript, readable by every surface that renders a booking CTA. No
// component touches storage directly; this module owns read/write/subscribe.

import type { TripState } from "./types";

const STORAGE_KEY = "bevvip.trip";
const EVENT = "bevvip:trip";

const EMPTY: TripState = {
  destination: null,
  checkIn: null,
  checkOut: null,
  adults: 2,
  childrenAges: [],
  source: "guide",
  updatedAt: "",
};

export function getTrip(): TripState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<TripState>) };
  } catch {
    return null;
  }
}

// Merge a partial capture into the stored trip. Last write wins field-by-field:
// chat can refine what the strip captured and vice versa. Broadcasts the new
// state on `bevvip:trip` so already-rendered CTAs can light up.
export function setTrip(
  patch: Partial<Omit<TripState, "source" | "updatedAt">>,
  source: TripState["source"],
): TripState | null {
  if (typeof window === "undefined") return null;
  const next: TripState = {
    ...EMPTY,
    ...(getTrip() ?? {}),
    ...prune(patch),
    source,
    updatedAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: state still broadcast for this page's lifetime */
  }
  window.dispatchEvent(new CustomEvent<TripState>(EVENT, { detail: next }));
  return next;
}

export function clearTrip(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing persisted to clear */
  }
  window.dispatchEvent(new CustomEvent<TripState | null>(EVENT, { detail: null }));
}

export function onTrip(cb: (trip: TripState | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<TripState | null>).detail ?? null);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

// Drop undefined/null patch fields so a partial capture (dates but no party)
// never wipes values another writer already set.
function prune<T extends object>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

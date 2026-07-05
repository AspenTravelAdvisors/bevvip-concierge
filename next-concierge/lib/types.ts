// Shared wire types for the Guide SSE stream (/api/guide).
// The frame protocol matches the original Vercel function so either
// frontend can talk to either backend during the migration.

export type OfferingType = "hotel" | "cruise" | "jet" | "yacht" | "worldcruise";

export interface OfferingResult {
  id?: string;
  name?: string;
  brand?: string;
  operator?: string;
  city?: string;
  country?: string;
  region?: string;
  category?: string;
  duration?: string;
  dates?: string;
  price?: string;
  deepLink?: string | null;
  [key: string]: unknown;
}

export interface GuideToolMeta {
  input: Record<string, unknown>;
  type?: string;
  total?: number;
  count?: number;
  deepLink?: string | null;
  chartRegion?: string | null;
  unavailable?: boolean;
  sources?: unknown;
  results: OfferingResult[];
  related?: unknown;
  trip?: TripParams;
}

// Dates/party the Guide extracted from the conversation, echoed back on the
// tool meta so the client can persist them into the shared TripState.
export interface TripParams {
  checkIn?: string;        // "YYYY-MM-DD"
  checkOut?: string;       // "YYYY-MM-DD"
  adults?: number;
  childrenAges?: number[];
}

// Shared trip state (BOOKING-SPEC §1): the single where/when/who object every
// booking CTA reads. Owned by lib/trip-state.ts over sessionStorage.
export interface TripState {
  destination: string | null;  // free text as the traveler gave it
  checkIn: string | null;      // "YYYY-MM-DD"
  checkOut: string | null;     // "YYYY-MM-DD"
  adults: number;              // default 2
  childrenAges: number[];      // ages, not just a count — booking engines price by age
  source: "strip" | "guide";   // who captured it last
  updatedAt: string;           // ISO timestamp
}

export interface GuideMeta {
  deepLink: string | null;
  chartRegion: string | null;
  tools: GuideToolMeta[];
  stopReason?: string;
}

export type GuideFrame =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | ({ type: "meta" } & GuideMeta)
  | { type: "done" }
  | { type: "error"; error: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Shared wire types for the Guide SSE stream (/api/guide).
// The frame protocol matches the original Vercel function so either
// frontend can talk to either backend during the migration.

export type OfferingType = "hotel" | "cruise" | "jet" | "yacht" | "worldcruise" | "train" | "villa";

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
  /**
   * The search deliberately returned nothing because the category is sourced by
   * an advisor rather than from live inventory (ordinary Luxury Cruise sailings).
   * Distinct from `unavailable`, which means a feed could not be reached.
   */
  advisorOnly?: boolean;
  sources?: unknown;
  results: OfferingResult[];
  related?: unknown;
  trip?: TripParams;
}

// Dates/party the Guide extracted from the conversation, echoed back on the
// tool meta so the client can persist them into the shared TripState.
export interface TripParams {
  destination?: string;    // free text, as resolved from the search's geography
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

/**
 * What a search_experiences call found, when a turn made one.
 *
 * Deliberately OUTSIDE `tools`. The experiences themselves stay prose-only —
 * they carry no pricing and no booking path, so they must never become cards
 * or a map plot (see app/api/guide/route.ts). But the funnel needs to know the
 * call happened and what came back, and the chat needs to know not to re-offer
 * a question it has just answered. A summary beside the tool list gives both
 * without putting a non-bookable record anywhere near leadTool.
 */
export interface ExperiencesMeta {
  /** Experiences that matched, before the per-group limit. */
  total: number;
  /** How many of those were Private or Elevate — the advisor's picks. */
  preferredCount: number;
  /** The catalogue could not be reached, or is not configured. */
  unavailable: boolean;
  /** The place asked about, as the Guide resolved it. */
  place?: string | null;
}

export interface GuideMeta {
  deepLink: string | null;
  chartRegion: string | null;
  tools: GuideToolMeta[];
  experiences?: ExperiencesMeta | null;
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

/** A transcript entry: the message plus whatever inventory that turn surfaced. */
export interface GuideTurn extends ChatMessage {
  meta?: GuideMeta;
}

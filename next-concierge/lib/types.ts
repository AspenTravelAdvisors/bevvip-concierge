// Shared wire types for the Guide SSE stream (/api/guide).
// The frame protocol matches the original Vercel function so either
// frontend can talk to either backend during the migration.

export type OfferingType = "hotel" | "cruise" | "jet" | "yacht";

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

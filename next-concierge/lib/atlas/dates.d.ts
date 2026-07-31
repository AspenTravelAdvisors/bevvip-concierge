/**
 * Types for lib/atlas/dates.js.
 *
 * The implementation is CommonJS because the five query backends
 * (lib/atlas/*.js) `require` it, and those are loaded by API routes that
 * predate the TS layer. Three TypeScript callers — voyage.ts, cruise.ts,
 * AtlasCollection.tsx — and one more in lib/offering-shape.ts import the same
 * module, so it needs declarations rather than whatever `allowJs` infers from
 * the parameter defaults (which would type `{ nights = null }` as `null` and
 * reject a real number).
 *
 * Declaring it here keeps ONE implementation of the date rules. A parallel
 * .ts copy for the TS callers is the obvious alternative and the wrong one:
 * the whole reason this module exists is that six feeds' date handling had
 * drifted into six places.
 */

/** A record from any atlas collection, as far as the date rules care. */
export interface DatedRecord {
  startDate?: string | null;
  endDate?: string | null;
  /** Some feeds name the human range `dates`; it outranks `startDate`. */
  dates?: string | null;
  nights?: number | null;
  days?: number | null;
  /** On-demand booking window, e.g. "Jan 2026 – Dec 2027". */
  window?: string | null;
  onDemand?: boolean;
  /** Backends call it `name`, the globe's AtlasOffering calls it `title`. */
  name?: string | null;
  title?: string | null;
}
// Deliberately NO `[key: string]: unknown` index signature. Adding one would
// make this assignable from `Record<string, unknown>`, but it would also make
// AtlasOffering — a precise interface with no index signature — fail to match,
// which is the type the globe's cards actually pass.

/** Today as `YYYY-MM-DD`, local-time — a traveler's "today", not UTC's. */
export function todayISO(now?: Date): string;

/** Any upstream date shape to `YYYY-MM-DD`; null when there is no date. */
export function normalizeStartDate(raw: unknown): string | null;

/** Has this record already departed? On-demand and dateless are never past. */
export function isPast(record: DatedRecord | null | undefined, today?: string): boolean;

/** The inverse of isPast, for use as an Array#filter predicate. */
export function isCurrent(record: DatedRecord | null | undefined, today?: string): boolean;

/** Drop everything that has already departed. */
export function dropPast<T extends DatedRecord>(list: readonly T[], today?: string): T[];

/** Split an ISO day into numeric parts; null if unparseable. */
export function isoParts(iso: unknown): { y: number; m: number; d: number } | null;

/** Shift an ISO day by N days, in UTC. */
export function addDays(iso: string | null | undefined, n: number): string | null;

/** End date from a start plus a duration. Nights add N; days add N-1. */
export function endFrom(
  startIso: string | null | undefined,
  duration?: { nights?: number | null; days?: number | null },
): string | null;

/** The end half of a "25 Oct 2026 - 01 Nov 2026" range string. */
export function rangeEndFromString(raw: unknown): string | null;

/** "25 Oct 2026", or "25 Oct" when suppressing a year the caller prints once. */
export function formatDay(iso: string | null | undefined, withYear?: boolean): string | null;

/** Start, end and year: "25 Oct – 1 Nov 2026" / "23 Dec 2026 – 2 Jan 2027". */
export function formatRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string | null;

/** The whole "when" line for a record, whatever collection it came from. */
export function whenLabelFor(record: DatedRecord | null | undefined): string | null;

/** Sort modes the atlas card list offers. */
export type SortMode = "departure" | "duration-desc" | "duration-asc" | "name";
export const SORT_MODES: readonly SortMode[];

/** Sortable departure day, or null for on-demand and dateless records. */
export function departureKey(record: DatedRecord | null | undefined): string | null;

/** Nights or days, whichever the collection counts in; null if neither. */
export function durationDays(record: DatedRecord | null | undefined): number | null;

export function compareByDeparture(a: DatedRecord, b: DatedRecord): number;
export function compareByDuration(a: DatedRecord, b: DatedRecord, direction?: "asc" | "desc"): number;
export function compareByName(a: DatedRecord, b: DatedRecord): number;

/** Comparator for a sort mode; unknown modes fall back to departure. */
export function compareBy<T extends DatedRecord>(mode: string | null | undefined): (a: T, b: T) => number;

/** Non-mutating sort by mode. */
export function sortOfferings<T extends DatedRecord>(list: readonly T[], mode?: string): T[];

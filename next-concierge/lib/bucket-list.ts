// lib/bucket-list.ts — the traveler's bucket list, in one place.
//
// The product is called the Expedition Bucket List and, until now, nothing in
// it could be put ON a list. A traveler who found a Nell suite, an Antarctic
// sailing and a villa in Mustique over three sessions had one way to keep them:
// browser tabs. Everything they had chosen was lost the moment they closed one,
// and the advisor hand-off could only ever carry whatever the LAST search
// happened to return — the results of a query, not a set of decisions.
//
// So this module owns a saved set, the way lib/trip-state owns where/when/who:
// nothing else touches storage, every writer broadcasts, and every surface that
// can save something shares one definition of what "saved" means.
//
// Storage is localStorage, matching lib/trip-state and lib/conversation-store,
// and for the same reason — travel research spans days, not tabs. Unlike those
// two, this one also listens for `storage` events: the Explore menu opens
// collections in new tabs, so a list built in one tab has to be true in the
// others.

import { useCallback, useSyncExternalStore } from "react";
import type { OfferingType } from "./types";

const STORAGE_KEY = "bevvip.bucketlist";
const EVENT = "bevvip:bucketlist";

/**
 * A ceiling, so the list stays a list.
 *
 * Not a storage limit — 200 of these is ~60 KB, nowhere near a quota. It is the
 * same argument the result cards make: a "bucket list" of 200 sailings is a
 * search result with extra steps, and it is not something an advisor can act
 * on. Saving past the cap drops the OLDEST entry, so the control never refuses
 * a save and never has to explain itself.
 */
export const BUCKET_LIST_MAX = 60;

/**
 * One saved offering.
 *
 * Deliberately denormalized: the title, the where/when line and the thumbnail
 * are copied in at save time rather than looked up later. The list spans seven
 * collections whose records live in seven different feeds, and a bucket-list
 * page that had to fetch all of them to draw a row would be slow, would break
 * offline, and would show blanks for anything a feed had since dropped. A saved
 * item is a note about a decision, and it should still read as one after the
 * sailing sells out.
 */
export interface SavedItem {
  /** `${type}:${id}` — stable identity across every surface that can save. */
  key: string;
  type: OfferingType;
  /** The collection's own record id, as its atlas deep links use it. */
  id: string;
  title: string;
  /** The where/when line, already composed by whichever card saved it. */
  subtitle?: string | null;
  /** Brand, operator or program — what an advisor would name it by. */
  brand?: string | null;
  thumb?: string | null;
  /** Internal route back to it on the atlas, when the surface knows one. */
  href?: string | null;
  /** The supplier's own page, when there is one. */
  url?: string | null;
  /** ISO timestamp. Sorts the list newest-first and dates it for an advisor. */
  savedAt: string;
}

/** What a caller supplies; `key` and `savedAt` are ours to assign. */
export type SavedItemInput = Omit<SavedItem, "key" | "savedAt">;

/** The identity two surfaces must agree on to mean the same offering. */
export function bucketKey(type: OfferingType, id: string): string {
  return `${type}:${id}`;
}

const EMPTY: SavedItem[] = [];

/**
 * The parsed list, held so `getSnapshot` can return the same reference twice.
 *
 * useSyncExternalStore compares snapshots by identity and re-renders forever if
 * a fresh array comes back each call, so reads are cached and every write path
 * — ours, and another tab's — clears it.
 */
let cache: SavedItem[] | null = null;

export function getBucketList(): SavedItem[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache) return cache;
  cache = parse(safeRead());
  return cache;
}

export function isSaved(key: string): boolean {
  return getBucketList().some((i) => i.key === key);
}

export function bucketListCount(): number {
  return getBucketList().length;
}

/**
 * Save an offering, newest first. Saving one already on the list refreshes its
 * details (a card knows more than a map pin does) rather than duplicating it.
 */
export function saveItem(input: SavedItemInput): SavedItem[] {
  const key = bucketKey(input.type, input.id);
  const item: SavedItem = { ...input, key, savedAt: new Date().toISOString() };
  const rest = getBucketList().filter((i) => i.key !== key);
  return commit([item, ...rest].slice(0, BUCKET_LIST_MAX));
}

export function removeItem(key: string): SavedItem[] {
  const next = getBucketList().filter((i) => i.key !== key);
  return commit(next);
}

/** Save or unsave in one call. Returns whether the item is now on the list. */
export function toggleItem(input: SavedItemInput): boolean {
  const key = bucketKey(input.type, input.id);
  if (isSaved(key)) {
    removeItem(key);
    return false;
  }
  saveItem(input);
  return true;
}

export function clearBucketList(): SavedItem[] {
  return commit([]);
}

/** Subscribe to changes from this tab or any other. Returns an unsubscribe. */
export function onBucketList(cb: (items: SavedItem[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const local = (e: Event) => cb((e as CustomEvent<SavedItem[]>).detail ?? EMPTY);
  // Another tab wrote: the cache is stale, so drop it before reading back.
  const cross = (e: StorageEvent) => {
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    cache = null;
    cb(getBucketList());
  };
  window.addEventListener(EVENT, local);
  window.addEventListener("storage", cross);
  return () => {
    window.removeEventListener(EVENT, local);
    window.removeEventListener("storage", cross);
  };
}

// ── React bindings ──────────────────────────────────────────────────────────
// useSyncExternalStore rather than useState + useEffect: the store already has
// a subscribe, and it keeps the server snapshot explicitly empty so a saved
// list can never leak into server-rendered HTML and cause a hydration mismatch.

const serverSnapshot = (): SavedItem[] => EMPTY;

/** The whole list, live. */
export function useBucketList(): SavedItem[] {
  return useSyncExternalStore(onBucketList, getBucketList, serverSnapshot);
}

/** Just the count — for a nav badge that should not re-render on reorder. */
export function useBucketCount(): number {
  return useSyncExternalStore(
    onBucketList,
    () => getBucketList().length,
    () => 0,
  );
}

/**
 * Whether one offering is saved.
 *
 * Takes the key rather than the item so a card can ask without composing its
 * whole payload on every render — the payload is only needed when the traveler
 * actually presses the control.
 */
export function useIsSaved(key: string): boolean {
  const subscribe = useCallback((cb: () => void) => onBucketList(cb), []);
  return useSyncExternalStore(
    subscribe,
    () => isSaved(key),
    () => false,
  );
}

// ── storage ────────────────────────────────────────────────────────────────

function safeRead(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked (private mode, embedded frame): read empty
  }
}

function commit(items: SavedItem[]): SavedItem[] {
  cache = items;
  if (typeof window === "undefined") return items;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable: the list still holds for this page's lifetime */
  }
  window.dispatchEvent(new CustomEvent<SavedItem[]>(EVENT, { detail: items }));
  return items;
}

/**
 * Parse defensively. This is user-editable storage that outlives deploys, so
 * anything malformed is dropped entry-by-entry rather than failing the whole
 * read — one bad row written by an older build should not empty someone's list.
 */
function parse(raw: string | null): SavedItem[] {
  if (!raw) return EMPTY;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(data)) return EMPTY;
  const out: SavedItem[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<SavedItem>;
    const type = typeof r.type === "string" ? (r.type as OfferingType) : null;
    const id = typeof r.id === "string" ? r.id : "";
    const title = typeof r.title === "string" ? r.title : "";
    if (!type || !id || !title) continue;
    const key = bucketKey(type, id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      type,
      id,
      title,
      subtitle: str(r.subtitle),
      brand: str(r.brand),
      thumb: str(r.thumb),
      href: str(r.href),
      url: str(r.url),
      savedAt: typeof r.savedAt === "string" ? r.savedAt : "",
    });
    if (out.length >= BUCKET_LIST_MAX) break;
  }
  return out;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

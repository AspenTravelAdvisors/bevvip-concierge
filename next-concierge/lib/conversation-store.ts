// lib/conversation-store.ts — where the conversation lives between visits.
//
// This used to be sessionStorage: close the tab and a half-built brief — the
// single most valuable artifact this app produces — vanished with no trace.
// Travel research spans days, not tabs. Turns now persist to localStorage with
// a timestamp; anything older than RESUME_WINDOW_MS is offered back as a
// "pick up where you left off?" rather than silently restored, so a returning
// visitor is never confronted with a stale conversation they don't remember.

import type { GuideTurn } from "./types";

const KEY = "bevvip.guide.conversation";
/** Older than this and we ask before restoring rather than just restoring. */
export const RESUME_PROMPT_AFTER_MS = 45 * 60 * 1000; // 45 minutes
/** Older than this and we drop it entirely. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface Saved {
  turns: GuideTurn[];
  updatedAt: number;
}

export interface Restored {
  turns: GuideTurn[];
  /** True when the conversation is old enough to confirm before restoring. */
  stale: boolean;
  updatedAt: number;
}

export function loadConversation(): Restored | null {
  if (typeof window === "undefined") return null;
  let saved: Saved | null = null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) saved = JSON.parse(raw) as Saved;
  } catch {
    return null; // storage blocked or corrupt: start fresh, never crash
  }
  if (!saved || !Array.isArray(saved.turns) || saved.turns.length === 0) return null;
  const age = Date.now() - (saved.updatedAt ?? 0);
  if (!Number.isFinite(age) || age > MAX_AGE_MS) {
    clearConversation();
    return null;
  }
  return { turns: saved.turns, stale: age > RESUME_PROMPT_AFTER_MS, updatedAt: saved.updatedAt };
}

export function saveConversation(turns: GuideTurn[]): void {
  if (typeof window === "undefined") return;
  try {
    if (turns.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify({ turns, updatedAt: Date.now() }));
  } catch {
    /* over quota or unavailable: best effort */
  }
}

export function clearConversation(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing persisted to clear */
  }
}

/**
 * The saved turns, whatever their age — for surfaces that need context but
 * can't prompt, like the header's advisor form assembling a brief on a page
 * where the chat isn't mounted.
 */
export function peekTurns(): GuideTurn[] {
  return loadConversation()?.turns ?? [];
}

/** "3 days ago" / "earlier today" — plain relative age for the resume prompt. */
export function describeAge(updatedAt: number): string {
  const mins = Math.round((Date.now() - updatedAt) / 60000);
  if (mins < 60) return "a little earlier";
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

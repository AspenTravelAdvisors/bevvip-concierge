/**
 * Types for lib/atlas/wildlife-terms.js.
 *
 * The implementation is CommonJS for the same reason dates.js is: it has
 * consumers in both runtimes. `lib/atlas/wildlife.ts` reads it in the browser
 * to tag journeys for the filter, and two Node scripts read it to decide what
 * belongs in the collection at all — `sync-virtuoso-tours.mjs` at crawl time
 * and `merge-virtuoso-journeys.mjs` against the feed on disk.
 *
 * A parallel .ts copy for the TypeScript side is the obvious alternative and
 * the wrong one: if the crawl and the filter can disagree about what counts as
 * a wildlife journey, they eventually will.
 */

export interface WildlifeTerm {
  /** The facet value AND the label — facet options render their raw value. */
  label: string;
  /** Word-boundary anchored, matched case-insensitively. */
  pattern: RegExp;
}

/** One entry per animal; every name for that animal is one alternation. */
export const WILDLIFE_TERMS: readonly WildlifeTerm[];

/** Phrases that name what a wildlife product IS, for the selection gate. */
export const WILDLIFE_TITLE: RegExp;

/** Compound names rewritten to the animal they belong to, before matching. */
export const COMPOUND_REWRITES: readonly [RegExp, string][];

/** Apply COMPOUND_REWRITES — "sea lions" becomes "seal", and so on. */
export function resolveCompounds(text: string): string;

/** Which animals this text names, as sorted labels. */
export function detectWildlife(text: string | null | undefined): string[];

/** A feed row, as far as the selection gate cares. */
export interface WildlifeCandidate {
  name?: string | null;
  description?: string | null;
  experiences?: string[] | null;
}

/**
 * Is this journey ABOUT wildlife, rather than merely mentioning some?
 *
 * Stricter than `detectWildlife`, deliberately: a false tag costs a traveller
 * one card to skim, a false SELECTION puts a châteaux tour in a wildlife atlas.
 */
export function isWildlifeJourney(row: WildlifeCandidate | null | undefined): boolean;

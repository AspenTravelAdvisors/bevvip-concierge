/**
 * What you go to see — a wildlife axis, shared by every collection that has one.
 *
 * ── The question this answers ──────────────────────────────────────────────
 *
 * A safari traveller does not arrive asking for a region and a month. They
 * arrive asking for the gorillas, or the migration river crossings, or the
 * Kalahari meerkats, and every one of those is a different holiday in a
 * different country in a different month. Region, brand, length and price
 * cannot express it, so until now the only way to ask was free text — which
 * finds "Gorilla Trek" in a title and misses the journey whose title is
 * "Rwanda in Depth" and whose prose is entirely about gorillas.
 *
 * The same question is asked of expedition cruises (penguins, polar bears,
 * whales — the wildlife IS the product) and of any future collection built on
 * the same feeds.
 *
 * ── Where the vocabulary lives ─────────────────────────────────────────────
 *
 * In lib/atlas/wildlife-terms.js, not here, and read that file first: the
 * patterns, the compound-name resolution, and the argument for what the
 * detector refuses to infer are all there. It is CommonJS because the crawl
 * (`sync-virtuoso-tours.mjs`) and the merge (`merge-virtuoso-journeys.mjs`)
 * use the same vocabulary to decide what belongs in the safari collection at
 * all — a filter that disagrees with the selector about what a wildlife
 * journey is would be worse than having neither.
 *
 * This file is the browser half: the types, the re-exports the adapters call,
 * and the descriptor facet a collection declares to switch the axis on.
 */

import {
  detectWildlife as detect,
  WILDLIFE_TERMS as TERMS,
  type WildlifeTerm,
} from "@/lib/atlas/wildlife-terms";

export type { WildlifeTerm };
export const WILDLIFE_TERMS = TERMS;
export const detectWildlife = detect;

/** Every label, sorted as the filter menu will show them. */
export const WILDLIFE_LABELS: readonly string[] = [...TERMS]
  .map((t) => t.label)
  .sort((a, b) => a.localeCompare(b));

/**
 * The facet a collection declares to switch this axis on.
 *
 * The key is what the adapter writes into `attributes` and what the filter
 * reads; declaring the facet is the whole opt-in, so a collection that wants
 * the axis adds this line and a collection that does not is untouched.
 */
export const WILDLIFE_FACET_KEY = "wildlife";

export const WILDLIFE_FACET = {
  key: WILDLIFE_FACET_KEY,
  param: "wildlife",
  label: "Wildlife",
  allLabel: "Any wildlife",
} as const;

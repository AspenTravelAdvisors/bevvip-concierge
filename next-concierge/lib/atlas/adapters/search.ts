/**
 * Search tokenisation, ported verbatim from the Leaflet atlases.
 *
 * Each atlas ships its own `norm()` / `words()` pair, and the stop-lists are
 * NOT identical — every collection strips its own domain vocabulary, so that
 * searching "cruise" inside the cruise atlas doesn't match all 3,542 sailings.
 *
 * The lists diverge in a way that is easy to miss and impossible to spot from
 * the UI: cruise does not strip "luxury", every other collection does. So
 * searching "luxury" returns matches in cruise and returns nothing extra
 * anywhere else. That is existing behaviour, and the ported search has to keep
 * it or results shift silently under people who bookmarked a query.
 */

const SHARED = ["the", "and", "or", "of", "in", "to", "for"] as const;

/** Per-collection stop-lists, transcribed from each atlas's `words()`. */
export const STOP_WORDS: Record<string, readonly string[]> = {
  safari: [...SHARED, "safari", "safaris", "game", "wildlife", "big five", "migration", "gorilla", "bush", "camp", "africa", "african", "luxury"],
  train: [...SHARED, "rail", "train", "trains", "journey", "journeys", "trip", "trips", "tour", "tours", "luxury"],
  jet: [...SHARED, "private", "jet", "jets", "journey", "journeys", "trip", "trips", "tour", "tours", "luxury"],
  yacht: [...SHARED, "cruise", "cruises", "yacht", "yachts", "sailing", "sailings", "voyage", "voyages", "ship", "trip", "trips", "luxury"],
  worldcruise: [...SHARED, "cruise", "cruises", "yacht", "yachts", "sailing", "sailings", "voyage", "voyages", "ship", "trip", "trips", "luxury"],
  // NOTE: no "luxury", and "expedition"/"expeditions" instead of the yacht words.
  cruise: [...SHARED, "cruise", "cruises", "expedition", "expeditions", "sailing", "sailings", "voyage", "voyages", "ship", "trip", "trips"],
};

/**
 * Strip accents, lowercase, and reduce anything non-alphanumeric to a single
 * space. Verbatim from the atlases' `norm()`.
 */
export function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Tokenise and drop the collection's stop-words. Verbatim from `words()`. */
export function words(s: unknown, collection: string): string[] {
  const stop = STOP_WORDS[collection] ?? SHARED;
  return norm(s)
    .split(/\s+/)
    .filter((w) => w && !stop.includes(w));
}

/**
 * The atlases build their active terms from `q` AND `country` together —
 * `activeSearchTerms = [...words(q), ...words(country)]` — so `country=` is not
 * a filter of its own, it is extra search input. Reproduce both together.
 */
export function searchTerms(q: unknown, country: unknown, collection: string): string[] {
  return [...words(q, collection), ...words(country, collection)];
}

/** An offering matches when every active term appears in its haystack. */
/**
 * Hotels' matcher: raw lowercase substring, no tokenising, no stop-list.
 * See AtlasFilterDescriptor.searchMode for why this is not unified.
 */
export function matchesSubstring(haystack: string, q: string): boolean {
  if (!q) return true;
  return haystack.indexOf(q.trim().toLowerCase()) >= 0;
}

export function matchesTerms(haystack: string, terms: readonly string[]): boolean {
  if (!terms.length) return true;
  return terms.every((t) => haystack.includes(t));
}

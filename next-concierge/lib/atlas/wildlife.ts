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
 * whales — the wildlife IS the product) and would be asked of any future
 * collection built on the same feeds, which is why this is a module and not a
 * function inside safari.ts.
 *
 * ── What it reads, and what it refuses to infer ────────────────────────────
 *
 * It reads the supplier's own words: the title, the itinerary stop names, and
 * whatever prose the feed carries. It does NOT infer from geography. The
 * Serengeti obviously has lions, the Okavango obviously has elephants, and
 * tagging them from the place name would be inventing a claim the operator did
 * not make — which is exactly the trap the camps join avoids on the other side
 * of this atlas (see lib/atlas/safari-camps.ts). A journey is tagged for an
 * animal when its own description names that animal, and otherwise it is not
 * tagged, and the filter is honest about being a filter on what the operator
 * chose to promise.
 *
 * That is why coverage is partial by design and not a defect to be tuned away:
 * 147 of 269 safari journeys carry at least one tag, 682 of 3,662 expedition
 * sailings. The 122 untagged safari journeys are largely the ones whose feed
 * "description" is the operator's company boilerplate rather than the tour's —
 * 87 records share two blurbs between them — which is a data problem upstream,
 * in sync-virtuoso-tours.mjs, not something a wider regex should paper over.
 * Widening the patterns until everything matches would produce an axis where
 * every option returns everything.
 *
 * ── Why regexes and not a keyword list ─────────────────────────────────────
 *
 * Plurals, hyphens and the several names one animal has: rhino / rhinoceros /
 * rhinos, wild dog / painted wolf, orca / killer whale, gnu / wildebeest. A
 * substring list gets those wrong in both directions — it misses "rhinoceros"
 * and it matches "seal" inside "sealed". Every pattern here is word-boundary
 * anchored for that second reason.
 *
 * ── Cost ───────────────────────────────────────────────────────────────────
 *
 * This runs in the adapter, at load, rather than at build time, because the
 * alternative is a derived field on a feed that two independent syncs rebuild
 * — the staleness trap documented in scripts/build-safari-camps.mjs. The bill
 * is one pass of ~30 anchored regexes over roughly a kilobyte per record:
 * single-digit milliseconds for safari's 269, tens for cruise's 3,662, against
 * a feed download of 890 KB. Payload cost is zero, which is the trade that
 * matters on a map page.
 */

export interface WildlifeTerm {
  /** The facet value AND the label — facet options render their raw value. */
  label: string;
  /** Word-boundary anchored, matched case-insensitively. */
  pattern: RegExp;
}

/**
 * The vocabulary, in the order a traveller would rank them within a family.
 *
 * One entry per ANIMAL, not per word: every name for the same creature is an
 * alternation inside one pattern, so a journey that says "gnu" and a journey
 * that says "wildebeest" land on the same filter option. Two travellers using
 * different words for the same animal must not get different results.
 *
 * "Big Five" is here as its own entry rather than being expanded into the five
 * species, because it is a distinct promise: an operator writing "Big Five" is
 * telling you what the trip is FOR, while one that happens to mention a
 * leopard in a paragraph about the Sabi Sand is not. Expanding it would tag
 * every Big Five journey with five species it never individually promised.
 */
/**
 * Compound names, resolved to the animal they are actually about.
 *
 * ── The bug this exists for ────────────────────────────────────────────────
 *
 * English names a great many animals after a different animal, and matching
 * the head noun gets every one of them wrong. Run naively over the 3,662
 * expedition sailings, this module produced:
 *
 *   Lion       111 hits, of which 88 were SEA lions and 23 were made of stone
 *              — Delos's Terrace of the Lions, and the Sphinx's "body of a
 *              lion". Not one was a lion.
 *   Elephant    40 hits, every one of them "Weddell and elephant seals".
 *   Leopard      6 hits, all leopard SEALS.
 *   Whale      ~35 of its hits were whale SHARKS, which are sharks.
 *
 * An "Elephant (40)" option on the Antarctic atlas is not a near miss, it is
 * the filter confidently answering a different question — and the traveller
 * who picks it is being told forty sailings promise elephants.
 *
 * ── Why a rewrite and not an exclusion ─────────────────────────────────────
 *
 * The first instinct is a negative lookahead per head noun: lion but not sea
 * lion, elephant but not elephant seal. That suppresses the wrong tag and
 * throws away the right one — "Weddell and elephant seals" IS a seal sighting,
 * and the Seal & sea lion option should have it.
 *
 * So each compound is REWRITTEN to the animal it belongs to before any pattern
 * runs: "sea lions" becomes "seal", "whale sharks" becomes "shark", the stone
 * lions become nothing at all. One pass, applied to a copy of the text, and
 * every term below then sees prose in which each animal is called by the name
 * of the animal it is.
 *
 * A phrase belongs here when the compound is a DIFFERENT animal from its head
 * noun. An orca deliberately does not: it is a whale, and a traveller filtering
 * for whales means to be shown it, so "killer whale" is left to match both.
 */
const COMPOUND_REWRITES: readonly [RegExp, string][] = [
  // Pinnipeds named after land mammals. All three are seals.
  [/\bsea[\s-]?lions?\b/gi, " seal "],
  [/\belephant[\s-]?seals?\b/gi, " seal "],
  [/\bleopard[\s-]?seals?\b/gi, " seal "],
  [/\bfur[\s-]?seals?\b/gi, " seal "],
  // A whale shark is a shark; a tiger shark is a shark.
  [/\bwhale[\s-]?sharks?\b/gi, " shark "],
  [/\btiger[\s-]?sharks?\b/gi, " shark "],
  // Tiger fish is a fish, and the Zambezi angling trips that name it are not
  // tiger journeys. "Tigerfish" as one word never matched anyway — the word
  // boundary after "tiger" fails on it — which is precisely how easy it is for
  // this class of error to hide.
  [/\btiger[\s-]?fish(?:ing)?\b/gi, " "],
  // Lions in stone. These are the three phrasings the shipped feeds contain;
  // the guard is deliberately narrow, because "of the lions" is a construction
  // a real lion sighting could also use.
  [/\b(?:terrace|avenue|court|gate|statue|body|head|paws?) of (?:a|the) lions?\b/gi, " "],
];

/** The text every pattern below is actually matched against. */
function resolveCompounds(text: string): string {
  let out = text;
  for (const [re, to] of COMPOUND_REWRITES) out = out.replace(re, to);
  return out;
}

export const WILDLIFE_TERMS: readonly WildlifeTerm[] = [
  // ── Africa, the classics ────────────────────────────────────────────────
  { label: "Big Five", pattern: /\bbig\s*(?:five|5)\b/i },
  { label: "Lion", pattern: /\blions?\b|\blionesse?s?\b/i },
  { label: "Leopard", pattern: /\bleopards?\b/i },
  { label: "Elephant", pattern: /\belephants?\b|\btuskers?\b/i },
  { label: "Rhino", pattern: /\brhinos?\b|\brhinocero(?:s|ses|i)\b/i },
  { label: "Buffalo", pattern: /\bbuffal(?:o|oes|os)\b/i },
  { label: "Cheetah", pattern: /\bcheetahs?\b/i },
  { label: "Giraffe", pattern: /\bgiraffes?\b/i },
  { label: "Zebra", pattern: /\bzebras?\b/i },
  { label: "Hippo", pattern: /\bhippos?\b|\bhippopotam(?:us|uses|i)\b/i },
  { label: "Crocodile", pattern: /\bcrocodiles?\b|\bcrocs?\b/i },
  { label: "Hyena", pattern: /\bhy[ae]enas?\b/i },
  { label: "Wild dog", pattern: /\bwild dogs?\b|\bpainted (?:wolf|wolves|dogs?)\b/i },
  { label: "Antelope", pattern: /\bantelopes?\b|\bimpalas?\b|\bkudus?\b|\bgazelles?\b|\belands?\b|\bsprings?bok\w*\b/i },
  { label: "Oryx", pattern: /\boryx(?:es)?\b|\bgemsbok\w*\b/i },
  { label: "Meerkat", pattern: /\bmeerkats?\b/i },
  { label: "Ostrich", pattern: /\bostrich(?:es)?\b/i },

  // ── The migration, which is an event as much as an animal ───────────────
  {
    label: "Great Migration",
    // "Wildebeest" and "the Migration" are the same product being sold, and a
    // traveller filtering for one means the other. Capitalisation is not
    // available to us here — the feed's prose is inconsistently cased — so
    // "migration" is required to sit next to a word that makes it this one.
    pattern: /\bwildebeeste?s?\b|\bgnus?\b|\b(?:great|annual|wildebeest) migration\b|\bmigration (?:season|river crossings?)\b/i,
  },

  // ── Primates ────────────────────────────────────────────────────────────
  { label: "Gorilla", pattern: /\bgorillas?\b|\bsilverbacks?\b/i },
  { label: "Chimpanzee", pattern: /\bchimpanzees?\b|\bchimps?\b/i },
  { label: "Lemur", pattern: /\blemurs?\b|\bsifakas?\b/i },
  { label: "Orangutan", pattern: /\borang-?utans?\b/i },
  { label: "Monkeys & baboons", pattern: /\bbaboons?\b|\bmonkeys?\b|\bcolobus\b|\bmacaques?\b/i },

  // ── Polar and expedition ────────────────────────────────────────────────
  { label: "Polar bear", pattern: /\bpolar bears?\b/i },
  { label: "Penguin", pattern: /\bpenguins?\b/i },
  { label: "Walrus", pattern: /\bwalrus(?:es)?\b/i },
  { label: "Reindeer & musk ox", pattern: /\breindeer\b|\bcaribou\b|\bmusk\s?ox(?:en)?\b/i },
  { label: "Brown & grizzly bear", pattern: /\b(?:grizzly|grizzlies|brown|black|kodiak) bears?\b|\bgrizzlies\b/i },
  { label: "Wolf", pattern: /\bwolves\b|\bwolf\b/i },

  // ── At sea ──────────────────────────────────────────────────────────────
  { label: "Whale", pattern: /\bwhales?\b|\bhumpbacks?\b|\bbelugas?\b|\bnarwhals?\b/i },
  { label: "Orca", pattern: /\borcas?\b|\bkiller whales?\b/i },
  { label: "Dolphin", pattern: /\bdolphins?\b|\bporpoises?\b/i },
  { label: "Seal & sea lion", pattern: /\bseals?\b|\bsea lions?\b|\bfur seals?\b/i },
  { label: "Shark", pattern: /\bsharks?\b/i },
  { label: "Manta & ray", pattern: /\bmantas?\b|\bmanta rays?\b|\bstingrays?\b/i },
  { label: "Sea turtle", pattern: /\bsea turtles?\b|\bturtles?\b/i },

  // ── Galápagos and the tropics ───────────────────────────────────────────
  { label: "Giant tortoise", pattern: /\btortoises?\b/i },
  { label: "Iguana", pattern: /\biguanas?\b/i },
  { label: "Komodo dragon", pattern: /\bkomodo dragons?\b/i },
  { label: "Jaguar", pattern: /\bjaguars?\b/i },
  { label: "Sloth", pattern: /\bsloths?\b/i },
  { label: "Tiger", pattern: /\btigers?\b/i },

  // ── Birds, as one entry ─────────────────────────────────────────────────
  {
    label: "Flamingo",
    pattern: /\bflamingo(?:e?s)?\b/i,
  },
  {
    label: "Birdlife",
    /*
     * One option for birds in general, and it earns its place by being the
     * question people actually ask ("is there good birding?"). Deliberately
     * NOT `\bbird\b` alone — that matches "bird's-eye view" and the like, so
     * the bare noun is required to be plural or part of a birding word.
     */
    pattern: /\bbirds\b|\bbird(?:life|ing|watching|-watching)\b|\balbatross(?:es)?\b|\braptors?\b/i,
  },
];

/** Every label, sorted as the filter menu will show them. */
export const WILDLIFE_LABELS: readonly string[] = [...WILDLIFE_TERMS]
  .map((t) => t.label)
  .sort((a, b) => a.localeCompare(b));

/**
 * Which animals this text names.
 *
 * Returns labels sorted, always, so that two records that name the same
 * animals produce byte-identical attribute arrays — which is what keeps a
 * shared `?wildlife=` link resolving the same way after a feed refresh.
 */
export function detectWildlife(text: string | null | undefined): string[] {
  if (!text) return [];
  const resolved = resolveCompounds(text);
  const hits: string[] = [];
  for (const t of WILDLIFE_TERMS) {
    if (t.pattern.test(resolved)) hits.push(t.label);
  }
  return hits.sort((a, b) => a.localeCompare(b));
}

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

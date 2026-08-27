// lib/atlas/wildlife-terms.js — what a wildlife journey says you will see.
//
// WHY THIS IS COMMONJS, LIKE dates.js
//
// Three consumers, two runtimes. `lib/atlas/wildlife.ts` reads it in the
// browser to tag journeys for the atlas filter; `scripts/sync-virtuoso-tours.mjs`
// reads it in Node to decide what belongs in the collection at all; and
// `scripts/merge-virtuoso-journeys.mjs` reads it to apply the same test to the
// feed already on disk. One vocabulary, or the crawl and the filter end up
// disagreeing about what a wildlife journey is — which is the exact failure
// the `Lodge / Safari` category had before it was split.
//
// CommonJS with a .d.ts beside it is the shape this repo already uses for
// exactly this (see dates.js): TypeScript imports it through the `@/` alias,
// and Node's ESM loader reads its named exports through cjs-module-lexer.
//
// ── What it reads, and what it refuses to infer ─────────────────────────────
//
// The supplier's own words: the title, the itinerary stop names, and whatever
// prose the feed carries. NOT geography. The Serengeti obviously has lions and
// the Okavango obviously has elephants, and tagging them from the place name
// would be inventing a claim the operator did not make — the same trap the
// camps join avoids on the other side of this atlas (lib/atlas/safari-camps.ts).
//
// Coverage is therefore partial by design: 147 of 269 safari journeys carry at
// least one tag, 682 of 3,662 expedition sailings. The untagged safari journeys
// are largely the ones whose feed "description" is the operator's company
// boilerplate rather than the tour's — 87 records share two blurbs between them
// — which is a data problem upstream, not something a wider regex should paper
// over. Widening the patterns until everything matches produces an axis where
// every option returns everything.
//
// ── Why regexes and not a keyword list ──────────────────────────────────────
//
// Plurals, hyphens and the several names one animal has: rhino / rhinoceros,
// wild dog / painted wolf, orca / killer whale, gnu / wildebeest. A substring
// list gets those wrong in both directions — it misses "rhinoceros" and it
// matches "seal" inside "sealed". Every pattern here is word-boundary anchored
// for that second reason.

/**
 * Compound names, resolved to the animal they are actually about.
 *
 * ── The bug this exists for ───────────────────────────────────────────────
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
 * ── Why a rewrite and not an exclusion ────────────────────────────────────
 *
 * The first instinct is a negative lookahead per head noun: lion but not sea
 * lion. That suppresses the wrong tag and throws away the right one —
 * "Weddell and elephant seals" IS a seal sighting, and the Seal & sea lion
 * option should have it.
 *
 * So each compound is REWRITTEN to the animal it belongs to before any pattern
 * runs. A phrase belongs here when the compound is a DIFFERENT animal from its
 * head noun. An orca deliberately does not: it is a whale, and a traveller
 * filtering for whales means to be shown it.
 */
const COMPOUND_REWRITES = [
  // Pinnipeds named after land mammals. All of these are seals.
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
  // Lions in stone. These are the phrasings the shipped feeds contain; the
  // guard is deliberately narrow, because "of the lions" is a construction a
  // real lion sighting could also use.
  [/\b(?:terrace|avenue|court|gate|statue|body|head|paws?) of (?:a|the) lions?\b/gi, " "],
];

/** The text every pattern below is actually matched against. */
function resolveCompounds(text) {
  let out = String(text);
  for (const [re, to] of COMPOUND_REWRITES) out = out.replace(re, to);
  return out;
}

/**
 * The vocabulary, one entry per ANIMAL rather than per word.
 *
 * Every name for the same creature is an alternation inside one pattern, so a
 * journey that says "gnu" and a journey that says "wildebeest" land on the
 * same filter option. Two travellers using different words for the same animal
 * must not get different results.
 *
 * "Big Five" is its own entry rather than being expanded into five species,
 * because it is a distinct promise: an operator writing "Big Five" is telling
 * you what the trip is FOR, while one that mentions a leopard in a paragraph
 * about the Sabi Sand is not.
 */
const WILDLIFE_TERMS = [
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
    // available to us — the feed's prose is inconsistently cased — so
    // "migration" is required to sit next to a word that makes it this one.
    pattern: /\bwildebeeste?s?\b|\bgnus?\b|\b(?:great|annual|wildebeest) migration\b|\bmigration (?:season|river crossings?)\b/i,
  },

  // ── Primates ────────────────────────────────────────────────────────────
  { label: "Gorilla", pattern: /\bgorillas?\b|\bsilverbacks?\b/i },
  { label: "Chimpanzee", pattern: /\bchimpanzees?\b|\bchimps?\b/i },
  { label: "Lemur", pattern: /\blemurs?\b|\bsifakas?\b/i },
  { label: "Orangutan", pattern: /\borang-?utans?\b/i },
  { label: "Monkeys & baboons", pattern: /\bbaboons?\b|\bmonkeys?\b|\bcolobus\b|\bmacaques?\b/i },

  // ── Polar and northern ──────────────────────────────────────────────────
  { label: "Polar bear", pattern: /\bpolar bears?\b/i },
  { label: "Penguin", pattern: /\bpenguins?\b/i },
  { label: "Walrus", pattern: /\bwalrus(?:es)?\b/i },
  { label: "Reindeer & musk ox", pattern: /\breindeer\b|\bcaribou\b|\bmusk\s?ox(?:en)?\b/i },
  { label: "Brown & grizzly bear", pattern: /\b(?:grizzly|grizzlies|brown|black|kodiak|spirit) bears?\b|\bgrizzlies\b/i },
  { label: "Wolf", pattern: /\bwolves\b|\bwolf\b/i },
  { label: "Bison & moose", pattern: /\bbison\b|\bbuffalo herds?\b|\bmoose\b|\belk\b|\bbighorn\b/i },

  // ── At sea ──────────────────────────────────────────────────────────────
  { label: "Whale", pattern: /\bwhales?\b|\bhumpbacks?\b|\bbelugas?\b|\bnarwhals?\b/i },
  { label: "Orca", pattern: /\borcas?\b|\bkiller whales?\b/i },
  { label: "Dolphin", pattern: /\bdolphins?\b|\bporpoises?\b/i },
  { label: "Seal & sea lion", pattern: /\bseals?\b|\bsea lions?\b|\bfur seals?\b/i },
  { label: "Shark", pattern: /\bsharks?\b/i },
  { label: "Manta & ray", pattern: /\bmantas?\b|\bmanta rays?\b|\bstingrays?\b/i },
  { label: "Sea turtle", pattern: /\bsea turtles?\b|\bturtles?\b/i },

  // ── Galápagos, the Andes and the tropics ────────────────────────────────
  { label: "Giant tortoise", pattern: /\btortoises?\b/i },
  { label: "Iguana", pattern: /\biguanas?\b/i },
  { label: "Komodo dragon", pattern: /\bkomodo dragons?\b/i },
  { label: "Jaguar", pattern: /\bjaguars?\b/i },
  { label: "Puma & condor", pattern: /\bpumas?\b|\bcougars?\b|\bcondors?\b|\bguanacos?\b/i },
  { label: "Sloth", pattern: /\bsloths?\b/i },
  { label: "Tiger", pattern: /\btigers?\b/i },
  { label: "Giant panda", pattern: /\bgiant pandas?\b|\bpandas?\b/i },

  // ── Birds ───────────────────────────────────────────────────────────────
  { label: "Flamingo", pattern: /\bflamingo(?:e?s)?\b/i },
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

/**
 * Which animals this text names, as sorted labels.
 *
 * Sorted always, so two records naming the same animals produce byte-identical
 * attribute arrays — which is what keeps a shared `?wildlife=` link resolving
 * the same way after a feed refresh.
 */
function detectWildlife(text) {
  if (!text) return [];
  const resolved = resolveCompounds(text);
  const hits = [];
  for (const t of WILDLIFE_TERMS) if (t.pattern.test(resolved)) hits.push(t.label);
  return hits.sort((a, b) => a.localeCompare(b));
}

/**
 * Is this journey ABOUT wildlife, rather than merely mentioning some?
 *
 * The filter axis and the collection's front door ask different questions of
 * the same prose. Tagging is generous: one mention of an elephant is enough to
 * make a journey findable under Elephant, because a false tag there costs a
 * traveller one extra card to skim. SELECTION is not generous, because a false
 * positive there puts a Loire châteaux tour in a wildlife atlas.
 *
 * So the front door wants one of two things:
 *
 *   1. The TITLE says so. An operator who writes "safari", "wildlife",
 *      "gorilla trek" or "bear viewing" into the name of the product has
 *      declared what it is, and that is the strongest signal the feed carries.
 *   2. Failing that, the prose names at least TWO different animals. One
 *      elephant in a paragraph about Kruger's scenery is a detail; elephants
 *      AND lions AND wild dogs is an itinerary.
 *
 * Two, not one, is the whole guard, and it is the line between "mentions" and
 * "is about". Against the shipped feed, dropping it to one admits city tours
 * whose only animal is a monument.
 */
const WILDLIFE_TITLE = new RegExp(
  [
    // What the trip IS, in the operator's own product name.
    "safari",
    "wildlife",
    "big\\s*(?:five|5)",
    "game (?:drive|reserve|park|viewing)",
    "bear viewing",
    "birding",
    "naturalist",
    "gorilla",
    "chimpanzee",
    "primate",
    "great migration",
    "in search of",
    // Places whose entire product is the animals in them.
    "serengeti",
    "ma[a]?sai mara",
    "okavango",
    "kruger",
    "ngorongoro",
    "galapagos",
    "galápagos",
    "pantanal",
    "churchill",
    "svalbard",
    "katmai",
    "yellowstone",
  ].map((s) => `\\b${s}\\b`).join("|"),
  "i",
);

/**
 * @param {{ name?: string|null, description?: string|null, experiences?: string[]|null }} row
 */
function isWildlifeJourney(row) {
  const name = String(row?.name ?? "");
  /*
   * The supplier's own classification, where the API gives one.
   *
   * `Wildlife & Nature` is a first-class Virtuoso experience facet and is the
   * single most reliable signal in the feed — it is the operator ticking a box
   * that says what this product is. It is listed first because when it is
   * present nothing else needs to be asked.
   */
  if ((row?.experiences ?? []).includes("Wildlife & Nature")) return true;
  if (WILDLIFE_TITLE.test(name)) return true;
  return detectWildlife(`${name} ${row?.description ?? ""}`).length >= 2;
}

module.exports = {
  WILDLIFE_TERMS,
  WILDLIFE_TITLE,
  COMPOUND_REWRITES,
  resolveCompounds,
  detectWildlife,
  isWildlifeJourney,
};

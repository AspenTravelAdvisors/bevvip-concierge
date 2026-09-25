// lib/crawlers.ts — the crawlers this site turns away.
//
// Training-only crawlers with no answer product that links back to us: they
// take the curation and the atlas data, and no traveler ever arrives from them.
// Everything else — search, answer engines, and the major labs' training
// crawlers — stays welcome; app/robots.js says why.
//
// Listed in robots.txt as Disallow: / for the ones that honour it, and refused
// with a 403 in middleware.ts for the ones that do not. Bytespider in
// particular is widely reported to ignore robots.txt, so the file alone would
// be a polite request it declines.

export const NO_RETURN_CRAWLERS = [
  "Bytespider", // ByteDance
  "CCBot", // Common Crawl — a bulk corpus many third-party models train on
  "cohere-ai",
  "cohere-training-data-crawler",
];

const PATTERN = new RegExp(NO_RETURN_CRAWLERS.join("|"), "i");

/** True when the user agent names one of the crawlers above. */
export function isNoReturnCrawler(userAgent: string | null): boolean {
  return !!userAgent && PATTERN.test(userAgent);
}

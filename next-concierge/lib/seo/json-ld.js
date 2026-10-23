// next-concierge/lib/seo/json-ld.js — a JSON-LD block, safe to put in <script>.
//
// Every structured-data block on the site is written with
// dangerouslySetInnerHTML, and JSON.stringify does not escape "<". Much of what
// those blocks carry is supplier text — hotel descriptions, journey titles —
// that the nightly sync commits with nobody reading it first, so a description
// containing "</script>" would close the block early and the rest of it would
// be parsed as markup on our page. "<" is the same character to any JSON
// parser, search engines included, and is never a tag to an HTML one.
//
// Use this for every `<script type="application/ld+json">`; never
// JSON.stringify straight into __html.

/** JSON for an ld+json script element, with "<" escaped. */
export function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

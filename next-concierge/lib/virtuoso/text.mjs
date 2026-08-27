// Supplier HTML -> plain text, for every Virtuoso sync.
//
// One copy, because there were four and they had already drifted into two
// variants that differed only in whitespace — which is exactly how a fix lands
// in three files and not the fourth.

/*
 * Non-prose elements are dropped WITH their contents, before anything else.
 *
 * This is the whole reason the file exists. Tag-stripping alone removes
 * `<style>` and `</style>` and leaves everything between them, so a supplier
 * who pasted an itinerary day out of Word — which brings the document's
 * stylesheet inline — produced a "description" reading:
 *
 *   p {margin:0px 0px 0px 2px;} ul {margin-top:2px;} .Normal {font-family:Verdana;…
 *
 * 251 of 2,623 itinerary stops in the tours feed are in that state, and because
 * the result is then clipped to 240 characters, the stylesheet consumed the
 * whole budget and the actual prose was truncated away behind it. The damage is
 * not recoverable from the stored feed — those stops need a re-sync — which is
 * the argument for fixing it at the only place it can be fixed.
 *
 * <script> and <!-- --> go the same way for the same reason.
 */
const NON_PROSE = /<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

/*
 * An unterminated tag at the very end.
 *
 * Suppliers submit truncated HTML often enough to matter, and `<[^>]+>` cannot
 * match a `<div class="x` with no closing bracket, so it survives tag-stripping
 * as visible markup at the end of a sentence.
 */
const DANGLING_TAG = /<[^>]*$/;

const ENTITIES = [
  [/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&#39;|&rsquo;|&lsquo;/g, "'"],
  [/&quot;|&ldquo;|&rdquo;/g, '"'], [/&lt;/g, '<'], [/&gt;/g, '>'],
  [/&ndash;/g, '–'], [/&mdash;/g, '—'], [/&hellip;/g, '…'],
];

/** Supplier HTML as one line of plain text. */
export function text(html) {
  let s = String(html ?? '')
    .replace(NON_PROSE, ' ')
    .replace(COMMENTS, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|li|div|h\d|tr|td)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(DANGLING_TAG, '');
  for (const [re, to] of ENTITIES) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

/*
 * What a leaked stylesheet looks like once the tags are gone.
 *
 * Used by the audit to count the damage and by the syncs to refuse to publish
 * it: a stop with no description is honest, a stop whose description is
 * `border-collapse:collapse` is not. Deliberately narrow — it wants a CSS
 * declaration block or a leading selector, so a sentence containing a colon or
 * the word "margin" is not caught.
 */
export const LOOKS_LIKE_CSS =
  /(\{[^}]*(?:margin|padding|font-family|font-size|border|vertical-align|text-align)\s*:)|(^\s*[.#]?[A-Za-z][\w.#-]*\s*\{)/;

/** The supplier's prose, or null where what came back was a stylesheet. */
/*
 * Supplier boilerplate is not prose either.
 *
 * 1,983 of 4,370 sailings answer `cruiseDescription` with "This information has
 * not be provided by the supplier." (their typo), and others with "More
 * information to come." Stored as description it fills a dossier with an
 * apology and pollutes the guide's search haystack, so it is treated as absent
 * for the same reason a stylesheet is.
 */
const PLACEHOLDER = /has not be(en)?\s+provided|more information to come|information (is )?not available/i;

export function prose(html) {
  const s = text(html);
  if (!s || LOOKS_LIKE_CSS.test(s) || PLACEHOLDER.test(s)) return null;
  return s;
}

/** Trim to `n` characters on a word boundary, with an ellipsis. */
export function clip(s, n) {
  return s && s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s;
}

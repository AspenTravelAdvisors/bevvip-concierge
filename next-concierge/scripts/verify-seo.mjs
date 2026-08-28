#!/usr/bin/env node
/**
 * The crawlable surface, checked.
 *
 * Three things on this surface fail silently, which is the only reason this
 * file exists — every one of them ships a page that looks fine and is wrong:
 *
 *   1. A fact token that does not resolve. `{{hotels:program=Marriot STARS}}`
 *      (one 't') either renders the braces to the crawler or, in an earlier
 *      design, quietly rendered "0". Both are worse than a build failure, and
 *      neither shows up in a screenshot.
 *   2. An evidence query that matches nothing. The answer keeps its claim and
 *      loses the table under it — a page that says "the properties are listed
 *      below" above nothing at all.
 *   3. A capsule that is not a capsule. The whole value of the block is that it
 *      answers the question standing alone, in the length an engine will lift.
 *      A three-word capsule and a nine-sentence one both defeat it.
 *
 * It also re-derives every hotel URL, because a slug that changes is a 404 for
 * everyone who already had the link, and the sitemap now carries 2,240 of them.
 *
 *   node scripts/verify-seo.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../lib/virtuoso/env.mjs';
import { makeFacts, UnknownFactTerm } from '../lib/seo/facts.mjs';

const require = createRequire(import.meta.url);
const read = rel => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));

const failures = [];
const fail = (what, detail) => failures.push(`${what}: ${detail}`);
let checks = 0;
const ok = () => { checks += 1; };

// ── the data, loaded the way the scripts do rather than the way Next does ───
const rawHotels = read('data/atlas/hotel/luxury-hotels.json');
const { applyProgramOverrides } = require('../lib/atlas/program-overrides.js');
const hotels = applyProgramOverrides(rawHotels);

/*
 * Collection totals come from the shipped datasets, not from atlas-config.ts.
 *
 * They are the same numbers — audit-listings.mjs gates the config against these
 * exact files — but the config is TypeScript and this is a node script, and a
 * regex over someone else's source is the kind of shortcut that reads a
 * `count:` from the wrong collection the day the file is reordered. Reading the
 * data is both simpler and closer to the truth; if the two ever disagree,
 * `verify:listings` is the check that says so.
 */
const COLLECTION_SOURCES = {
  hotel: ['data/atlas/hotel/luxury-hotels.json', d => d.length],
  villa: ['data/villas-of-distinction.json', d => (d.villas ?? Object.values(d).find(Array.isArray) ?? []).length],
  cruise: ['data/atlas/cruise/sailings.json', d => (d.rows ?? []).length],
  worldcruise: ['data/atlas/world/itinerary.json', d => (d.TRIPS ?? []).length],
  train: ['data/atlas/train/itinerary.json', d => (d.TRIPS ?? []).length],
  yacht: ['data/atlas/yacht/itinerary.json', d => (d.TRIPS ?? []).length],
  jet: ['data/atlas/jet/itinerary.json', d => (d.TRIPS ?? []).length],
  safari: ['data/atlas/safari/itinerary.json', d => (d.TRIPS ?? []).length],
};
const collections = Object.fromEntries(
  Object.entries(COLLECTION_SOURCES)
    .filter(([, [rel]]) => fs.existsSync(path.join(repoRoot, rel)))
    .map(([type, [rel, pick]]) => [type, pick(read(rel))]),
);

const facts = makeFacts(hotels, collections);

// ── the answers, via the module list lib/answers.js actually imports ────────
const registrySrc = fs.readFileSync(path.join(repoRoot, 'lib/answers.js'), 'utf8');
const modulePaths = [...registrySrc.matchAll(/from "@\/(data\/answers\/[a-z]+)"/g)].map(m => m[1]);
if (!modulePaths.length) fail('registry', 'lib/answers.js imports no answer modules — the parse is wrong');

const answers = [];
for (const rel of modulePaths) {
  const mod = await import(pathToFileURL(path.join(repoRoot, `${rel}.js`)).href);
  const exported = Object.values(mod).find(Array.isArray);
  if (!exported) { fail('registry', `${rel} exports no answer array`); continue; }
  answers.push(...exported);
}

// ── 1. every token in every answer resolves ─────────────────────────────────
for (const a of answers) {
  let out;
  try {
    out = facts.resolveDeep(a);
    ok();
  } catch (err) {
    fail(a.slug, err instanceof UnknownFactTerm ? `unresolvable fact — ${err.message}` : String(err));
    continue;
  }
  const leftover = JSON.stringify(out).match(/\{\{[^}]*\}\}/g);
  if (leftover) fail(a.slug, `unresolved tokens survive rendering: ${leftover.join(', ')}`);

  /*
   * A token that resolves to zero is the dangerous case, and it is why
   * resolving without throwing is not enough on its own.
   *
   * `{{hotels:program=Marriot STARS}}` — one 't' — is a perfectly valid query
   * for a program nothing is filed under. It resolves, cleanly, to "0", and
   * publishes the sentence "our atlas tracks 0 properties under Marriott
   * STARS". Nothing downstream can tell that apart from a true zero, so it is
   * caught here, where the fix is a one-character edit rather than a
   * correction to an indexed page.
   *
   * The same check covers the other way this goes wrong, which is not a typo
   * at all: a supplier sync that retires a whole programme. That reads as a
   * red build the morning after, which is the outcome worth having.
   */
  for (const [, body] of JSON.stringify(a).matchAll(/\{\{(hotels:[^}]+)\}\}/g)) {
    const spec = body.slice('hotels:'.length).trim();
    if (facts.count(spec) === 0) {
      fail(a.slug, `{{${body}}} matches no property — a typo, or a programme the feed no longer carries`);
    }
  }
}

// ── 2. every evidence query matches something ───────────────────────────────
for (const a of answers.filter(x => x.evidence)) {
  const { query, sort = 'name', limit = 12 } = a.evidence;
  try {
    const rows = facts.select(query, { sort, limit });
    ok();
    if (!rows.length) fail(a.slug, `evidence query "${query}" matches no property — the table renders empty`);
    if (!a.evidence.h2) fail(a.slug, 'evidence block has no h2');
  } catch (err) {
    fail(a.slug, `evidence query "${query}" is invalid — ${err.message}`);
  }
}

// ── 3. capsules are the length an engine can lift ───────────────────────────
const MIN_WORDS = 25;
const MAX_WORDS = 90;
for (const a of answers) {
  if (!a.capsule) {
    fail(a.slug, 'no capsule — the page has no single extractable answer');
    continue;
  }
  ok();
  const words = facts.resolve(a.capsule).trim().split(/\s+/).length;
  if (words < MIN_WORDS || words > MAX_WORDS) {
    fail(a.slug, `capsule is ${words} words; the extractable band is ${MIN_WORDS}-${MAX_WORDS}`);
  }
  // A capsule that opens by referring to the page cannot stand alone in a
  // result, which is the only thing it is for.
  if (/^(this|these|here|below|as (noted|above))\b/i.test(a.capsule.trim())) {
    fail(a.slug, 'capsule opens with a reference to the page it sits on');
  }
}

// ── 4. hotel URLs are unique, non-empty and stable ──────────────────────────
const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const slugify = s => fold(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const seen = new Map();
for (const h of [...hotels].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
  const destination = slugify(h.country) || 'worldwide';
  const base = slugify([h.name, h.city].filter(Boolean).join(' ')) || slugify(h.id);
  const key = seen.has(`${destination}/${base}`)
    ? `${destination}/${base}-${slugify(h.id)}`
    : `${destination}/${base}`;
  if (seen.has(key)) fail('hotel-urls', `two properties resolve to /hotels/${key} even after the id tiebreak`);
  if (!base) fail('hotel-urls', `${h.id} has no usable slug`);
  seen.set(key, h.id);
}
ok();
if (seen.size !== hotels.length) {
  fail('hotel-urls', `${hotels.length} properties produced ${seen.size} URLs`);
}

// Internal links the answers make into the hotel pages must land somewhere.
const destinations = new Set([...seen.keys()].map(k => k.split('/')[0]));
for (const a of answers) {
  for (const r of a.related || []) {
    const m = /^\/hotels\/([^/?#]+)$/.exec(r.href || '');
    if (m && !destinations.has(m[1])) {
      fail(a.slug, `related link ${r.href} points at a country with no properties`);
    }
  }
}
ok();

// ── 5. nothing publishes a template ─────────────────────────────────────────
/*
 * The checks above prove the tokens CAN be resolved. They do not prove every
 * surface that renders answer prose actually resolves them, and that is a
 * distinct bug with no overlap: the detail page resolved its record, the
 * answers index and llms.txt did not, and both shipped
 * "{{hotels:program=Virtuoso}} Virtuoso properties" to the crawler in a link
 * summary while the page behind the link read correctly.
 *
 * Only the built output can answer that, so this check runs over .next when a
 * build is present and says so plainly when it is not — a skipped check that
 * announces itself is recoverable; one that quietly passes is the failure this
 * repository has paid for twice.
 */
const BUILT = path.join(repoRoot, '.next/server/app');
if (fs.existsSync(BUILT)) {
  const suspect = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(html|body|rsc)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (/\{\{[a-z]+:/.test(text)) suspect.push(path.relative(repoRoot, full));
    }
  };
  walk(BUILT);
  ok();
  for (const file of suspect.slice(0, 10)) {
    fail('built-output', `${file} publishes an unresolved fact token`);
  }
  if (suspect.length > 10) {
    fail('built-output', `…and ${suspect.length - 10} more files`);
  }
} else {
  console.log('  (no .next build present — skipping the rendered-output scan)');
}

// ── report ──────────────────────────────────────────────────────────────────
const nf = new Intl.NumberFormat('en-US');
console.log(
  `verify:seo — ${answers.length} answers, ${nf.format(hotels.length)} hotel URLs, ` +
  `${Object.keys(collections).length} collections, ${checks} checks run`,
);
if (failures.length) {
  console.error(`\n${failures.length} failure${failures.length === 1 ? '' : 's'}:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('all clear');

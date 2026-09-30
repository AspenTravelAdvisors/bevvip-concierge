#!/usr/bin/env node
/**
 * Draft new /answers pages from the topic backlog, with Claude.
 *
 *   node scripts/draft-answers.mjs              # draft the next 3 queued topics
 *   node scripts/draft-answers.mjs --count 2
 *   node scripts/draft-answers.mjs --dry-run    # print the prompt context, spend nothing
 *
 * Runs monthly from .github/workflows/monthly-answers.yml, which opens the
 * result as a pull request. Nothing drafted here is published until a person
 * merges that PR — the drafts make factual claims in the agency's name, and the
 * review_notes each one carries (written to answers-pr-body.md, never to the
 * page) list the claims most worth checking.
 *
 * The drafts pass the same gate the hand-written answers do: every draft is
 * written into data/answers/generated.js and scripts/verify-seo.mjs is run
 * against it. A failure goes back to the model with the verifier's own words,
 * twice at most; a draft that still fails is dropped and its topic marked
 * `failed`, so one bad topic never blocks the month.
 *
 * Cost: a handful of requests a month, each well under a dollar.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { loadEnv, repoRoot } from '../lib/virtuoso/env.mjs';
import { answerVocabulary, vocabularyText } from './lib/answer-vocabulary.mjs';

loadEnv();

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const COUNT = Math.max(1, Number(opt('count', 3)) || 3);
const DRY_RUN = flag('dry-run');
const MODEL = 'claude-opus-5-5';
const MAX_ATTEMPTS = 3;

const BACKLOG = path.join(repoRoot, 'data/answers/backlog.json');
const GENERATED = path.join(repoRoot, 'data/answers/generated.js');
const PR_BODY = path.join(repoRoot, 'answers-pr-body.md');
const today = new Date().toISOString().slice(0, 10);

// ── what already exists ─────────────────────────────────────────────────────
const registrySrc = fs.readFileSync(path.join(repoRoot, 'lib/answers.js'), 'utf8');
const CATEGORY_ORDER = JSON.parse(
  registrySrc.match(/CATEGORY_ORDER = (\[[^\]]*\])/)[1],
);
const modulePaths = [...registrySrc.matchAll(/from "@\/(data\/answers\/[a-z]+)"/g)].map(m => m[1]);
const existing = [];
for (const rel of modulePaths) {
  const mod = await import(pathToFileURL(path.join(repoRoot, `${rel}.js`)).href);
  existing.push(...(Object.values(mod).find(Array.isArray) || []));
}
const { generatedAnswers } = await import(pathToFileURL(GENERATED).href);

// The links a draft may use. A made-up href is a 404 on a page built to be
// cited, so anything outside this set is dropped and flagged for review.
const vocab = answerVocabulary();
const slugify = s =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const VALID_HREFS = new Set([
  '/hotels', '/journeys', '/villas', '/answers',
  ...existing.map(a => `/answers/${a.slug}`),
  ...vocab.journeys.collection.map(([c]) => `/journeys/${c}`),
  ...vocab.journeys.collection.map(([c]) => `/atlas/${c}`),
  '/atlas/hotel', '/atlas/villa',
  ...vocab.hotels.country.map(([c]) => `/hotels/${slugify(c)}`),
]);

// ── the output shape ────────────────────────────────────────────────────────
const str = { type: 'string' };
const strs = { type: 'array', items: str };
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const ANSWER_SCHEMA = obj({
  slug: str,
  category: { type: 'string', enum: CATEGORY_ORDER },
  question: str,
  title: str,
  description: str,
  capsule: str,
  answer: strs,
  sections: {
    type: 'array',
    items: obj({
      h2: str,
      paras: strs,
      list: strs,
      table: {
        anyOf: [
          { type: 'null' },
          obj({
            caption: { anyOf: [str, { type: 'null' }] },
            columns: strs,
            rows: { type: 'array', items: strs },
          }),
        ],
      },
    }),
  },
  evidence: {
    anyOf: [
      { type: 'null' },
      obj({
        h2: str,
        note: str,
        query: str,
        sort: { type: 'string', enum: ['name', 'rooms', 'smallest', 'perks'] },
        limit: { type: 'integer' },
      }),
    ],
  },
  faqs: { type: 'array', items: obj({ q: str, a: str }) },
  related: { type: 'array', items: obj({ href: str, label: str }) },
  review_notes: strs,
});

// ── the brief ───────────────────────────────────────────────────────────────
const EXAMPLES = ['four-seasons-preferred-partner-benefits', 'which-safari-operator-should-you-book']
  .map(slug => existing.find(a => a.slug === slug))
  .filter(Boolean);

const SYSTEM = `You write answer pages for The Guide, the luxury travel atlas run by Aspen Travel Advisors, a Virtuoso member agency. Each page answers one traveler question well enough that an AI search engine can quote it and a traveler can act on it.

Voice: a well-traveled advisor talking quietly at a bar in Aspen. Plain, specific, honest about trade-offs, including when something is not worth it. Never salesy. Mention booking through an advisor at most once, briefly, and only where it genuinely changes the outcome. Do not use exclamation marks, the phrases "bucket list" or "once in a lifetime", or marketing adjectives like "unparalleled" or "breathtaking". Prefer commas and full stops to em dashes.

Facts: every claim must be something you are confident is true and stable. Leave out anything you are unsure of rather than hedging it. Do not state prices or rates for specific properties; widely published public fees (such as a national park permit) are fine. Do not invent quotes, awards, statistics, launch dates or ship specifications. List every claim a careful editor should double-check in review_notes; they are shown to the reviewer, never published.

Counts: never type a count of properties or itineraries. Write a fact token instead and it is computed from the live feed when the page renders:
  {{hotels:<spec>}}       properties matching the spec, e.g. {{hotels:country=Italy&experience=Wellness}}
  {{journeys:<spec>}}     itineraries, e.g. {{journeys:collection=safari&country=Rwanda}}
  {{departures:<spec>}}   departure dates behind those itineraries
  {{collection:<type>}}   a whole collection's total (hotel, villa, cruise, worldcruise, train, yacht, jet, safari)
A spec is key=value terms joined by &; write a literal & inside a value as %26.
Hotel keys: program, brand, chain, category, country, city, region, propertyType, experience, vibe, tag, amenity, name (word-prefix match), perks=true, promo=true, sustainable=true, roomsMin, roomsMax.
Journey keys: collection, operator, country, region, vessel, title (word-prefix match), daysMin, daysMax, world=true, onDemand=true, promo=true.
Values must be spelled exactly as in the vocabulary below (matching ignores case and accents). A token that matches nothing fails the build, so use only values listed there.

Fields:
- slug: lowercase-kebab, descriptive, not already in use.
- capsule: 40 to 70 words that answer the question on their own, out of context. Must not start with "This", "These", "Here", "Below" or "As noted". Tokens are allowed but rarely needed.
- answer: two paragraphs expanding the capsule.
- sections: two or three, each with an h2 and some of paras, list, table (use [] or null for the parts not used). Tables are where comparisons belong.
- evidence: a hotel query whose matching properties are rendered as a linked table under the answer, or null when no hotel query fits (villa and pure journey topics). It queries the hotel feed only.
- faqs: three real follow-up questions with direct answers.
- related: two to four links, chosen only from the allowed links listed below.`;

function contextBlock() {
  return [
    'VOCABULARY (value and how many rows it matches):',
    vocabularyText(vocab),
    '',
    'ALLOWED LINKS for related[].href:',
    [...VALID_HREFS].sort().join(' '),
    '',
    'EXISTING ANSWERS (do not duplicate them; link to them where relevant):',
    [...existing, ...generatedAnswers].map(a => `- ${a.slug}: ${a.question}`).join('\n'),
    '',
    'TWO PUBLISHED ANSWERS, as the standard to match (their review_notes field is absent because it is never published):',
    JSON.stringify(EXAMPLES, null, 1),
  ].join('\n');
}

// ── the model call ──────────────────────────────────────────────────────────
const client = new Anthropic();

async function ask(messages) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: ANSWER_SCHEMA },
    },
    system: [
      { type: 'text', text: SYSTEM },
      // Identical across every topic this run, so the second and third drafts
      // read it from cache.
      { type: 'text', text: contextBlock(), cache_control: { type: 'ephemeral' } },
    ],
    messages,
  });
  const message = await stream.finalMessage();
  const u = message.usage;
  console.log(
    `    ${message.model}: ${u.input_tokens} in (+${u.cache_read_input_tokens || 0} cached), ${u.output_tokens} out, stop=${message.stop_reason}`,
  );
  return message;
}

function parseAnswer(message) {
  if (message.stop_reason === 'refusal') throw new Error('the model declined this topic');
  if (message.stop_reason === 'max_tokens') throw new Error('the draft was cut off at max_tokens');
  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}

/** The schema forces every key; the pages expect absent keys instead of empty ones. */
function tidy(raw, topic, notes) {
  const a = {
    slug: slugify(raw.slug) || topic.id,
    category: raw.category,
    question: raw.question,
    title: raw.title,
    description: raw.description,
    updated: today,
    capsule: raw.capsule,
    answer: raw.answer,
    sections: raw.sections.map(s => {
      const out = { h2: s.h2 };
      if (s.table) {
        out.table = { columns: s.table.columns, rows: s.table.rows };
        if (s.table.caption) out.table = { caption: s.table.caption, ...out.table };
      }
      if (s.paras.length) out.paras = s.paras;
      if (s.list.length) out.list = s.list;
      return out;
    }),
  };
  if (raw.evidence) a.evidence = raw.evidence;
  a.faqs = raw.faqs;
  a.related = raw.related.filter(r => {
    if (VALID_HREFS.has(r.href)) return true;
    notes.push(`Dropped a related link to ${r.href}, which is not a page on the site.`);
    return false;
  });
  const taken = new Set([...existing, ...generatedAnswers].map(x => x.slug));
  if (taken.has(a.slug)) a.slug = `${a.slug}-${today.slice(0, 7)}`;
  return a;
}

// ── the gate ────────────────────────────────────────────────────────────────
function writeGenerated(list) {
  const header = fs.readFileSync(GENERATED, 'utf8').split('export const generatedAnswers')[0];
  fs.writeFileSync(
    GENERATED,
    `${header}export const generatedAnswers = ${JSON.stringify(list, null, 2)};\n`,
  );
}

/** verify-seo's failures for one slug, or [] when the page passes. */
function verify(slug) {
  const run = spawnSync(process.execPath, ['scripts/verify-seo.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (run.status === 0) return [];
  const mine = (run.stderr || '')
    .split('\n')
    .filter(l => l.includes('✗') && l.includes(`${slug}:`))
    .map(l => l.replace(/^\s*✗\s*/, ''));
  // Failing for a reason that is not this page (a sync broke an older answer)
  // is not this draft's problem, and must not be fed back to the model as if
  // it were.
  return mine;
}

// ── main ────────────────────────────────────────────────────────────────────
const backlog = JSON.parse(fs.readFileSync(BACKLOG, 'utf8'));
const queued = backlog.topics.filter(t => t.status === 'queued').slice(0, COUNT);

if (!queued.length) {
  console.log('The backlog has no queued topics. Add some to data/answers/backlog.json.');
  fs.writeFileSync(PR_BODY, '');
  process.exit(0);
}

if (DRY_RUN) {
  console.log(`Would draft: ${queued.map(t => t.id).join(', ')}\n`);
  console.log(SYSTEM, '\n\n', contextBlock().slice(0, 4000), '\n…');
  process.exit(0);
}

const drafted = [];
const failed = [];
let list = [...generatedAnswers];

for (const topic of queued) {
  console.log(`\n● ${topic.id}`);
  const notes = [];
  const messages = [
    {
      role: 'user',
      content: `Write the answer page for this topic.\n\nCategory: ${topic.category}\nQuestion: ${topic.question}\nBrief: ${topic.angle}`,
    },
  ];
  let answer = null;
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !answer; attempt += 1) {
    let raw;
    try {
      const message = await ask(messages);
      raw = parseAnswer(message);
      messages.push({ role: 'assistant', content: message.content });
    } catch (err) {
      // An API failure (bad key, no credit, an outage) says nothing about the
      // topic. Failing the run leaves every topic queued for next time and
      // makes GitHub send its failure email; the first version marked the
      // topic `failed` and reported success, which is how a mistyped secret
      // quietly burned a topic.
      if (err instanceof Anthropic.APIError) {
        console.error(`\nThe Claude API refused the request: ${err.message}`);
        if (err.status === 401) console.error('Check the ANTHROPIC_API_KEY repository secret.');
        process.exit(1);
      }
      lastError = err.message;
      console.log(`    attempt ${attempt}: ${lastError}`);
      break; // a refusal or an API failure will not improve by asking again
    }

    const candidate = tidy(raw, topic, notes);
    writeGenerated([...list, candidate]);
    const problems = verify(candidate.slug);
    if (!problems.length) {
      answer = { ...candidate, review_notes: raw.review_notes };
      break;
    }
    lastError = problems.join('; ');
    console.log(`    attempt ${attempt} failed verification: ${lastError}`);
    messages.push({
      role: 'user',
      content: `The site's verifier rejected that draft:\n${problems.map(p => `- ${p}`).join('\n')}\nReturn the complete corrected page. Use only token values from the vocabulary.`,
    });
  }

  if (answer) {
    const { review_notes: reviewNotes, ...page } = answer;
    list = [...list, page];
    writeGenerated(list);
    Object.assign(topic, { status: 'drafted', drafted: today, slug: page.slug });
    drafted.push({ page, notes: [...notes, ...reviewNotes] });
    console.log(`    ✓ /answers/${page.slug}`);
  } else {
    writeGenerated(list); // take the failed candidate back out
    Object.assign(topic, { status: 'failed', drafted: today, error: lastError.slice(0, 500) });
    failed.push({ topic, error: lastError });
    console.log(`    ✗ dropped`);
  }
}

fs.writeFileSync(BACKLOG, `${JSON.stringify(backlog, null, 2)}\n`);

// ── the reviewer's brief ────────────────────────────────────────────────────
const left = backlog.topics.filter(t => t.status === 'queued').length;
const body = [
  `Monthly answer pages drafted by \`scripts/draft-answers.mjs\` (${MODEL}). All drafts passed \`verify:seo\`: every count is a live query against the feed, and every link resolves.`,
  '',
  '**Nothing publishes until this PR is merged.** Read each page and check the notes below; edit `next-concierge/data/answers/generated.js` directly on this branch if anything needs changing.',
  '',
  ...drafted.flatMap(({ page, notes }) => [
    `### ${page.question}`,
    `\`/answers/${page.slug}\` · ${page.category}`,
    '',
    `> ${page.capsule}`,
    '',
    notes.length ? 'Check before merging:' : 'No specific claims flagged.',
    ...notes.map(n => `- [ ] ${n}`),
    '',
  ]),
  ...(failed.length
    ? ['### Topics that could not be drafted', ...failed.map(f => `- \`${f.topic.id}\`: ${f.error}`), '']
    : []),
  `${left} topic${left === 1 ? '' : 's'} left in the backlog.${left < COUNT * 2 ? ' **Add more to `data/answers/backlog.json` soon.**' : ''}`,
].join('\n');
fs.writeFileSync(PR_BODY, drafted.length || failed.length ? body : '');

console.log(`\n${drafted.length} drafted, ${failed.length} failed, ${left} left in the backlog.`);

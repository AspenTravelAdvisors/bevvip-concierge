#!/usr/bin/env node
// Tells Bing (and the other IndexNow engines) which pages changed in the deploy
// that just went live.
//
// ChatGPT's search reads largely from Bing's index, so a page Bing has not
// crawled yet is a page ChatGPT cannot cite. Without this, Bing finds a new
// answer page or a newly added property whenever it next gets round to the
// sitemap, which can be weeks. With it, Bing is told within minutes of the
// deploy. Run by .github/workflows/indexnow.yml after every production deploy.
//
// WHAT COUNTS AS CHANGED. IndexNow asks for changed URLs only, not the whole
// site every night, so the sitemap is compared with the copy this script saved
// on its last run:
//
//   - a URL that is new, or that has disappeared (IndexNow takes removals too;
//     the engine re-fetches it, gets the 404, and drops it);
//   - a URL whose <lastmod> moved, but only where <lastmod> means something.
//     Answer pages carry the date their claims were last verified. The ~4,600
//     entity pages carry the build time (see app/sitemap.js), which moves on
//     every deploy whether the page changed or not. That build time is the
//     value most URLs share, so it is detected as the most common <lastmod>
//     and ignored: comparing it would resubmit the whole site nightly.
//
// With no saved copy (the first run, or the cache expired) every URL is sent
// once. That is IndexNow's own advice for a site's first submission.
//
//   node scripts/indexnow.mjs --state .indexnow/sitemap.json
//   node scripts/indexnow.mjs --state .indexnow/sitemap.json --dry-run
//
// Env: INDEXNOW_KEY (required; public by design, it is served at /<key>.txt),
//      SITE_URL (default https://guide.expeditionbucketlist.com).

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY_RUN = args.includes('--dry-run');
const STATE = opt('state', '.indexnow/sitemap.json');
const SITE = new URL(process.env.SITE_URL || 'https://guide.expeditionbucketlist.com').origin;
const KEY = (process.env.INDEXNOW_KEY || '').trim();
const ENDPOINT = 'https://api.indexnow.org/indexnow';
// The protocol's per-request ceiling.
const BATCH = 10_000;

if (!/^[a-zA-Z0-9-]{8,128}$/.test(KEY)) {
  console.error('INDEXNOW_KEY is missing or malformed (8-128 letters, digits or dashes).');
  process.exit(1);
}

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'indexnow-submit (+github actions)' } });
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return res.text();
}

/** sitemap.xml → Map(url → lastmod). Next writes a flat urlset, no index. */
function parseSitemap(xml) {
  const urls = new Map();
  for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/)?.[1] ?? '';
    urls.set(loc.replace(/&amp;/g, '&'), lastmod);
  }
  return urls;
}

/** The <lastmod> most URLs share: the build time, which says nothing per page. */
function buildStamp(urls) {
  const tally = new Map();
  for (const m of urls.values()) tally.set(m, (tally.get(m) || 0) + 1);
  let best = '';
  let n = 0;
  for (const [m, c] of tally) if (c > n) [best, n] = [m, c];
  return n > 1 ? best : null;
}

function changedUrls(now, before) {
  if (!before) return [...now.keys()];
  const nowStamp = buildStamp(now);
  const beforeStamp = buildStamp(before);
  const meaningful = (m, stamp) => m && m !== stamp;
  const out = [];
  for (const [url, mod] of now) {
    if (!before.has(url)) out.push(url);
    else {
      const was = before.get(url);
      if (meaningful(mod, nowStamp) && meaningful(was, beforeStamp) && mod !== was) out.push(url);
    }
  }
  for (const url of before.keys()) if (!now.has(url)) out.push(url);
  return out;
}

// The key file has to be live on the host before any engine will accept the
// key, so check it first: a 403 from IndexNow is much harder to read.
const served = await get(`${SITE}/${KEY}.txt`).then((t) => t.trim(), () => null);
if (served !== KEY) {
  console.error(`${SITE}/${KEY}.txt does not contain the key. Is public/${KEY}.txt deployed?`);
  process.exit(1);
}

const now = parseSitemap(await get(`${SITE}/sitemap.xml`));
if (now.size === 0) {
  console.error('sitemap.xml parsed to zero URLs; refusing to treat that as "every page was removed".');
  process.exit(1);
}

let before = null;
if (fs.existsSync(STATE)) {
  try {
    before = new Map(Object.entries(JSON.parse(fs.readFileSync(STATE, 'utf8'))));
  } catch {
    console.warn(`${STATE} is unreadable; treating this as a first run.`);
  }
}

const changed = changedUrls(now, before);
// A new or re-verified answer also changes the index that lists it.
if (changed.some((u) => u.startsWith(`${SITE}/answers/`)) && !changed.includes(`${SITE}/answers`)) {
  changed.push(`${SITE}/answers`);
}

console.log(
  before
    ? `${now.size} URLs in the sitemap, ${before.size} last run; ${changed.length} to submit.`
    : `${now.size} URLs in the sitemap and no previous copy; submitting all of them once.`,
);
for (const u of changed.slice(0, 50)) console.log(`  ${u}`);
if (changed.length > 50) console.log(`  … and ${changed.length - 50} more`);

if (DRY_RUN) {
  console.log('Dry run: nothing submitted, state not saved.');
  process.exit(0);
}

const host = new URL(SITE).host;
for (let i = 0; i < changed.length; i += BATCH) {
  const urlList = changed.slice(i, i + BATCH);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList }),
  });
  // 200 and 202 are both success; 202 means the key is still being checked.
  if (res.status !== 200 && res.status !== 202) {
    console.error(`IndexNow answered ${res.status}: ${(await res.text()).slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`Submitted ${urlList.length} URLs (${res.status}).`);
}

// Saved only after every batch was accepted, so a failed run retries the same
// changes next time instead of losing them.
fs.mkdirSync(path.dirname(STATE), { recursive: true });
fs.writeFileSync(STATE, JSON.stringify(Object.fromEntries(now)));
console.log(`Saved ${now.size} URLs to ${STATE}.`);

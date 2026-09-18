#!/usr/bin/env node
/**
 * The monthly drift report for the two jet brands nobody's API feeds us.
 *
 * WHY THIS EXISTS
 *
 * Every other collection in the atlas restocks itself. `sync:virtuoso` pulls
 * the Partner API, `merge:virtuoso-journeys` rebuilds the five atlases from it,
 * and a departure that sells out or a season that opens arrives without anyone
 * deciding it should. Two brands are outside that loop entirely:
 *
 *   National Geographic   9 curated departures, built by us from Nat Geo's own
 *                         published dates. The Virtuoso tours feed carries 102
 *                         jet tours and not one of them is Nat Geo.
 *   Safrans du Monde     18 curated departures, read off safransdumonde.com.
 *                         A Paris maison with no Virtuoso relationship at all.
 *
 * The merge keeps them — `buildTourAtlas` preserves every base trip with no
 * virtuoso.com link, which is precisely these 27 — but keeping is not the same
 * as refreshing. Left alone they only ever shrink: `dropPast()` retires each
 * departure as it sails, and nothing adds the next season. That decay is
 * invisible on the globe (a smaller atlas looks like a normal atlas) and it is
 * invisible in The Guide (fewer results looks like a narrow query). It shows up
 * first as a landing-page card that links to an empty filter, which is the one
 * place a traveller notices.
 *
 * So this counts the runway, checks the two landing pages still point at
 * journeys that exist, and says when the copies we do not control — the EBL
 * website page and the nge-private-jet deploy — have fallen behind the data.
 *
 * It is a REPORT, not a build gate. A season Nat Geo has not announced yet is
 * not a defect, and failing `npm run build` over it would only teach everyone
 * to skip the check. `--strict` exits non-zero on the findings that are ours
 * rather than a supplier's: broken deep links and a split-brain between the two
 * copies of the feed.
 *
 *   node scripts/audit-curated-jet.mjs
 *   node scripts/audit-curated-jet.mjs --strict
 *   node scripts/audit-curated-jet.mjs --json
 *   node scripts/audit-curated-jet.mjs --record   # after publishing the pages
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { repoRoot } from '../lib/virtuoso/env.mjs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const JSON_OUT = args.includes('--json');
const RECORD = args.includes('--record');

/**
 * How much runway a curated brand should carry.
 *
 * Six months is not arbitrary: Safrans publishes a season about a year out and
 * Nat Geo two, so a brand down to its last two quarters has already missed at
 * least one announcement. Three months is the point at which a landing page is
 * about to start emptying out in front of a traveller.
 */
const RUNWAY_WARN_MONTHS = 6;
const RUNWAY_URGENT_MONTHS = 3;
const MIN_BOOKABLE = 3;

const BASE_REL = 'data/atlas/jet/itinerary.base.json';
const MERGED_REL = 'data/atlas/jet/itinerary.json';
const PUBLIC_REL = 'public/maps/jet/itinerary.json';
const STATE_REL = 'data/atlas/shared/curated-jet-publish.json';
const SAFRANS_PAGE_REL = 'public/safrans-du-monde.html';

/**
 * The surfaces that carry this data and live somewhere we cannot deploy.
 *
 * `repo` is the file in this repository that is the source of truth for the
 * surface; when its fingerprint moves, the copy out there is stale. Nat Geo has
 * no repo file because its page is a separate Vercel app — the fingerprint is
 * the departure list itself, which is what that app renders.
 */
const SURFACES = {
  safrans: {
    label: 'Safrans du Monde landing page',
    repo: SAFRANS_PAGE_REL,
    live: 'expeditionbucketlist.com (pasted HTML) + guide.expeditionbucketlist.com/safrans-du-monde.html',
    republish: 'Redeploy this app for the /safrans-du-monde.html copy, then paste the same file into the EBL website block (swapping the relative /atlas/jet links for https://guide.expeditionbucketlist.com/atlas/jet).',
  },
  natgeo: {
    label: 'National Geographic private jet page',
    repo: null,
    live: 'nge-private-jet.vercel.app (iframed into expeditionbucketlist.com)',
    republish: 'Update and redeploy the nge-private-jet app so its itinerary list matches the atlas.',
  },
};

const read = rel => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
const exists = rel => fs.existsSync(path.join(repoRoot, rel));

const findings = [];
const finding = (level, area, message, detail) =>
  findings.push({ level, area, message, ...(detail ? { detail } : {}) });

// ── the shape of a curated trip ─────────────────────────────────────────────

/** Bespoke is defined by the absence of a supplier link, exactly as the merge defines it. */
const isBespoke = t => !/virtuoso\.com/.test(t.u ?? '');

/** "10/22/2026" -> "2026-10-22". The jet feed stores M/D/YYYY; everything here sorts ISO. */
function iso(mdy) {
  const m = String(mdy ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

const todayISO = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** Whole months from today to an ISO date, negative in the past. */
function monthsOut(target, from = todayISO()) {
  if (!target) return null;
  const [ty, tm, td] = target.split('-').map(Number);
  const [fy, fm, fd] = from.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

// ── 1. parity ───────────────────────────────────────────────────────────────

/*
 * The jet feed ships twice and nothing keeps the copies in sync: lib/atlas/
 * journeys.js reads data/atlas/jet/itinerary.json for The Guide, AtlasJet.tsx
 * fetches /maps/jet/itinerary.json for the globe. Editing one and not the other
 * is a split-brain in which the concierge recommends a departure the map has
 * never heard of. The merge writes both; a hand edit to the merged file writes
 * one. This is the check that catches the hand edit.
 */
function checkParity() {
  const base = read(BASE_REL);
  const merged = read(MERGED_REL);
  const pub = exists(PUBLIC_REL) ? read(PUBLIC_REL) : null;

  const baseBespoke = (base.TRIPS ?? []).filter(isBespoke);
  const mergedBespoke = (merged.TRIPS ?? []).filter(isBespoke);

  if (baseBespoke.length !== mergedBespoke.length) {
    finding('error', 'parity',
      `base carries ${baseBespoke.length} curated trips, the merged atlas ${mergedBespoke.length}`,
      'Run `npm run merge:virtuoso-journeys` — the merged atlas is rebuilt from the base, never edited directly.');
  }

  if (!pub) {
    finding('error', 'parity', `${PUBLIC_REL} is missing — the globe has no feed to fetch`);
  } else {
    const a = JSON.stringify(merged.TRIPS ?? []);
    const b = JSON.stringify(pub.TRIPS ?? []);
    if (a !== b) {
      finding('error', 'parity',
        `${MERGED_REL} and ${PUBLIC_REL} disagree (${(merged.TRIPS ?? []).length} vs ${(pub.TRIPS ?? []).length} trips)`,
        'The Guide and the globe are reading different inventory. `npm run merge:virtuoso-journeys` writes both.');
    }
  }

  /*
   * jt_<arrayIndex> IS the id — see the WARNING in lib/atlas/adapters/jet.ts.
   * The merge emits the bespoke block first, in base order, so the curated
   * trips own jt_0..jt_<n-1> and every shared deep link into them depends on
   * that block not being reordered. Inserting a new departure anywhere but the
   * END of the bespoke run silently repoints every link after it.
   */
  const leading = (merged.TRIPS ?? []).findIndex(t => !isBespoke(t));
  const bespokeIsContiguous = leading === -1 || leading === mergedBespoke.length;
  if (!bespokeIsContiguous) {
    finding('error', 'parity',
      `the curated block is no longer contiguous at the head of TRIPS (first supplier trip at index ${leading}, ${mergedBespoke.length} curated)`,
      'Every jt_ deep link into a curated journey has moved. Restore base order before publishing.');
  }

  return { base, merged, baseBespoke, mergedBespoke };
}

// ── 2. runway ───────────────────────────────────────────────────────────────

function brandRunway(merged) {
  const BRANDS = merged.BRANDS ?? {};
  const today = todayISO();
  const byBrand = new Map();

  for (const t of (merged.TRIPS ?? []).filter(isBespoke)) {
    const key = t.b ?? '(unbranded)';
    if (!byBrand.has(key)) byBrand.set(key, []);
    byBrand.get(key).push(t);
  }

  const rows = [];
  for (const [key, trips] of byBrand) {
    const dated = trips.map(t => ({ trip: t, start: iso(t.d) })).filter(x => x.start);
    const undated = trips.length - dated.length;
    const future = dated.filter(x => x.start >= today).sort((a, b) => a.start.localeCompare(b.start));
    const departed = dated.length - future.length;
    const last = future.length ? future[future.length - 1].start : null;
    const runway = monthsOut(last, today);

    rows.push({
      brand: key,
      label: BRANDS[key]?.short ?? key,
      curated: trips.length,
      departed,
      undated,
      bookable: future.length + undated,
      nextDeparture: future.length ? future[0].start : null,
      lastDeparture: last,
      runwayMonths: runway,
      itineraries: [...new Set(future.map(x => x.trip.n))].length,
    });
  }

  for (const r of rows.sort((a, b) => a.label.localeCompare(b.label))) {
    if (r.bookable === 0) {
      finding('error', 'runway',
        `${r.label} has no bookable departures left — all ${r.curated} have sailed`,
        `Any landing page or Explore entry pointing at brand=${r.brand} is now an empty filter.`);
      continue;
    }
    if (r.bookable < MIN_BOOKABLE) {
      finding('warn', 'runway',
        `${r.label} is down to ${r.bookable} bookable departure${r.bookable === 1 ? '' : 's'}`,
        `Restock from the supplier's published calendar.`);
    }
    if (r.runwayMonths != null && r.runwayMonths <= RUNWAY_URGENT_MONTHS) {
      finding('warn', 'runway',
        `${r.label} runs out in ${r.runwayMonths} month${r.runwayMonths === 1 ? '' : 's'} (last departure ${r.lastDeparture})`,
        'Check the supplier for the next season — this is past the point where the page starts emptying.');
    } else if (r.runwayMonths != null && r.runwayMonths <= RUNWAY_WARN_MONTHS) {
      finding('note', 'runway',
        `${r.label} has ${r.runwayMonths} months of runway (last departure ${r.lastDeparture})`,
        'The supplier has probably announced a season we have not picked up.');
    }
  }
  return rows;
}

// ── 3. landing pages ────────────────────────────────────────────────────────

/**
 * Pull the JOURNEYS array out of the Safrans page.
 *
 * The page is a static card deck with its inventory hard-coded in a script tag,
 * and each card links into the atlas as `?brand=safrans&q=<card.q>`. That query
 * is the join between a card and the journeys it claims to represent, and
 * nothing enforces it: retire a departure from the atlas and the card stays,
 * pointing at a filter that now returns nothing.
 *
 * Evaluated rather than regexed because it is an object literal with a `IMG +`
 * concatenation in it, and half-parsing that with a pattern is how you get a
 * checker that silently stops finding cards.
 */
function readSafransCards() {
  if (!exists(SAFRANS_PAGE_REL)) return null;
  const html = fs.readFileSync(path.join(repoRoot, SAFRANS_PAGE_REL), 'utf8');
  const start = html.indexOf('const JOURNEYS');
  if (start === -1) return null;
  const open = html.indexOf('[', start);
  const end = html.indexOf('\n];', open);
  if (open === -1 || end === -1) return null;
  const literal = html.slice(open, end + 2);
  try {
    return vm.runInNewContext(`(${literal})`, { IMG: '' }, { timeout: 1000 });
  } catch {
    return null;
  }
}

function checkSafransPage(journeysLib) {
  const cards = readSafransCards();
  if (!cards) {
    finding('warn', 'landing', `could not read the card deck out of ${SAFRANS_PAGE_REL}`,
      'The page structure changed; this check is now blind to dead links.');
    return [];
  }

  const rows = [];
  for (const card of cards) {
    const params = { brand: 'Safrans du Monde', limit: 24 };
    if (card.q) params.q = card.q;
    const hits = journeysLib.query(params);
    const starts = hits.results.map(r => iso(r.startDate)).filter(Boolean).sort();
    const years = [...new Set(starts.map(s => s.slice(0, 4)))];

    rows.push({
      title: card.title,
      year: card.year || null,
      q: card.q ?? null,
      matches: hits.total,
      departures: starts,
    });

    if (hits.total === 0) {
      finding('error', 'landing',
        `"${card.title}"${card.year ? ` (${card.year})` : ''} links to an empty atlas filter`,
        `?brand=safrans&q=${encodeURIComponent(card.q ?? '')} returns nothing. Either restock the journey or retire the card.`);
      continue;
    }
    /*
     * The year on a card is a label, not a filter, so it drifts silently: the
     * card keeps saying 2026 while the only surviving departure is in 2027.
     * A traveller reads the label and the atlas answers with something else.
     */
    if (card.year && years.length && !years.some(y => String(card.year).includes(y))) {
      finding('warn', 'landing',
        `"${card.title}" is labelled ${card.year} but its live departures are ${years.join(', ')}`,
        'Update the card year, or the label contradicts the atlas it links to.');
    }
  }
  return rows;
}

// ── 4. publish drift ────────────────────────────────────────────────────────

/**
 * A short, order-independent fingerprint of what a surface is supposed to show.
 *
 * Order-independent on purpose: re-running the merge can reshuffle nothing here
 * but a future one might, and a fingerprint that changes when the data has not
 * would cry wolf every month until people stopped reading it.
 */
function fingerprintDepartures(trips) {
  const lines = trips
    .map(t => `${iso(t.d) ?? '?'}|${t.n}|${t.days ?? '?'}`)
    .sort();
  return hash(lines.join('\n'));
}

function hash(text) {
  // FNV-1a, 32-bit. Not a security primitive — a change detector, and one that
  // needs no import and produces a value short enough to read in a diff.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function currentFingerprints(merged) {
  const out = {};
  for (const [brand, surface] of Object.entries(SURFACES)) {
    const trips = (merged.TRIPS ?? []).filter(t => isBespoke(t) && t.b === brand);
    out[brand] = {
      departures: fingerprintDepartures(trips),
      ...(surface.repo && exists(surface.repo)
        ? { page: hash(fs.readFileSync(path.join(repoRoot, surface.repo), 'utf8')) }
        : {}),
    };
  }
  return out;
}

function checkPublishDrift(merged) {
  const now = currentFingerprints(merged);
  const state = exists(STATE_REL) ? read(STATE_REL) : { _meta: {}, published: {} };
  const published = state.published ?? {};

  for (const [brand, surface] of Object.entries(SURFACES)) {
    const was = published[brand];
    if (!was) {
      finding('note', 'publish',
        `${surface.label} has never been recorded as published`,
        `Publish it, then run this with --record so the next month has something to compare against.`);
      continue;
    }
    const changed = [];
    if (was.departures !== now[brand].departures) changed.push('departures');
    if (now[brand].page && was.page !== now[brand].page) changed.push('page HTML');
    if (changed.length) {
      finding('alert', 'publish',
        `${surface.label} is stale — ${changed.join(' and ')} changed since ${was.at ?? 'the last recorded publish'}`,
        `${surface.live}\n  ${surface.republish}`);
    }
  }

  if (RECORD) {
    const next = {
      _meta: {
        note: 'What the out-of-repo surfaces were last published with. Written by scripts/audit-curated-jet.mjs --record.',
        updated: new Date().toISOString(),
      },
      published: Object.fromEntries(
        Object.entries(now).map(([brand, fp]) => [brand, { ...fp, at: new Date().toISOString().slice(0, 10) }]),
      ),
    };
    fs.writeFileSync(path.join(repoRoot, STATE_REL), `${JSON.stringify(next, null, 2)}\n`);
    console.log(`recorded ${STATE_REL}`);
  }

  return now;
}

// ── 5. advisor fit alignment ────────────────────────────────────────────────

/**
 * Is every jet journey still described by its own fit row?
 *
 * The jet id is an array position (`jt_<arrayIndex>`), and itinerary-fit.json
 * was keyed with those positions, so the rows drifted off their trips the first
 * time the merge re-emitted TRIPS in a different order. lib/atlas/supplier-fit
 * now binds a row by identity and drops one it cannot show describes the
 * record, which is what keeps this at zero.
 *
 * It is checked here rather than trusted because every curated trip added
 * shifts the block again — this is the number that says whether the resolver is
 * still holding.
 *
 * `brandId` is NOT the comparison: it is a slug from the brand registry and
 * does not spell the atlas's own label ("National Geographic-Lindblad
 * Expeditions" is brandId `lindblad`). Comparing the two produces a large,
 * confident, entirely false misalignment count. The row's advisorNote opens
 * with the supplier's display name, which is the like-for-like check.
 */
function checkFitAlignment(journeysLib) {
  const { fitRowFor } = require(path.join(repoRoot, 'lib/atlas/supplier-fit.js'));
  const norm = s => String(s ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const noteBrand = row => String(row.advisorNote ?? '').split(';')[0].trim();

  let bound = 0, wrong = 0, absent = 0;
  for (const j of journeysLib.journeys) {
    const row = fitRowFor(j);
    if (!row) { absent++; continue; }
    if (norm(noteBrand(row)) === norm(j.brand)) bound++; else wrong++;
  }

  if (wrong) {
    finding('error', 'fit',
      `${wrong} of ${journeysLib.journeys.length} jet journeys are bound to a fit row describing a different supplier`,
      'The resolver in lib/atlas/supplier-fit.js should have dropped these. The Guide ranks intents on the row it binds, so a wrong row selects the wrong brand profile, overlay and advisor notes.');
  }
  if (absent > journeysLib.journeys.length * 0.75) {
    finding('note', 'fit',
      `${absent} of ${journeysLib.journeys.length} jet journeys have no fit row at all`,
      'Ranking falls back to the brand profile for these. Regenerating the jet fit data would sharpen intent ranking.');
  }
  return { bound, wrong, absent };
}

// ── report ──────────────────────────────────────────────────────────────────

const LEVELS = { error: 0, alert: 1, warn: 2, note: 3 };
const MARK = { error: '✗', alert: '▲', warn: '!', note: '·' };

function main() {
  const { merged } = checkParity();
  const journeysLib = require(path.join(repoRoot, 'lib/atlas/journeys.js'));

  const runway = brandRunway(merged);
  const cards = checkSafransPage(journeysLib);
  const fingerprints = checkPublishDrift(merged);
  const fit = checkFitAlignment(journeysLib);

  const sorted = [...findings].sort((a, b) => LEVELS[a.level] - LEVELS[b.level]);
  const blocking = findings.filter(f => f.level === 'error').length;

  if (JSON_OUT) {
    console.log(JSON.stringify({
      generated: new Date().toISOString(),
      today: todayISO(),
      runway, cards, fingerprints, fit, findings: sorted, blocking,
    }, null, 2));
    process.exitCode = STRICT && blocking ? 1 : 0;
    return;
  }

  console.log(`\nCURATED JET BRANDS — ${todayISO()}\n`);

  console.log('  RUNWAY');
  for (const r of runway) {
    const runwayLabel = r.runwayMonths == null ? '—' : `${r.runwayMonths}mo`;
    console.log(
      `    ${r.label.padEnd(24)} ${String(r.bookable).padStart(2)} bookable of ${String(r.curated).padStart(2)} curated` +
      ` · ${String(r.itineraries).padStart(2)} itineraries` +
      ` · next ${r.nextDeparture ?? '—'} · last ${r.lastDeparture ?? '—'} (${runwayLabel})`);
  }

  if (cards.length) {
    console.log('\n  SAFRANS LANDING PAGE');
    for (const c of cards) {
      const mark = c.matches === 0 ? '✗' : ' ';
      console.log(`    ${mark} ${(c.title + (c.year ? ` (${c.year})` : '')).padEnd(46)} ${String(c.matches).padStart(2)} match${c.matches === 1 ? ' ' : 'es'}` +
        (c.departures.length ? ` · ${c.departures.join(', ')}` : ''));
    }
  }

  console.log('\n  ADVISOR FIT');
  console.log(`    ${fit.bound} correctly bound · ${fit.wrong} bound to the wrong supplier · ${fit.absent} without a row`);

  if (sorted.length) {
    console.log('\n  FINDINGS');
    for (const f of sorted) {
      console.log(`    ${MARK[f.level]} [${f.area}] ${f.message}`);
      if (f.detail) for (const line of f.detail.split('\n')) console.log(`        ${line}`);
    }
  } else {
    console.log('\n  FINDINGS\n    none — both brands are stocked and every card resolves.');
  }

  console.log(`\n  ${blocking} blocking · ${findings.length} total\n`);
  process.exitCode = STRICT && blocking ? 1 : 0;
}

main();

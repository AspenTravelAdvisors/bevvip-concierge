#!/usr/bin/env node
// Maps our local hotel records onto Virtuoso product IDs.
//
// Every later step — adopting supplier categories, attaching photos, collapsing
// duplicates, re-keying the ranking overlays — depends on this mapping, so it is
// written out as a reviewable ledger rather than recomputed silently at build
// time. Hand-corrections go in `overrides` and always win; that is the escape
// hatch for the cases fuzzy matching gets wrong.
//
//   node scripts/match-virtuoso-hotels.mjs           # rebuild the ledger
//   node scripts/match-virtuoso-hotels.mjs --check   # fail if the ledger is stale
//   node scripts/match-virtuoso-hotels.mjs --report  # show what matched and how

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/virtuoso/env.mjs';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const REPORT = args.includes('--report');
const FEED_OVERRIDE = (() => { const i = args.indexOf('--feed'); return i >= 0 ? args[i + 1] : null; })();

// The curated base, never the merged output — matching against our own merge
// result would feed adopted supplier names back into the matcher.
const LOCAL_FILE = path.join(repoRoot, 'data/atlas/hotel/luxury-hotels.base.json');
const FEED_FILE = FEED_OVERRIDE ? path.resolve(FEED_OVERRIDE) : path.join(repoRoot, 'data/atlas/hotel/virtuoso-hotels.json');
const MAP_FILE = path.join(repoRoot, 'data/atlas/hotel/virtuoso-id-map.json');
const DRY = Boolean(FEED_OVERRIDE);   // a substitute feed must never overwrite the real ledger

// ---------- name normalization ----------

const deaccent = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Words that carry no identity: two records differing only by these are the same hotel.
const NOISE = /\b(hotel|hotels|resort|resorts|spa|the|a|an|and|by|at|de|del|la|le|les|relais|chateaux|chateau|collection|lodge|inn|club|luxury|autograph|mgallery)\b/g;

const normName = s => deaccent(s).toLowerCase()
  .replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ')
  .replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

// API cities sometimes embed the region ("Edinburgh, Scotland"); ours don't.
const normCity = s => normName(String(s ?? '').split(',')[0]);

const normCountry = s => {
  const c = normName(s);
  const alias = { 'usa': 'united states', 'us': 'united states', 'uk': 'united kingdom', 'united states of america': 'united states' };
  return alias[c] ?? c;
};

/** Token-overlap similarity — forgiving about word order and extra words. */
function tokenSimilarity(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/** Levenshtein distance, two rows at a time. */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Character-level similarity, 0–1. */
function charSimilarity(a, b) {
  const len = Math.max(a.length, b.length);
  return len ? 1 - editDistance(a, b) / len : 0;
}

/*
 * Name similarity: tokens, or characters when the tokens have been broken by a
 * typo.
 *
 * Token overlap alone scores "Sonnenaip Hotel" against "Sonnenalp Hotel" at
 * ZERO. Both normalise to a single identifying word, the words differ by one
 * letter, and a set intersection has no way to say so — so the misspelled twin
 * never reached the 0.6 gate, stayed unmatched, and shipped as a second Vail
 * property with no photograph, no description, and the wrong category. It is
 * not alone: "Bvlgari Resort Dubal", "Hotel II Pellicano", "II Salviatino",
 * "II Falconiere", "Glenio Abbey" and "Del'Europe Amsterdam" are all the same
 * l-for-i slip from an old import.
 *
 * The character measure fixes exactly that and nothing else. It is taken only
 * when it is very high, because the pairs it must NOT rescue sit well below:
 * "Canaves Oia Suites" against "Canaves Oia Sunday Suites" scores 0.72, "The
 * Ritz-Carlton Shanghai" against "The Portman Ritz-Carlton, Shanghai" 0.72, and
 * Fairmont against Four Seasons in San Francisco 0.69 — all real, distinct
 * hotels, and all safely under the bar. The typo twins score 0.89 to 0.95.
 *
 * Everything downstream is unchanged: a high score still has to survive the
 * distance gates before anything is called a duplicate.
 */
const TYPO_TWIN_MIN = 0.85;

function similarity(a, b) {
  const tokens = tokenSimilarity(a, b);
  if (tokens >= TYPO_TWIN_MIN) return tokens;
  const chars = charSimilarity(a, b);
  return chars >= TYPO_TWIN_MIN ? Math.max(tokens, chars) : tokens;
}

/** Metres between two local records — the tiebreaker fuzzy names can't provide. */
function metresApart(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return null;
  const R = 6371000, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// A local pair this close is the same building, whatever the names say.
const SAME_PROPERTY_METRES = 300;

// Two of OUR records standing on the same spot are the same hotel, full stop —
// duplicated rows inherit the geocode of the row they were copied from.
const SAME_GEOCODE_METRES = 50;

// How far our coordinate may sit from the supplier's before we stop believing
// the name. Strong name evidence buys tolerance for a sloppy geocode: a city
// block of drift on an all-but-identical name is a bad coordinate, not a
// different hotel.
const onSiteRadius = score => (score >= 0.9 ? 1000 : score >= 0.8 ? 600 : SAME_PROPERTY_METRES);

// ---------- matching ----------

function buildMap(local, feed) {
  const byNameCountry = new Map();
  const byNameCity = new Map();
  const byName = new Map();
  const push = (m, k, v) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

  for (const h of feed) {
    const n = normName(h.name);
    push(byNameCountry, `${n}|${normCountry(h.country)}`, h);
    push(byNameCity, `${n}|${normCity(h.city)}`, h);
    push(byName, n, h);
  }

  const matched = {};
  const ambiguous = [];
  const unmatchedLocal = [];
  const claimed = new Map();   // vid -> [local ids], to surface our own duplicates

  const exactly = (h) => {
    const n = normName(h.name);
    const inCountry = byNameCountry.get(`${n}|${normCountry(h.country)}`) ?? [];
    const inCity = byNameCity.get(`${n}|${normCity(h.city)}`) ?? [];
    if (inCountry.length === 1) return { hit: inCountry[0], how: 'name+country' };
    if (inCity.length === 1) return { hit: inCity[0], how: 'name+city' };
    if (inCountry.length > 1) {
      const narrowed = inCountry.filter(c => normCity(c.city) === normCity(h.city));
      if (narrowed.length === 1) return { hit: narrowed[0], how: 'name+country+city' };
      return { candidates: inCountry };
    }
    return {};
  };

  const record = (h, hit, how) => {
    matched[h.id] = { vid: hit.vid, how, localName: h.name, virtuosoName: hit.name };
    if (!claimed.has(hit.vid)) claimed.set(hit.vid, []);
    claimed.get(hit.vid).push(h.id);
  };

  // Pass 1 — exact matches only. These are authoritative and get first claim on
  // a Virtuoso product.
  const leftover = [];
  for (const h of local) {
    const { hit, how, candidates } = exactly(h);
    if (hit) record(h, hit, how);
    else if (candidates) ambiguous.push({ id: h.id, name: h.name, reason: 'several Virtuoso properties share this name in this country',
      candidates: candidates.map(c => ({ vid: c.vid, name: c.name, city: c.city })) });
    else leftover.push(h);
  }

  const exactlyClaimed = new Set(claimed.keys());
  const duplicates = [];

  // Pass 2 — fuzzy, for what is left. Prefer a Virtuoso product no exact match
  // has claimed: "Canaves Oia Sunday Suites" scores 0.86 against its neighbour
  // "Canaves Oia Suites" but has a product of its own, and taking the unclaimed
  // one keeps two real hotels from collapsing into one.
  //
  // When only a claimed product fits, that is usually not a mismatch — it is our
  // own duplicate, the short-name twin of a record already matched. Distance
  // decides: same building means duplicate, far apart means a human should look.
  for (const h of leftover) {
    const n = normName(h.name);

    // Score every candidate in the country on name AND distance. Scoring on name
    // alone let iteration order decide real ties: "The Ritz-Carlton Shanghai"
    // scores 0.857 against both "The Portman Ritz-Carlton, Shanghai" and "The
    // Ritz-Carlton Shanghai, Pudong", and whichever came first won. They are two
    // different hotels 5km apart, so distance is what actually separates them.
    const scored = [];
    for (const cand of feed) {
      if (normCountry(cand.country) !== normCountry(h.country)) continue;
      const score = similarity(n, normName(cand.name));
      if (score < 0.6) continue;
      scored.push({ cand, score, metres: metresApart(h, cand), free: !exactlyClaimed.has(cand.vid) });
    }

    // Near-equal names are separated by proximity; clearly better names win outright.
    const rank = (a, b) => {
      if (Math.abs(a.score - b.score) > 0.05) return b.score - a.score;
      const am = a.metres ?? Infinity, bm = b.metres ?? Infinity;
      if (am !== bm) return am - bm;
      return b.score - a.score;
    };
    scored.sort(rank);

    const qualifies = c => c && ((c.score >= 0.8 && normCity(c.cand.city) === normCity(h.city))
      || c.score >= 0.9 || (c.metres !== null && c.metres <= SAME_PROPERTY_METRES && c.score >= 0.6));

    const bestFree = scored.find(c => c.free && qualifies(c));
    if (bestFree) { record(h, bestFree.cand, `fuzzy:${bestFree.score.toFixed(2)}`); continue; }

    const best = scored.find(qualifies);
    if (!best) { unmatchedLocal.push({ id: h.id, name: h.name, city: h.city, country: h.country, program: h.program }); continue; }

    // Only a claimed product fits. Usually that means this is our own duplicate —
    // the short-name twin of a record already matched. Trust the supplier's
    // coordinate over ours: if either our record or its twin sits on the Virtuoso
    // property, it is the same hotel and one of our two geocodes is simply wrong.
    const twinId = claimed.get(best.cand.vid)?.[0];
    const twin = local.find(l => l.id === twinId);
    const ours = best.metres;
    const twinDist = metresApart(twin, best.cand);
    const radius = onSiteRadius(best.score);
    const twinsCoincide = metresApart(h, twin);
    const sameGeocode = twinsCoincide !== null && twinsCoincide <= SAME_GEOCODE_METRES;
    const onSite = sameGeocode
      || (ours !== null && ours <= radius)
      || (twinDist !== null && twinDist <= radius);

    if (onSite) {
      duplicates.push({ vid: best.cand.vid, virtuosoName: best.cand.name, keep: twinId, drop: h.id,
        keepName: twin?.name, dropName: h.name, score: Number(best.score.toFixed(2)),
        ourMetresFromSupplier: ours, twinMetresFromSupplier: twinDist,
        note: sameGeocode ? 'both our records carry the same coordinate'
          : ours !== null && ours > radius ? 'our coordinate for the dropped record was wrong' : undefined });
      record(h, best.cand, `duplicate-of:${twinId}`);
    } else {
      ambiguous.push({ id: h.id, name: h.name,
        reason: `best name match ${best.score.toFixed(2)} is already claimed; our record sits ${Math.round(ours ?? -1)}m and its twin ${Math.round(twinDist ?? -1)}m from the supplier's coordinate, and the two are ${Math.round(twinsCoincide ?? -1)}m apart — too far to call`,
        candidates: [{ vid: best.cand.vid, name: best.cand.name, city: best.cand.city }] });
    }
  }

  // Pass 3 — geography. A property that was rebranded ("Cheval The Edinburgh
  // Grand" -> "The Edinburgh Grand, a Luxury Collection Hotel") shares almost no
  // name with its Virtuoso record but stands in the same spot. Coordinates catch
  // what names cannot; a weak name check still guards against matching a
  // neighbouring hotel across the street.
  const GEO_MATCH_METRES = 200;
  const geoReview = [];
  const stillUnmatched = unmatchedLocal.splice(0, unmatchedLocal.length);
  for (const u of stillUnmatched) {
    const h = local.find(l => l.id === u.id);
    let best = null, bestDist = Infinity;
    for (const cand of feed) {
      if (claimed.has(cand.vid)) continue;
      const d = metresApart(h, cand);
      if (d !== null && d < bestDist) { bestDist = d; best = cand; }
    }
    if (!best || bestDist > GEO_MATCH_METRES) { unmatchedLocal.push(u); continue; }
    const score = similarity(normName(h.name), normName(best.name));
    if (score >= 0.35) record(h, best, `geo:${Math.round(bestDist)}m`);
    else {
      geoReview.push({ id: h.id, name: h.name, vid: best.vid, virtuosoName: best.name,
        metresApart: Math.round(bestDist), nameScore: Number(score.toFixed(2)),
        reason: 'same location, unrelated names — confirm before merging' });
      unmatchedLocal.push(u);
    }
  }

  /*
   * Pass 4 — our own short-name twins.
   *
   * What is left over now is largely one shape: our record calls the hotel what
   * a person calls it, and the supplier's calls it what the letterhead does.
   * "Brown's Hotel" and "Brown's Hotel, a Rocco Forte Hotel", nineteen metres
   * apart. "Shangri-La Bosphorus" and "Shangri-La Bosphorus, Istanbul", sixty-
   * nine. "Ambergris Cay" and "Ambergris Cay, Turks and Caicos", four. Token
   * overlap scores those 0.5 to 0.67 and the earlier passes want 0.6 with a
   * matching country, so they fall through — and each one ships as a second
   * card for a hotel already on the map, with no photograph and no description,
   * which is exactly the complaint that started this.
   *
   * They are recognisable because everything the longer name adds is furniture:
   * the chain, the city, the country, or a marketing tail. Strip those from
   * BOTH names using each record's own fields — not a word list, so it works for
   * chains nobody thought to enumerate — and the two either become the same name
   * or they do not.
   *
   * The pair this must not merge is on record: "Canaves Oia Suites" and "Canaves
   * Oia Sunday Suites" are different hotels a few metres apart in the same
   * village. Stripping the city leaves "canaves suites" against "canaves sunday
   * suites", which is 0.67 on characters and nowhere near the bar. The word that
   * separates two hotels is never the city they are both in.
   */
  const TWIN_METRES = 300;
  const MARKETING_TAIL = /\b(virtuoso preview property|virtuoso preview|preview property|auberge|belmond|lxr|mgallery|autograph|curio|tribute portfolio|small luxury hotels|leading hotels of the world)\b/g;

  /** A name with everything that is not the hotel's own identity taken out. */
  const escape = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const strippedName = (name, ctx = {}) => {
    let n = ` ${normName(name)} `;
    n = n.replace(MARKETING_TAIL, ' ');
    for (const extra of [ctx.city, ctx.country, ctx.chain, ctx.adminRegion]) {
      const phrase = normName(String(extra ?? '').split(',')[0]);
      if (!phrase) continue;
      /*
       * The whole place name first, then its words.
       *
       * Word by word alone needs a length guard — "st" and "la" are too common
       * to delete from a hotel's name on the strength of appearing in a city's
       * — and that guard is what kept "Bishop's Lodge, Santa Fe" apart from
       * "Bishop's Lodge, Auberge Collection": "santa" came out and "fe" stayed,
       * leaving half a city sitting in the hotel's name. Matching the phrase
       * first takes "santa fe" out whole, and the per-word pass is then only
       * there for a place the two records spell differently.
       */
      n = n.replace(new RegExp(`\\b${escape(phrase)}\\b`, 'g'), ' ');
      for (const word of phrase.split(' ')) {
        if (word.length < 3) continue;
        n = n.replace(new RegExp(`\\b${escape(word)}\\b`, 'g'), ' ');
      }
    }
    return n.replace(/\s+/g, ' ').trim();
  };

  const twinLeftovers = unmatchedLocal.splice(0, unmatchedLocal.length);
  for (const u of twinLeftovers) {
    const h = local.find(l => l.id === u.id);
    let hit = null;
    for (const [twinId, m] of Object.entries(matched)) {
      const twin = local.find(l => l.id === twinId);
      if (!twin) continue;
      const d = metresApart(h, twin);
      if (d === null || d > TWIN_METRES) continue;
      const v = feed.find(f => f.vid === m.vid) ?? null;
      const ours = strippedName(h.name, { city: h.city, country: h.country, adminRegion: h.adminRegion, chain: v?.chain });
      const theirs = strippedName(twin.name, { city: twin.city, country: twin.country, adminRegion: twin.adminRegion, chain: v?.chain });
      if (!ours || !theirs) continue;
      const score = ours === theirs ? 1 : charSimilarity(ours, theirs);
      if (score < TYPO_TWIN_MIN) continue;
      if (!hit || d < hit.metres) hit = { twinId, twin, vid: m.vid, virtuosoName: v?.name, metres: d, score, ours, theirs };
    }
    if (!hit) { unmatchedLocal.push(u); continue; }
    duplicates.push({ vid: hit.vid, virtuosoName: hit.virtuosoName, keep: hit.twinId, drop: h.id,
      keepName: hit.twin.name, dropName: h.name, score: Number(hit.score.toFixed(2)),
      metresApart: Math.round(hit.metres),
      note: `same property under a shorter name — both read as "${hit.ours}" once chain, city and country are stripped` });
    record(h, { vid: hit.vid, name: hit.virtuosoName }, `twin-of:${hit.twinId}`);
  }

  const collisions = [...claimed.entries()].filter(([, ids]) => ids.length > 1)
    .map(([vid, ids]) => ({ vid, virtuosoName: feed.find(f => f.vid === vid)?.name, localIds: ids,
      localNames: ids.map(i => local.find(l => l.id === i)?.name),
      how: ids.map(i => matched[i]?.how),
      confident: ids.every(i => !String(matched[i]?.how ?? '').startsWith('fuzzy')) }));

  const matchedVids = new Set(Object.values(matched).map(m => m.vid));
  const unmatchedApi = feed.filter(f => !matchedVids.has(f.vid))
    .map(f => ({ vid: f.vid, name: f.name, city: f.city, country: f.country }));

  return { matched, ambiguous, unmatchedLocal, unmatchedApi, collisions, duplicates, geoReview };
}

// ---------- main ----------

const local = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
if (!fs.existsSync(FEED_FILE)) { console.error(`Missing ${path.relative(repoRoot, FEED_FILE)} — run: node scripts/sync-virtuoso-hotels.mjs`); process.exit(1); }
const feedDoc = JSON.parse(fs.readFileSync(FEED_FILE, 'utf8'));
const feed = feedDoc.hotels;

const existing = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) : {};
const overrides = existing.overrides ?? {};

const result = buildMap(local, feed);

// Hand-corrections win over anything the matcher decided.
for (const [localId, vid] of Object.entries(overrides)) {
  if (vid === null) { delete result.matched[localId]; continue; }
  const hit = feed.find(f => f.vid === String(vid));
  if (!hit) { console.warn(`override ${localId} -> ${vid}: no such Virtuoso product`); continue; }
  result.matched[localId] = { vid: hit.vid, how: 'override', localName: local.find(l => l.id === localId)?.name, virtuosoName: hit.name };
}

// Overrides can introduce a collision of their own — pointing a second local
// record at a product another already claims is exactly how a human records
// "these two are the same hotel" — so collisions are recomputed from the final
// mapping rather than from the matcher's first pass.
{
  const claimed = new Map();
  for (const [localId, m] of Object.entries(result.matched)) {
    if (!claimed.has(m.vid)) claimed.set(m.vid, []);
    claimed.get(m.vid).push(localId);
  }
  result.collisions = [...claimed.entries()].filter(([, ids]) => ids.length > 1)
    .map(([vid, ids]) => ({ vid, virtuosoName: feed.find(f => f.vid === vid)?.name, localIds: ids,
      localNames: ids.map(i => local.find(l => l.id === i)?.name),
      how: ids.map(i => result.matched[i]?.how),
      confident: ids.every(i => !String(result.matched[i]?.how ?? '').startsWith('fuzzy')) }));
  result.ambiguous = result.ambiguous.filter(a => !result.matched[a.id]);
}

const doc = {
  _meta: {
    purpose: 'Maps local hotel ids to Virtuoso product ids. Regenerate with scripts/match-virtuoso-hotels.mjs.',
    generated: new Date().toISOString(),
    feedSynced: feedDoc._meta?.lastSynced ?? null,
    localCount: local.length,
    feedCount: feed.length,
    matchedCount: Object.keys(result.matched).length,
  },
  overrides,
  matched: result.matched,
  ambiguous: result.ambiguous,
  collisions: result.collisions,
  duplicates: result.duplicates,
  geoReview: result.geoReview,
  unmatchedLocal: result.unmatchedLocal,
  unmatchedApi: result.unmatchedApi,
};

const summary = `${doc._meta.matchedCount}/${local.length} local matched · ${result.collisions.length} duplicate groups · ${result.ambiguous.length} need review · ${result.unmatchedLocal.length} local-only · ${result.unmatchedApi.length} Virtuoso-only`;

if (CHECK) {
  if (!fs.existsSync(MAP_FILE)) { console.error('virtuoso-id-map.json missing — run scripts/match-virtuoso-hotels.mjs'); process.exit(1); }
  const prev = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  const changed = JSON.stringify(prev.matched) !== JSON.stringify(doc.matched);
  console.log(changed ? `STALE — ${summary}` : `ok — ${summary}`);
  process.exit(changed ? 1 : 0);
}

const DUMP = (() => { const i = args.indexOf('--dump'); return i >= 0 ? args[i + 1] : null; })();
if (DUMP) fs.writeFileSync(path.resolve(DUMP), JSON.stringify(doc, null, 1));
if (!DRY) fs.writeFileSync(MAP_FILE, JSON.stringify(doc, null, 1));
console.log(DRY ? `[dry run, ledger not written] ${summary}` : summary);

if (REPORT) {
  const how = {};
  for (const m of Object.values(result.matched)) { const k = m.how.split(':')[0]; how[k] = (how[k] ?? 0) + 1; }
  console.log('\nmatched by method:', how);
  console.log(`\ncollisions (one Virtuoso property claimed by several local records — these are our duplicates):`);
  for (const c of result.collisions.slice(0, 25)) console.log(`  ${c.vid} ${c.virtuosoName}\n     <- ${c.localIds.join(', ')} (${c.localNames.join(' | ')})`);
  console.log(`\nlocal-only, by program:`);
  const byProgram = {};
  for (const u of result.unmatchedLocal) byProgram[u.program] = (byProgram[u.program] ?? 0) + 1;
  console.log(Object.fromEntries(Object.entries(byProgram).sort((a, b) => b[1] - a[1])));
}

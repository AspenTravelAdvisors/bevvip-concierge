#!/usr/bin/env node
/**
 * What is actually wrong with the listings we ship.
 *
 * Every atlas has a verify-* script that proves the adapters agree with the
 * maps — that a shared link comes back with the same rows on both sides. None
 * of them look at whether those rows are any GOOD. A record can be perfectly
 * round-tripped through every filter axis and still reach a traveller with a
 * Venetian palazzo filed under "Lodge / Safari", a paragraph of leaked CSS
 * where its day-one description should be, and last year's perks.
 *
 * So this is a quality audit rather than a parity check, and it is deliberately
 * a REPORT, not a gate: these are counts to work down, and failing the build on
 * a supplier's missing photograph would only teach everyone to pass --force.
 * `--strict` exits non-zero on the checks that are ours rather than a
 * supplier's, for when a number has been driven to zero and should stay there.
 *
 *   node scripts/audit-listings.mjs
 *   node scripts/audit-listings.mjs --strict
 *   node scripts/audit-listings.mjs --section hotels
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { repoRoot } from '../lib/virtuoso/env.mjs';
import { LOOKS_LIKE_CSS } from '../lib/virtuoso/text.mjs';
import { playableVideo } from '../lib/virtuoso/media.mjs';

// The hotel overlays are CommonJS (they are shared with the in-process atlas
// backends, which are). This is the same bridge scripts/verify-seo.mjs uses.
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const ONLY = (() => { const i = args.indexOf('--section'); return i >= 0 ? args[i + 1] : null; })();

const read = rel => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
const exists = rel => fs.existsSync(path.join(repoRoot, rel));

const nf = new Intl.NumberFormat('en-US');
const findings = [];

/**
 * One finding, in one of three states.
 *
 * `ours`      a defect in code we control, as opposed to a field the supplier
 *             did not fill in. The latter is a fact about the feed and no
 *             amount of our discipline drives it to zero.
 * `gate`      driven to zero and expected to stay there — these, and only
 *             these, fail --strict, so the flag is safe to wire into
 *             `npm run verify` without the build going red over a supplier's
 *             missing photograph.
 * `awaitingSync`  fixed at source, but the shipped feed still carries the
 *             damage because repairing it needs a crawl of the Virtuoso API.
 *             Counted and printed; never gated, because no change to this
 *             repository can move the number.
 */
function finding({ section, label, count, of, ours = false, gate = false, awaitingSync = false, detail = null, examples = [] }) {
  findings.push({ section, label, count, of, ours, gate, awaitingSync, detail, examples });
}

function section(name) { return !ONLY || ONLY === name; }

// ---------- shared text tests ----------

/*
 * The CSS detector is the one in lib/virtuoso/text.mjs, not a second copy.
 *
 * An audit that carries its own definition of the defect can pass while the
 * thing it audits is still broken — the two drift, and the report is the last
 * place anyone looks for the drift.
 */

/** Two records the same journey, differing only in punctuation and spacing. */
const nameKey = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// ---------- hotels ----------

/*
 * Countries with a safari industry, for the one number this audit exists to
 * produce: how much of the "Lodge / Safari" label is actually a safari lodge.
 * Deliberately the classic safari map rather than "the continent" — Morocco and
 * Egypt are in Africa and nobody flies there for game drives.
 */
const SAFARI_COUNTRIES = new Set([
  'South Africa', 'Kenya', 'Botswana', 'Tanzania', 'Zimbabwe', 'Zambia',
  'Rwanda', 'Namibia', 'Uganda', 'Mozambique', 'Malawi', 'Madagascar', 'Zanzibar',
]);

function auditHotels() {
  if (!section('hotels')) return;
  const rel = 'data/atlas/hotel/luxury-hotels.json';
  if (!exists(rel)) return;
  const rows = read(rel);
  const n = rows.length;

  /*
   * The category the site sells safari on is 57% not-safari.
   *
   * deriveCategory() in merge-virtuoso-hotels.mjs has two doors into
   * 'Lodge / Safari': propertyType === 'Lodge, Ranch, Camp', which is the
   * supplier saying this is a camp, and experiences includes 'Ecotourism',
   * which is the supplier saying this property has a sustainability story. The
   * second door is far wider than the first and lets in Venetian palazzi.
   */
  const lodge = rows.filter(h => h.category === 'Lodge / Safari');
  const byType = lodge.filter(h => h.propertyType === 'Lodge, Ranch, Camp');
  const ecoOnly = lodge.filter(h => h.propertyType !== 'Lodge, Ranch, Camp'
    && (h.experiences ?? []).includes('Ecotourism'));
  finding({
    section: 'hotels', ours: true, gate: true,
    label: '"Lodge / Safari" records that are not a lodge, ranch or camp',
    count: ecoOnly.length, of: lodge.length,
    detail: ecoOnly.length
      ? `${byType.length} carry propertyType "Lodge, Ranch, Camp"; the rest are in on the Ecotourism experience flag alone`
      : `all ${byType.length} supplier-declared camps, plus ${lodge.length - byType.length} curated local records the API has no propertyType for`,
    examples: ecoOnly.slice(0, 6).map(h => `${h.name} — ${h.city}, ${h.country} (${h.propertyType})`),
  });

  const realSafari = lodge.filter(h => SAFARI_COUNTRIES.has(h.country)
    && h.propertyType === 'Lodge, Ranch, Camp');
  finding({
    section: 'hotels',
    label: 'genuine African safari camps in the atlas',
    count: realSafari.length, of: lodge.length,
    detail: 'propertyType "Lodge, Ranch, Camp" in a safari country — the drawable core of a safari atlas',
  });

  /*
   * Records the Virtuoso matcher never paired.
   *
   * They are not missing one field, they are missing the whole supplier record:
   * no photographs, no experiences, no room detail, no perks text. On the map
   * they are a pin with a name, next to 2,073 that are a property.
   */
  const local = rows.filter(h => h.source === 'local');
  finding({
    section: 'hotels', ours: true,
    label: 'hotels with no matched Virtuoso record (no photos, perks or detail)',
    count: local.length, of: n,
    examples: local.slice(0, 6).map(h => `${h.name} — ${h.country}`),
  });

  // How many of those are recoverable by name alone, before anyone writes a
  // smarter matcher: the answer decides whether this is worth a day's work.
  if (exists('data/atlas/hotel/virtuoso-hotels.json')) {
    const v = read('data/atlas/hotel/virtuoso-hotels.json').hotels ?? [];
    const keys = v.map(h => ({ k: nameKey(h.name), name: h.name }));
    const near = [];
    for (const h of local) {
      const k = nameKey(h.name);
      if (k.length < 10) continue;
      const m = keys.find(x => (x.k.includes(k) || k.includes(x.k)) && Math.min(x.k.length, k.length) >= 10);
      if (m) near.push(`${h.name}  ->  ${m.name}`);
    }
    finding({
      section: 'hotels', ours: true,
      label: 'of those, one substring away from a Virtuoso record',
      count: near.length, of: local.length,
      detail: 'needs city corroboration before merging — a few are false pairs',
      examples: near.slice(0, 6),
    });
  }

  /*
   * The two copies of the hotel atlas agreeing with each other.
   *
   * The server reads data/atlas/hotel/luxury-hotels.json and the browser
   * fetches public/maps/hotel/hotel-points.json, built from it by
   * `npm run build:hotel-points` in prebuild. Running the merge without the
   * rebuild leaves them disagreeing, and nothing else notices: recategorising
   * 94 properties moved the server's count to 72 while the map a visitor
   * actually loads still filtered 166 — including the Venetian palazzo the
   * whole fix was about. Prebuild would have caught it on deploy; this catches
   * it in the working tree, which is where it can still be a one-line fix.
   */
  const publicRel = 'public/maps/hotel/hotel-points.json';
  if (exists(publicRel)) {
    const feats = read(publicRel).features ?? [];
    const pubCat = new Map();
    for (const f of feats) {
      const c = f.properties?.category ?? null;
      pubCat.set(c, (pubCat.get(c) ?? 0) + 1);
    }
    const srcCat = new Map();
    for (const h of rows) srcCat.set(h.category ?? null, (srcCat.get(h.category ?? null) ?? 0) + 1);
    const drift = [];
    if (feats.length !== n) drift.push(`row count: ${nf.format(n)} vs ${nf.format(feats.length)} on the map`);
    for (const k of new Set([...srcCat.keys(), ...pubCat.keys()])) {
      const a = srcCat.get(k) ?? 0, b = pubCat.get(k) ?? 0;
      if (a !== b) drift.push(`${k}: ${a} in the feed, ${b} on the map`);
    }
    finding({
      section: 'hotels', ours: true, gate: true,
      label: 'the map a visitor loads disagrees with the feed the server reads',
      count: drift.length, of: srcCat.size,
      detail: drift.length ? 'run: npm run build:hotel-points' : 'both copies agree',
      examples: drift.slice(0, 6),
    });
  }

  const stale = rows.filter(h => h.perksStale);
  const noYear = rows.filter(h => !h.perksYear);
  finding({
    section: 'hotels',
    label: 'hotels advertising a previous year\'s VIP perks',
    count: stale.length, of: n,
    detail: `plus ${nf.format(noYear.length)} with no perks year at all`,
  });

  finding({
    section: 'hotels',
    label: 'hotels with no photograph',
    count: rows.filter(h => !h.thumb).length, of: n,
  });

  finding({
    section: 'hotels',
    label: 'hotels whose supplier published a film of the property',
    count: rows.filter(h => (h.videos ?? []).length).length, of: n,
    detail: 'played in the dossier; the card stays a still',
  });

  /*
   * A film in a still's slot is a broken card, and the feed carries both now.
   *
   * The image library is a supplier-filled bucket: the day one of them files an
   * .mp4 in it, `thumb` and `images` are handed to an <img> that renders
   * nothing. The sync partitions by what the URL is rather than which field it
   * arrived in (lib/virtuoso/media.mjs), so this is zero and stays zero.
   */
  const misfiled = rows.filter(h => [h.thumb, ...(h.images ?? [])].some(u => playableVideo(u)));
  finding({
    section: 'hotels', ours: true, gate: true,
    label: 'still-image slots holding a video file',
    count: misfiled.length, of: n,
    examples: misfiled.slice(0, 6).map(h => `${h.name} — ${h.thumb}`),
  });
}

// ---------- tours (the jet and rail atlases) ----------

function auditTours() {
  if (!section('tours')) return;
  const rel = 'data/atlas/shared/virtuoso-tours.json';
  if (!exists(rel)) return;
  const feed = read(rel);
  const tours = feed.tours ?? [];

  /*
   * The feed's own _meta calls the per-stop paragraphs the point of the
   * exercise. For one stop in ten the paragraph is a stylesheet.
   */
  let stops = 0, cssStops = 0;
  const cssExamples = [];
  for (const t of tours) {
    for (const p of t.itinerary ?? []) {
      if (!p.note) continue;
      stops++;
      if (!LOOKS_LIKE_CSS.test(p.note)) continue;
      cssStops++;
      if (cssExamples.length < 4) cssExamples.push(`${t.name} · day ${p.day} ${p.place}: "${p.note.slice(0, 60)}…"`);
    }
  }
  finding({
    section: 'tours', ours: true, awaitingSync: true,
    label: 'itinerary stops whose description is leaked CSS',
    count: cssStops, of: stops,
    detail: 'fixed in lib/virtuoso/text.mjs; the clip budget was spent on the stylesheet so the prose behind it is gone — these stops need a re-sync',
    examples: cssExamples,
  });

  const prose = ['description', 'folioDescription', 'folioInTheKnow'];
  let proseFields = 0, cssFields = 0;
  for (const t of tours) for (const f of prose) {
    if (typeof t[f] !== 'string' || !t[f]) continue;
    proseFields++;
    if (LOOKS_LIKE_CSS.test(t[f])) cssFields++;
  }
  finding({
    section: 'tours', ours: true, awaitingSync: true,
    label: 'tour descriptions that are leaked CSS',
    count: cssFields, of: proseFields,
    detail: 'same fix, same re-sync',
  });

  /*
   * The same product listed twice — which is NOT the same journey departing
   * twice, and the difference is 21 rows of live inventory.
   *
   * Grouping on the name alone says there are 24 duplicates here. There are 3.
   * "Australia by Private Jet" appears three times because A&K sells a 2026, a
   * 2027 and a 2028 departure of it, each with its own `travelDates` window,
   * each separately bookable — and the card prints that window, so a traveller
   * sees three distinct choices rather than one thing three times. A duplicate
   * has to match on the departure window too.
   */
  const dupKey = t => [
    nameKey(t.name), nameKey(t.company), nameKey(t.lengthLabel),
    t.startDate ?? '', t.endDate ?? '',
  ].join('|');
  const byProduct = new Map();
  for (const t of tours) {
    const k = dupKey(t);
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k).push(t);
  }
  const dupes = [...byProduct.values()].filter(g => g.length > 1);
  const extra = dupes.reduce((n, g) => n + g.length - 1, 0);
  finding({
    section: 'tours', ours: true, awaitingSync: true,
    label: 'duplicate listings (same operator, title, length AND departure window)',
    count: extra, of: tours.length,
    detail: 'separate departures of one journey are NOT duplicates and are counted below',
    examples: dupes.slice(0, 5).map(g => `${g[0].name} \u00d7${g.length} [${g[0].startDate} \u2192 ${g[0].endDate}]`),
  });

  // The rows the dedupe must never touch. Reported so a future selector change
  // that starts collapsing them shows up here as a drop rather than silently.
  const byTitle = new Map();
  for (const t of tours) {
    const k = `${nameKey(t.name)}|${nameKey(t.company)}`;
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(t);
  }
  const multi = [...byTitle.values()].filter(g => g.length > 1);
  finding({
    section: 'tours',
    label: 'separate departures of a repeating journey (must survive dedupe)',
    count: multi.reduce((n, g) => n + g.length, 0), of: tours.length,
    detail: `${multi.length} journeys sold across more than one departure window`,
    examples: multi.slice(0, 4).map(g => `${g[0].name} \u00d7${g.length}: ${g.map(t => (t.startDate ?? '?').slice(0, 4)).join(', ')}`),
  });

  finding({
    section: 'tours',
    label: 'journeys with no description at all',
    count: tours.filter(t => !t.description).length, of: tours.length,
  });

  /*
   * How much of /v2/tours we are actually looking at.
   *
   * The catalogue is one cheap 8-second fetch of 13,348 records and the sync
   * keeps the ~1.7% that a rail facet or a private-jet name match selects.
   * Everything a second land atlas could be built from is in the part we throw
   * away without reading.
   */
  const CATALOGUE = 13348;
  finding({
    section: 'tours',
    label: 'tours in /v2/tours we do not read',
    count: CATALOGUE - tours.length, of: CATALOGUE,
    detail: 'the sync fetches the whole catalogue and keeps the jet and rail selection',
  });

  // Africa is already there, in a slice that was never looking for it.
  const africa = tours.filter(t => (t.destinationRegions ?? []).includes('Africa'));
  const safariCountry = tours.filter(t => (t.countries ?? []).some(c => SAFARI_COUNTRIES.has(c)));
  finding({
    section: 'tours',
    label: 'journeys already touching Africa, inside the jet/rail slice',
    count: africa.length, of: tours.length,
    detail: `${safariCountry.length} reach a safari country; the API exposes "Africa" as a first-class destinationRegion facet`,
    examples: safariCountry.slice(0, 5).map(t => `${t.name} — ${t.company}`),
  });
}

// ---------- the counts the site states out loud ----------

/*
 * atlas-config.ts keeps a hand-written `count` per collection, and
 * collectionsHeadline() adds them up into the first sentence a visitor reads.
 * Checking them is three lines and the alternative is a headline that drifts
 * silently every time a supplier retires a property — which is what it had
 * done, by 142 hotels, when this check was written.
 *
 * EVERY collection in ATLASES belongs in this table. Safari shipped as the
 * eighth and was not added to it, so the one collection whose count was moving
 * — a new selector, a new sync — was the one collection nobody was checking.
 * A missing row here is silent in both directions: the audit reports "0 of 7"
 * and passes, and the headline drifts anyway.
 */
const SHIPPED = {
  hotel: ['data/atlas/hotel/luxury-hotels.json', d => (Array.isArray(d) ? d.length : null)],
  villa: ['data/villas-of-distinction.json', d => (d.villas ?? Object.values(d).find(Array.isArray) ?? []).length],
  cruise: ['data/atlas/cruise/sailings.json', d => (d.rows ?? []).length],
  worldcruise: ['data/atlas/world/itinerary.json', d => (d.TRIPS ?? []).length],
  train: ['data/atlas/train/itinerary.json', d => (d.TRIPS ?? []).length],
  yacht: ['data/atlas/yacht/itinerary.json', d => (d.TRIPS ?? []).length],
  jet: ['data/atlas/jet/itinerary.json', d => (d.TRIPS ?? []).length],
  safari: ['data/atlas/safari/itinerary.json', d => (d.TRIPS ?? []).length],
};

function auditCounts() {
  if (!section('counts')) return;
  const src = fs.readFileSync(path.join(repoRoot, 'lib/atlas-config.ts'), 'utf8');
  const drift = [];
  let stated = 0, actual = 0;
  for (const [type, [rel, pick]] of Object.entries(SHIPPED)) {
    if (!exists(rel)) continue;
    // The `count:` that follows this collection's `type:` line in the registry.
    const block = src.slice(src.indexOf(`type: "${type}"`));
    const declared = Number(block.match(/count:\s*([\d_]+)/)?.[1]?.replace(/_/g, ''));
    const real = pick(read(rel));
    if (!Number.isFinite(declared) || real == null) continue;
    stated += declared; actual += real;
    if (declared !== real) drift.push(`${type}: config says ${nf.format(declared)}, ships ${nf.format(real)} (${declared > real ? '+' : ''}${nf.format(declared - real)})`);
  }
  finding({
    section: 'counts', ours: true, gate: true,
    label: 'collections whose stated count does not match what ships',
    count: drift.length, of: Object.keys(SHIPPED).length,
    detail: `the home page headline claims ${nf.format(stated)} vetted stays and journeys; the data holds ${nf.format(actual)}`,
    examples: drift,
  });
}

// ---------- the country field, now that it mints URLs ----------

/*
 * `country` used to be a filter facet. Since /hotels/<country>/<property> it is
 * also a public address, and a bad value is no longer a slightly wrong dropdown
 * — it is a page, and two spellings of one country are two thin pages where
 * there should be one good one.
 *
 * Four checks, and it is worth being exact about what each can and cannot see,
 * because the second is a SIGNAL rather than a verdict:
 *
 *   1. Case and accent variants ("Turks And Caicos Islands" / "Turks and
 *      Caicos"). Certain: same letters, same place.
 *   2. Two countries claiming one city. Catches the transliteration pairs a
 *      letter-fold cannot — "Turkey" and "Türkiye" both hold Bodrum — but it
 *      also fires on Naples (Italy and Florida), Cambridge (England and
 *      Massachusetts) and Victoria (Canada and the Seychelles), which are two
 *      real places sharing a name. So it lists rather than judges.
 *   3. One ISO country code under two country names. Certain, and it is what
 *      catches "Da Nang" filed as a country of its own under VNM.
 *   4. A country no property has a city in — the placeholder "Various".
 *
 * An earlier draft of (4) flagged any country value that also names a city, and
 * called Singapore, Anguilla, Saint Barthélemy and French Polynesia errors.
 * They are city-states and territories where the two names genuinely coincide.
 * Having no city at all is the tell that survives.
 *
 * Reported rather than repaired, and deliberately NOT canonicalised in
 * lib/seo/hotels.js. Merging "Turkey" into "Türkiye" for the page would give
 * /hotels/turkiye 24 properties while /atlas/hotel?country=Turkey still showed
 * 2 — the page and the map disagreeing about what a country contains, which is
 * a worse defect than the one it fixes. The repair belongs in a ledger applied
 * at load, the way hotel-aliases.json and place-aliases.json are, so that both
 * surfaces see it.
 */
function auditCountries() {
  if (!section('countries')) return;
  /*
   * Read the feed THROUGH the overlays, not raw.
   *
   * A quality report that keeps reporting defects already fixed is a report
   * people stop reading. data/atlas/hotel/country-overrides.json resolves four
   * duplicate spellings; auditing the raw feed would list all four forever, and
   * the finding that actually matters — a NEW one arriving in tomorrow's sync —
   * would be the fifth line of a list everyone had learned to skip.
   *
   * The ledger's own contents are printed above the findings instead, so what
   * it covers stays visible without being counted as outstanding.
   */
  const { applyHotelOverlays } = require('../lib/atlas/hotel-overlays.js');
  const ledger = read('data/atlas/hotel/country-overrides.json');
  const hotels = applyHotelOverlays(read('data/atlas/hotel/luxury-hotels.json'));
  finding({
    section: 'countries', ours: true,
    label: 'country spellings already resolved by the ledger',
    count: (ledger.rules || []).length, of: (ledger.rules || []).length,
    detail: 'data/atlas/hotel/country-overrides.json — applied at load, so the page and the map agree',
    examples: (ledger.rules || []).map(r => `${r.from} -> ${r.to} (${r.records})`),
  });
  const ci = s => String(s ?? '').trim();
  const fold = s => ci(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '');

  const byCountry = new Map();
  const citiesOf = new Map();
  const countriesOfCity = new Map();
  for (const h of hotels) {
    const c = ci(h.country);
    byCountry.set(c, [...(byCountry.get(c) || []), h]);
    const city = fold(h.city);
    if (!city) continue;
    citiesOf.set(city, ci(h.city));
    countriesOfCity.set(city, (countriesOfCity.get(city) || new Set()).add(c));
  }
  const label = name => `${name} (${byCountry.get(name).length})`;

  // 1. Same letters, different typing.
  const families = new Map();
  for (const name of byCountry.keys()) {
    const key = fold(name).replace(/islands?$/, '');
    families.set(key, [...(families.get(key) || []), name]);
  }
  const variants = [...families.values()].filter(names => names.length > 1);
  finding({
    section: 'countries', ours: false,
    label: 'countries the feed spells more than one way, each minting its own hub page',
    count: variants.length, of: byCountry.size,
    detail: 'the properties divide between the spellings, so neither /hotels/<country> holds the country',
    examples: variants.map(names => names.map(label).join('  vs  ')),
  });

  // 2. One city, two countries. A signal — see the note above.
  const shared = [...countriesOfCity.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([city, set]) => `${citiesOf.get(city)}: ${[...set].map(label).join(' / ')}`);
  finding({
    section: 'countries', ours: false,
    label: 'cities claimed by two countries — a duplicate spelling, or two real places sharing a name',
    count: shared.length, of: countriesOfCity.size,
    detail: 'worth reading rather than fixing blind — every entry left is two real places sharing a name (Naples, Cambridge, Victoria); the duplicates it found, Bodrum and Providenciales, are in the ledger now',
    examples: shared,
  });

  // 3. One ISO code, two country names. Certain, because the code is the
  //    supplier's own answer to "which country is this in".
  const byCode = new Map();
  for (const h of hotels) {
    const code = ci(h.countryCode);
    if (!code) continue;
    byCode.set(code, (byCode.get(code) || new Set()).add(ci(h.country)));
  }
  /*
   * A country the ledger deliberately KEEPS is not a finding.
   *
   * Macau shares CHN in this feed and is not folded into China: it has its own
   * ISO code in the world, its own visa regime and its own hotel market, and
   * travellers search it by name. Counting it as outstanding forever would
   * teach the reader to skip this check, which is the only way a real one
   * arrives unnoticed.
   */
  const kept = new Set((ledger.notPlaces || []).filter(n => n.keep).map(n => ci(n.country)));
  const codeClash = [...byCode.entries()]
    .filter(([, set]) => [...set].filter(name => !kept.has(name)).length > 1)
    .map(([code, set]) => `${code}: ${[...set].map(label).join(' / ')}`);
  finding({
    section: 'countries', ours: false,
    label: 'one ISO country code filed under two country names',
    count: codeClash.length, of: byCode.size,
    detail: "the code is the supplier's own answer to which country a property is in, so a second name under it is a disagreement with itself. Deliberate exceptions are marked `keep` in country-overrides.json and not counted here",
    examples: codeClash,
  });

  // 4. A country nothing is located in.
  //
  //    Deliberately NOT "the country value also names a city" — that rule
  //    reads Singapore, Anguilla, Saint Barthélemy and French Polynesia as
  //    errors, and they are city-states and territories where the country and
  //    the city genuinely share a name. Having no city at ALL is the honest
  //    tell for a placeholder.
  const placeless = [...byCountry.entries()].filter(
    ([, list]) => list.length && list.every(h => !ci(h.city)),
  );
  finding({
    section: 'countries', ours: false,
    label: 'country values nothing is actually located in',
    count: placeless.length, of: byCountry.size,
    detail: 'no property under these has a city either — portfolio listings rather than located properties. Already excluded from the /hotels entity tree via country-overrides.json `notPlaces`, so this is a standing note rather than a live defect; a NEW value appearing here is the thing to act on',
    examples: placeless.map(([name, list]) => `${label(name)} — ${list.map(h => h.name).join(', ')}`),
  });
}

// ---------- report ----------

auditHotels();
auditTours();
auditCounts();
auditCountries();

let current = null;
for (const f of findings) {
  if (f.section !== current) { current = f.section; console.log(`\n${current.toUpperCase()}\n${'─'.repeat(current.length)}`); }
  const share = f.of ? ` of ${nf.format(f.of)} (${((f.count / f.of) * 100).toFixed(1)}%)` : '';
  const mark = f.gate ? '▸' : f.ours ? '▫' : '·';
  const pending = f.awaitingSync && f.count ? '  (fix landed — awaiting re-sync)' : '';
  console.log(`\n  ${mark} ${f.label}${pending}`);
  console.log(`    ${nf.format(f.count)}${share}`);
  if (f.detail) console.log(`    ${f.detail}`);
  for (const e of f.examples) console.log(`      ${e}`);
}

const gated = findings.filter(f => f.gate && f.count > 0);
const pendingSync = findings.filter(f => f.awaitingSync && f.count > 0);
const open = findings.filter(f => f.ours && !f.gate && !f.awaitingSync && f.count > 0);

console.log(`\n\n${findings.length} findings  ·  ▸ ${gated.length} gated failing  ·  ▫ ${open.length} open  ·  ${pendingSync.length} awaiting re-sync\n`);

if (pendingSync.length) {
  console.log('Awaiting a Virtuoso crawl — the source fix has landed, the stored feed has not caught up:');
  for (const f of pendingSync) console.log(`  ${nf.format(f.count).padStart(6)}  ${f.label}`);
  console.log('  run: npm run sync:virtuoso\n');
}

/*
 * --strict gates the findings that have been driven to zero, and nothing else.
 *
 * The alternative — failing on every defect in our own code — would have made
 * the flag unusable the day it shipped, because the two biggest are a matcher
 * gap nobody has worked yet and 251 stops whose prose only a re-crawl can
 * restore. A gate that cannot pass teaches everyone to pass --force.
 */
if (STRICT && gated.length) {
  console.log('FAILED (--strict): a finding that was at zero has regressed.\n');
  process.exit(1);
}

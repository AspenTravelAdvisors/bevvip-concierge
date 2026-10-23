#!/usr/bin/env node
/**
 * Refreshes data/villas-of-distinction.json from the public VillaInfo search API.
 *
 * The file was a one-off scrape from 2026-07-15 and nothing ever refreshed it,
 * so the atlas drifted away from what Villas of Distinction actually lists.
 * Villas change slowly and the whole catalogue is four API pages, so this runs
 * monthly (.github/workflows/villa-sync.yml), not with the nightly Virtuoso job.
 *
 * The output keeps the existing schema exactly — lib/villas.js, verify-villas,
 * verify-seo and the collection counts all read it — so this is a rewrite of the
 * data, never of its shape. Three things are carried rather than re-derived:
 *
 *   GEO. About 6% of villas come back from the API at 0,0. The July file placed
 *   those on a same-location or same-destination centroid (and a handful on
 *   hand-checked OpenStreetMap / Wikipedia points). A known villa that still
 *   has no coordinates keeps the point it already had; a new one gets the same
 *   centroid treatment; one with nothing to stand on is left out and named in
 *   the log rather than pinned in the Gulf of Guinea.
 *
 *   NAMES FOR IDS. If a record carries only region / destination / location
 *   ids, the names and slugs come from the existing file's records.
 *
 *   THE GATE. The API's field names were never written down, so the mapping
 *   below reads each field from the names it is known or likely to use and then
 *   proves itself: villas present in both the old and new data must agree on
 *   name, destination and bedrooms. If they do not, the mapping is wrong, the
 *   file is not written, and the log prints a raw record to fix it from. A
 *   catalogue more than MAX_SHRINK smaller than the committed one is refused too
 *   — a short API response must not delete live villas.
 *
 *   node scripts/sync-villas.mjs            # fetch, check, write
 *   node scripts/sync-villas.mjs --dry-run  # fetch and check, write nothing
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/villas-of-distinction.json');
const DRY_RUN = process.argv.includes('--dry-run');

const API = 'https://villainfo.villasofdistinction.com/api/villa/search';
const SITE = 'https://villainfo.villasofdistinction.com';
const PHOTO_BASE = 'https://photos.wthvillas.com/photos/';
const SITE_ID = 10;
const PER_PAGE = 1000;

// A month of genuine delistings is a few percent. A fifth of the catalogue gone
// at once is a broken response, not a business event.
const MAX_SHRINK = 0.2;

const previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const previousById = new Map(previous.villas.map((v) => [String(v.id), v]));

// ── fetch ────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPage(page) {
  const url = `${API}?site_id=${SITE_ID}&per_page=${PER_PAGE}&page=${page}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'the-guide-villa-sync/1.0 (+https://guide.expeditionbucketlist.com)' },
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 4) throw new Error(`page ${page}: ${err.message}`);
      console.log(`  page ${page} attempt ${attempt} failed (${err.message}); retrying`);
      await sleep(2000 * 2 ** attempt);
    }
  }
}

// Laravel paginators put the rows in `data`, sometimes one level further down.
const rowsOf = (body) =>
  [body?.data, body?.data?.data, body?.villas, body?.results, body].find(Array.isArray) ?? null;
const pagingOf = (body) => (Array.isArray(body?.data) ? body : body?.data && !Array.isArray(body.data) ? body.data : body) ?? {};

const raw = [];
const apiPages = [];
for (let page = 1, lastPage = 1; page <= lastPage; page++) {
  const body = await getPage(page);
  const rows = rowsOf(body);
  if (!rows) {
    console.error(`Page ${page} has no recognisable list of villas. Top-level keys: ${Object.keys(body ?? {}).join(', ')}`);
    process.exit(1);
  }
  const p = { ...pagingOf(body), ...(body?.meta ?? {}) };
  // The API reports a total but not always a last page; derive it, and keep
  // going while pages come back full in case it reports neither.
  const total = Number(p.total) || 0;
  lastPage = Math.max(lastPage, Number(p.last_page) || 0, total ? Math.ceil(total / (Number(p.per_page) || PER_PAGE)) : 0, rows.length >= PER_PAGE ? page + 1 : 0);
  if (!rows.length) break;
  // A server that ignores `page` would hand back page 1 forever.
  if (page > 1 && rows[0]?.id != null && rows[0].id === raw[0]?.id) break;
  apiPages.push({ page, records: rows.length, current_page: p.current_page ?? page, last_page: lastPage, per_page: p.per_page ?? PER_PAGE, total: p.total ?? null });
  console.log(`  page ${page}/${lastPage}: ${rows.length} villas`);
  raw.push(...rows);
  if (page >= 20) break;
}
const apiTotal = apiPages.find((p) => p.total != null)?.total ?? null;

// ── map ──────────────────────────────────────────────────────────────────────

const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const pick = (o, ...paths) => {
  for (const p of paths) {
    const v = get(o, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const flag = (v) => v === true || v === 1 || v === '1' || v === 'true';
const slugify = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Supplier strings pass through as sent (the price strings use non-breaking
// spaces, and some names carry double ones); only markup, if any, is removed.
const text = (s) => {
  if (s == null) return '';
  const str = String(s);
  return (/<[a-z/][^>]*>/i.test(str) ? str.replace(/<[^>]*>/g, ' ').replace(/[ \t\r\n]+/g, ' ') : str).trim();
};

// Names and slugs by id, from the file we already trust.
const known = { region: new Map(), destination: new Map(), location: new Map() };
for (const v of previous.villas) for (const k of Object.keys(known)) if (v[k]?.id != null) known[k].set(String(v[k].id), v[k]);

function place(r, kind) {
  // The API nests these as `destinations: { id, destination, slug }` and
  // `locations: { id, location, slug }`; region arrives as region_id alone.
  const obj = [r[kind], r[`${kind}s`]].find((o) => o && typeof o === 'object' && !Array.isArray(o)) ?? {};
  const id = num(pick(obj, 'id') ?? pick(r, `${kind}_id`));
  const prior = id != null ? known[kind].get(String(id)) : undefined;
  const name = text(pick(obj, kind, 'name', 'title') ?? pick(r, `${kind}_name`, `${kind}_title`) ?? (typeof r[kind] === 'string' ? r[kind] : undefined) ?? prior?.name);
  const out = { id, name };
  if (kind !== 'region') {
    out.slug = pick(obj, 'slug') ?? pick(r, `${kind}_slug`) ?? prior?.slug ?? slugify(name);
    out.deep_link = `${SITE}/${kind}/${out.slug}`;
  }
  return out;
}

function bedroomList(v) {
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (typeof v === 'string' && v.trim()) return v.split(/[^0-9]+/).map(Number).filter((n) => n > 0);
  return [];
}

function mapVilla(r) {
  const id = num(pick(r, 'id', 'villa_id'));
  const name = text(pick(r, 'villa_name', 'name', 'title'));
  const region = place(r, 'region');
  const destination = place(r, 'destination');
  const location = place(r, 'location');
  const slug = pick(r, 'slug', 'villa_slug') ?? slugify(name);

  // Two rates: `rate_from` (the USD base rate) and `ar_rate_from` (the raw
  // figure, null for many). 766 villas in the July file differ between them,
  // so they are read separately.
  const rateRaw = pick(r, 'ar_rate_from', 'rate_from_raw', 'pricing.rate_from_raw');
  const rateUsd = pick(r, 'rate_from', 'rate_from_usd', 'pricing.rate_from_usd') ?? rateRaw;
  const priceLow = pick(r, 'price_low', 'pricing.price_low');
  const mainImage = pick(r, 'main_image', 'image', 'photo', 'main_photo');
  const specials = pick(r, 'promos', 'specials') ?? [];
  const ranked = pick(r, 'ranked_promo_category', 'ranked_special_category');

  return {
    id,
    name,
    slug,
    deep_link: `${SITE}/villa/${destination.slug}/${location.slug}/${slug}`,
    region,
    destination,
    location,
    sub_location_id: num(pick(r, 'sub_location_id', 'sub_location.id')) ?? 0,
    _coords: {
      lat: num(pick(r, 'lat', 'latitude', 'map_lat', 'geo.lat', 'location_lat')),
      lon: num(pick(r, 'lon', 'lng', 'longitude', 'map_lng', 'map_lon', 'geo.lon', 'geo.lng', 'location_lng')),
      zoom: num(pick(r, 'map_zoom', 'zoom', 'geo.map_zoom')),
    },
    capacity: {
      sleeps: num(pick(r, 'sleeps', 'max_guests', 'guests', 'capacity.sleeps')) ?? 0,
      bedrooms: num(pick(r, 'bedrooms', 'bedroom_count', 'capacity.bedrooms')) ?? 0,
      bathrooms: num(pick(r, 'bathrooms', 'bathroom_count', 'capacity.bathrooms')) ?? 0,
      available_bedrooms: bedroomList(pick(r, 'available_bedrooms', 'capacity.available_bedrooms')),
    },
    pricing: {
      rate_from_usd: num(rateUsd) ?? 0,
      rate_from_raw: num(rateRaw) ? String(rateRaw) : null,
      price_low: priceLow != null && num(priceLow) ? String(priceLow) : null,
      price_string: text(pick(r, 'price_string_no_html', 'price_string', 'pricing.price_string')) || 'Call for Pricing',
    },
    availability: {
      is_available: r.is_available == null ? true : flag(r.is_available),
      true_availability: num(pick(r, 'true_availability', 'availability.true_availability')),
      min_night_stay: num(pick(r, 'min_night_stay', 'min_stay', 'minimum_stay')),
    },
    featured: flag(pick(r, 'featured', 'is_featured')),
    main_image: mainImage ?? null,
    image_url: mainImage ? (/^https?:/.test(mainImage) ? mainImage : PHOTO_BASE + mainImage) : null,
    summary: pick(r, 'summary', 'short_description', 'excerpt') == null ? null : text(pick(r, 'summary', 'short_description', 'excerpt')),
    specials: Array.isArray(specials) ? specials.map((s) => ({ id: s?.id ?? null, title: text(s?.title ?? s?.name) })).filter((s) => s.title) : [],
    ranked_special_category: typeof ranked === 'string' ? ranked : ranked?.name ?? ranked?.title ?? null,
  };
}

const byId = new Map();
for (const r of raw) {
  const v = mapVilla(r);
  if (v.id != null && !byId.has(String(v.id))) byId.set(String(v.id), v);
}
const mapped = [...byId.values()];

// ── geo ──────────────────────────────────────────────────────────────────────

const valid = (c) => c.lat != null && c.lon != null && !(c.lat === 0 && c.lon === 0) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180;
const centroid = (pts) => ({ lat: +(pts.reduce((s, p) => s + p.lat, 0) / pts.length).toFixed(6), lon: +(pts.reduce((s, p) => s + p.lon, 0) / pts.length).toFixed(6), n: pts.length });

const pointsBy = { location: new Map(), destination: new Map() };
for (const v of mapped) {
  if (!valid(v._coords)) continue;
  for (const k of ['location', 'destination']) {
    const key = v[k].slug;
    if (!pointsBy[k].has(key)) pointsBy[k].set(key, []);
    pointsBy[k].get(key).push(v._coords);
  }
}

const unmappable = [];
const villas = [];
for (const v of mapped) {
  const { _coords: c, ...rest } = v;
  let geo;
  if (valid(c)) {
    geo = { lat: c.lat, lon: c.lon, map_zoom: c.zoom ?? 15, precision: 'villa', source: 'villas_of_distinction_api', is_exact_villa_point: true, is_mappable: true };
  } else if (previousById.get(String(v.id))?.geo?.is_mappable) {
    geo = previousById.get(String(v.id)).geo;
  } else {
    const loc = pointsBy.location.get(v.location.slug);
    const dest = pointsBy.destination.get(v.destination.slug);
    const [pts, level, zoom] = loc ? [loc, 'location', 10] : dest ? [dest, 'destination', 7] : [];
    if (pts) {
      const ctr = centroid(pts);
      geo = { lat: ctr.lat, lon: ctr.lon, map_zoom: zoom, precision: `${level}_centroid`, source: `derived_from_same_${level}_villa_points`, source_record_count: ctr.n, is_exact_villa_point: false, is_mappable: true, original_api_lat: c.lat ?? 0, original_api_lon: c.lon ?? 0 };
    }
  }
  if (!geo) {
    unmappable.push(`${v.id} ${v.name} (${v.location.name}, ${v.destination.name})`);
    continue;
  }
  // Keep the schema's key order: geo sits after sub_location_id.
  const { capacity, ...head } = rest;
  villas.push({ ...head, geo, capacity });
}
// Re-seat keys so the file diffs cleanly against the old one.
const ORDER = ['id', 'name', 'slug', 'deep_link', 'region', 'destination', 'location', 'sub_location_id', 'geo', 'capacity', 'pricing', 'availability', 'featured', 'main_image', 'image_url', 'summary', 'specials', 'ranked_special_category'];
const ordered = villas.map((v) => Object.fromEntries(ORDER.map((k) => [k, v[k]])));

// ── the gate ─────────────────────────────────────────────────────────────────

const problems = [];
const share = (list, test) => (list.length ? list.filter(test).length / list.length : 0);

if (apiTotal != null && raw.length < apiTotal) problems.push(`API reported ${apiTotal} villas but only ${raw.length} were fetched`);
if (mapped.length < raw.length * 0.99) problems.push(`${raw.length - mapped.length} raw records had no usable id`);

const floor = Math.floor(previous.villas.length * (1 - MAX_SHRINK));
if (ordered.length < floor) problems.push(`${ordered.length} villas is below the floor of ${floor} (${previous.villas.length} committed, ${MAX_SHRINK * 100}% max shrink)`);

const overlap = ordered.filter((v) => previousById.has(String(v.id)));
if (overlap.length < previous.villas.length * 0.5) {
  problems.push(`only ${overlap.length} of ${previous.villas.length} committed villa ids reappear — the id field is probably mapped wrong`);
} else {
  const prev = (v) => previousById.get(String(v.id));
  const checks = [
    ['name', 0.95, (v) => v.name.toLowerCase() === prev(v).name.toLowerCase()],
    ['destination slug', 0.95, (v) => v.destination.slug === prev(v).destination.slug],
    ['location slug', 0.9, (v) => v.location.slug === prev(v).location.slug],
    ['region name', 0.95, (v) => v.region.name === prev(v).region.name],
    ['bedrooms', 0.9, (v) => v.capacity.bedrooms === prev(v).capacity.bedrooms],
    ['sleeps', 0.85, (v) => v.capacity.sleeps === prev(v).capacity.sleeps],
    ['main image present', 0.95, (v) => !!v.main_image || !prev(v).main_image],
    // Spacing aside: the July file has non-breaking spaces where the API may not.
    ['price string', 0.6, (v) => v.pricing.price_string.replace(/\s+/g, ' ') === prev(v).pricing.price_string.replace(/\s+/g, ' ')],
    ['USD base rate', 0.85, (v) => v.pricing.rate_from_usd === prev(v).pricing.rate_from_usd],
  ];
  for (const [label, min, test] of checks) {
    const s = share(overlap, test);
    console.log(`  agreement on ${label}: ${(s * 100).toFixed(1)}%`);
    if (s < min) problems.push(`only ${(s * 100).toFixed(1)}% of returning villas agree on ${label} (need ${min * 100}%)`);
  }
}
const exact = share(ordered, (v) => v.geo.precision === 'villa');
console.log(`  own coordinates: ${(exact * 100).toFixed(1)}%`);
if (exact < 0.8) problems.push(`only ${(exact * 100).toFixed(1)}% of villas have their own coordinates — the lat/lon fields are probably mapped wrong`);

if (unmappable.length) console.log(`\n  Left out, no coordinates and nothing nearby to place them by (${unmappable.length}):\n    ${unmappable.join('\n    ')}`);

if (problems.length) {
  console.error(`\nRefusing to write ${path.relative(ROOT, OUT)}:\n  - ${problems.join('\n  - ')}`);
  console.error(`\nRaw record keys: ${Object.keys(raw[0] ?? {}).join(', ')}`);
  console.error(`First raw record:\n${JSON.stringify(raw[0], null, 2)}`);
  process.exit(1);
}

// ── regions tree ─────────────────────────────────────────────────────────────

// Rebuilt from the villas, in the committed file's region order, so the filter
// menus offer exactly the places that have something in them.
const regionOrder = previous.regions.map((r) => r.id);
const previousRegion = new Map(previous.regions.map((r) => [r.id, r]));
const tree = new Map();
for (const v of ordered) {
  if (!tree.has(v.region.id)) tree.set(v.region.id, { region: v.region, count: 0, destinations: new Map() });
  const r = tree.get(v.region.id);
  r.count++;
  if (!r.destinations.has(v.destination.slug)) r.destinations.set(v.destination.slug, { d: v.destination, locations: new Map() });
  r.destinations.get(v.destination.slug).locations.set(v.location.slug, v.location);
}
const regions = [...tree.values()]
  .sort((a, b) => {
    const ia = regionOrder.indexOf(a.region.id), ib = regionOrder.indexOf(b.region.id);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.region.name.localeCompare(b.region.name);
  })
  .map(({ region, count, destinations }) => ({
    id: region.id,
    name: region.name,
    display_property_count: count,
    source_tab_id: `v-pills-${region.id}`,
    deep_link: `${SITE}/destinations#v-pills-${region.id}`,
    destinations: [...destinations.values()]
      .sort((a, b) => a.d.name.localeCompare(b.d.name))
      .map(({ d, locations }) => ({
        name: d.name,
        slug: d.slug,
        deep_link: d.deep_link,
        locations: [...locations.values()].sort((a, b) => a.name.localeCompare(b.name)).map((l) => ({ name: l.name, slug: l.slug, deep_link: l.deep_link })),
      })),
    sort_order: previousRegion.get(region.id)?.sort_order ?? previous.regions.length + 1,
  }));

// ── write ────────────────────────────────────────────────────────────────────

const tally = (key) => ordered.reduce((m, v) => ((m[v.geo[key]] = (m[v.geo[key]] ?? 0) + 1), m), {});
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

const prevIds = new Set(previousById.keys());
const nextIds = new Set(ordered.map((v) => String(v.id)));
const added = ordered.filter((v) => !prevIds.has(String(v.id)));
const removed = previous.villas.filter((v) => !nextIds.has(String(v.id)));

const unchanged = JSON.stringify(ordered) === JSON.stringify(previous.villas) && JSON.stringify(regions) === JSON.stringify(previous.regions);

console.log(`\n${previous.villas.length} → ${ordered.length} villas (+${added.length} / −${removed.length})`);
for (const v of added.slice(0, 25)) console.log(`  + ${v.name} — ${v.location.name}, ${v.destination.name}`);
if (added.length > 25) console.log(`  …and ${added.length - 25} more added`);
for (const v of removed.slice(0, 25)) console.log(`  − ${v.name} — ${v.location.name}, ${v.destination.name}`);
if (removed.length > 25) console.log(`  …and ${removed.length - 25} more removed`);

if (unchanged) {
  console.log('\nNo changes at the supplier; file left as is.');
  process.exit(0);
}
if (DRY_RUN) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

const out = {
  schema: previous.schema,
  generated_at_utc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  source: {
    brand: 'Villas of Distinction / VillaInfo',
    destinations_url: `${SITE}/destinations`,
    villa_search_api: API,
    site_id: SITE_ID,
    api_params: { site_id: SITE_ID, per_page: PER_PAGE },
    photo_base_url: PHOTO_BASE,
    sync_script: 'scripts/sync-villas.mjs',
  },
  metadata: {
    villa_count: ordered.length,
    unique_villa_ids: nextIds.size,
    api_pages: apiPages,
    api_record_total: apiTotal ?? raw.length,
    left_out_unmappable: unmappable.length,
    geo_precision_counts: sorted(tally('precision')),
    geo_source_counts: sorted(tally('source')),
    all_records_mappable: true,
    coordinate_note:
      'API coordinates of 0,0 keep the point the villa already had; new villas without coordinates take a same-location centroid, then a same-destination centroid. Villas with neither are left out. Each record keeps geo.precision and geo.source.',
  },
  regions,
  villas: ordered,
};
// ASCII-escaped, as the July file was written, so a month's diff shows the
// villas that changed rather than every accented name re-encoded.
const ascii = (s) => s.replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
fs.writeFileSync(OUT, ascii(JSON.stringify(out, null, 2)) + '\n');
console.log(`\nWrote ${path.relative(ROOT, OUT)}.`);

#!/usr/bin/env node
// Builds data/atlas/shared/landmask.bin — the grid the sea router steers around.
//
// WHY THIS EXISTS AT ALL. The mask used to be a checked-in binary of unknown
// provenance, 0.1 degrees per cell and point-sampled, and it could not see land
// narrower than about 11 km. Probed against 26 known land points, 14 came back
// as open ocean: Brac, Korcula, Peljesac, Krk and Dugi Otok in the Adriatic,
// Long Island, Cape Cod, Phuket, Santorini, Mykonos, Capri, Elba, Jersey and
// Lofoten. Routes drew straight through every one of them, and nothing in the
// pipeline could tell: A* reported those legs as "sea" because it HAD routed
// around every obstacle the mask contained. A route that crosses an island the
// map draws is the most obviously wrong thing an atlas can do, so the mask is
// now generated, from public data, by this file.
//
// TWO RULES MAKE IT WORK
//
//   1. Higher resolution. 30 cells per degree, ~3.7 km, from lib/atlas/sea-router.mjs
//      so the router and the raster can never disagree about the grid.
//   2. CONSERVATIVE rasterisation. A cell is land if land touches it — not if
//      land happens to cover the one point at its centre. Resolution alone does
//      not fix a point-sampled mask; it just moves which islands fall through.
//      Every ring is walked and every cell its edge passes through is marked, so
//      an island smaller than a cell still occupies one. Interiors are then
//      filled by scanline, honouring holes, which is what keeps the Great Lakes
//      wet.
//
// Conservative marking closes narrow water as well as revealing narrow land, and
// some of that water is a shipping lane. See data/atlas/shared/sea-passages.json
// for the ones carved back open and why that list is short.
//
// Source: Natural Earth 10m land + minor islands (public domain), fetched on
// demand and cached in scripts/cache/naturalearth/. The GeoJSON is not committed
// — 11 MB of input for a 6.9 MB output that IS committed, because the mask is a
// build input for every deploy and must not depend on GitHub being reachable.
//
//   npm run build:landmask
//   node scripts/build-landmask.mjs --check     (verify the committed mask matches)

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../lib/virtuoso/env.mjs';
import { MASK_W, MASK_H, MASK_RES, MASK_LAT_MAX, MASK_BYTES } from '../lib/atlas/sea-router.mjs';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');

const CACHE_DIR = path.join(repoRoot, 'scripts/cache/naturalearth');
const OUT = path.join(repoRoot, 'data/atlas/shared/landmask.bin');
const PASSAGES = path.join(repoRoot, 'data/atlas/shared/sea-passages.json');

const SOURCES = [
  // Coastlines of every landmass big enough for Natural Earth's 10m land layer.
  { name: 'ne_10m_land', url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson' },
  // 2,795 islands too small for that layer — which is most of the Aegean, the
  // Grenadines, the Dalmatian coast and the Turks and Caicos, i.e. most of the
  // water the yacht atlas actually sails through.
  { name: 'ne_10m_minor_islands', url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_minor_islands.geojson' },
];

const UA = 'Mozilla/5.0 (compatible; bevvip-landmask-build/1.0)';

async function loadSource({ name, url }) {
  const cached = path.join(CACHE_DIR, `${name}.geojson`);
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'));
  if (CHECK) throw new Error(`${name} is not cached and --check must not use the network`);
  process.stdout.write(`  fetching ${name}… `);
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cached, text);
  console.log(`${(text.length / 1e6).toFixed(1)} MB`);
  return JSON.parse(text);
}

// ---------- the grid ----------

const W = MASK_W, H = MASK_H, RES = MASK_RES, LAT_MAX = MASK_LAT_MAX;

/** Cell centres, matching lib/atlas/sea-router.mjs exactly. */
const colOf = (lng) => { let c = Math.round((lng + 180) * RES); if (c >= W) c -= W; if (c < 0) c += W; return c; };
const rowOf = (lat) => Math.round((LAT_MAX - lat) * RES);
const latOfRow = (r) => LAT_MAX - r / RES;

const bits = new Uint8Array(MASK_BYTES);
const setCell = (c, r) => {
  if (r < 0 || r >= H) return;
  if (c < 0) c += W;
  if (c >= W) c -= W;
  const i = r * W + c;
  bits[i >> 3] |= 1 << (i & 7);
};
const getCell = (c, r) => {
  if (r < 0 || r >= H) return 0;
  if (c < 0) c += W;
  if (c >= W) c -= W;
  const i = r * W + c;
  return (bits[i >> 3] >> (i & 7)) & 1;
};
const clearCell = (c, r) => {
  if (r < 0 || r >= H) return;
  if (c < 0) c += W;
  if (c >= W) c -= W;
  const i = r * W + c;
  bits[i >> 3] &= ~(1 << (i & 7));
};

// ---------- pass 1: every cell an edge passes through ----------

/**
 * Mark the cells a coastline segment crosses.
 *
 * Sampled at half a cell, which cannot skip one: a step that short always lands
 * in the current cell or a neighbour. This is the pass that makes the mask
 * conservative, and it is the reason a 2 km islet — smaller than a cell, invisible
 * to any centre test at any resolution we can afford — still marks a cell as land.
 */
function markSegment(lng1, lat1, lng2, lat2) {
  const steps = Math.max(1, Math.ceil(Math.hypot(lng2 - lng1, lat2 - lat1) * RES * 2));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    setCell(colOf(lng1 + (lng2 - lng1) * f), rowOf(lat1 + (lat2 - lat1) * f));
  }
}

// ---------- pass 2: scanline fill of interiors ----------

/**
 * Fill the inside of the rings, one raster row at a time.
 *
 * Even-odd across ALL of a polygon's rings, so a hole punched by an interior
 * ring comes out unfilled — which is what leaves the Great Lakes and the Caspian
 * as water rather than turning North America into a solid block. Segments are
 * bucketed by their first row and retired as the sweep passes them, so the cost
 * is the number of crossings rather than rows x segments; done naively this step
 * is 5,100 rows against 482,000 segments and takes minutes.
 */
function fillPolygon(rings, buckets) {
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      if (y1 === y2) continue;                       // horizontal edges never cross a scanline
      const rTop = rowOf(Math.max(y1, y2));          // row indices grow southward
      const rBot = rowOf(Math.min(y1, y2));
      const from = Math.max(0, rTop), to = Math.min(H - 1, rBot);
      if (to < from) continue;
      (buckets[from] ??= []).push({ x1, y1, x2, y2, last: to });
    }
  }
}

function sweepFill(buckets) {
  let active = [];
  const xs = [];
  for (let r = 0; r < H; r++) {
    if (buckets[r]) { active.push(...buckets[r]); buckets[r] = null; }
    if (!active.length) continue;
    const lat = latOfRow(r);
    xs.length = 0;
    let write = 0;
    for (let i = 0; i < active.length; i++) {
      const e = active[i];
      if (e.last < r) continue;                      // retire
      active[write++] = e;
      const { x1, y1, x2, y2 } = e;
      // Half-open in latitude so a vertex shared by two edges counts once.
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      if (lat < lo || lat >= hi) continue;
      xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
    }
    active.length = write;
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const cFrom = Math.ceil((xs[i] + 180) * RES);
      const cTo = Math.floor((xs[i + 1] + 180) * RES);
      for (let c = cFrom; c <= cTo; c++) setCell(c, r);
    }
  }
}

// ---------- passages ----------

/**
 * Carve a shipping lane back open.
 *
 * The conservative rule marks a cell as land when land touches it anywhere, and
 * some of what that closes is navigable: at 3.7 km per cell the Bosphorus, the
 * Corinth Canal and the Suez are each narrower than a single cell, so honest
 * rasterisation walls them off. They are still routes ships take and ports we
 * sell, so a short hand-written ledger reopens them.
 *
 * The ledger is the exception list, not a tuning knob — every entry is a real
 * canal or strait, named, with the width that makes it necessary.
 */
function carve(passage) {
  const line = passage.line ?? [];
  const half = Math.max(0, Number(passage.widthCells ?? 1));
  let cleared = 0;
  let prev = null;
  const open = (c, r) => {
    for (let dr = -half; dr <= half; dr++) {
      for (let dc = -half; dc <= half; dc++) {
        if (getCell(c + dc, r + dr)) { clearCell(c + dc, r + dr); cleared++; }
      }
    }
  };
  // A polyline, because straits bend: the Bosphorus alone needs four vertices
  // to stay in the water, and a straight carve between its two mouths would cut
  // a canal through Istanbul instead of following the one that is there.
  for (let seg = 0; seg < line.length - 1; seg++) {
    const [lat1, lng1] = line[seg], [lat2, lng2] = line[seg + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(lng2 - lng1, lat2 - lat1) * RES * 2));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const c0 = colOf(lng1 + (lng2 - lng1) * f);
      const r0 = rowOf(lat1 + (lat2 - lat1) * f);
      /*
       * Step through the corner, not across it.
       *
       * The router floods the ocean with 4-connected neighbours, so a channel
       * that advances diagonally one cell at a time is not a channel at all —
       * each cell touches the next only at a corner and the fill will not pass.
       * A carve can therefore look perfect on a picture of the mask and leave
       * the sea behind it just as unreachable as before, which is exactly how
       * the Stockholm fairway stayed 42 km from open water after being carved.
       * Opening the cell beside each diagonal step keeps the corridor connected.
       */
      if (prev && prev.c !== c0 && prev.r !== r0) open(c0, prev.r);
      open(c0, r0);
      prev = { c: c0, r: r0 };
    }
  }
  return cleared;
}

// ---------- run ----------

async function main() {
  console.log(`landmask ${W}x${H} at ${RES} cells/deg (${(1 / RES).toFixed(4)} deg, ~${(111 / RES).toFixed(1)} km) — ${(MASK_BYTES / 1e6).toFixed(2)} MB\n`);

  const buckets = new Array(H).fill(null);
  let rings = 0, points = 0;

  for (const src of SOURCES) {
    const geo = await loadSource(src);
    for (const feature of geo.features ?? []) {
      const geom = feature.geometry;
      if (!geom) continue;
      const polys = geom.type === 'Polygon' ? [geom.coordinates]
        : geom.type === 'MultiPolygon' ? geom.coordinates
        : [];
      for (const poly of polys) {
        for (const ring of poly) {
          rings++; points += ring.length;
          for (let i = 0; i < ring.length - 1; i++) {
            markSegment(ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
          }
        }
        fillPolygon(poly, buckets);
      }
    }
    console.log(`  ${src.name}: ${(geo.features ?? []).length} features`);
  }
  console.log(`  ${rings.toLocaleString()} rings, ${points.toLocaleString()} points`);

  sweepFill(buckets);

  let land = 0;
  for (const byte of bits) land += POPCOUNT[byte];
  console.log(`  land cells: ${land.toLocaleString()} of ${(W * H).toLocaleString()} (${((land / (W * H)) * 100).toFixed(1)}%)`);

  if (fs.existsSync(PASSAGES)) {
    const list = JSON.parse(fs.readFileSync(PASSAGES, 'utf8')).passages ?? [];
    let total = 0;
    for (const p of list) total += carve(p);
    console.log(`  passages: ${list.length} carved open, ${total.toLocaleString()} cells reopened`);
  }

  if (CHECK) {
    if (!fs.existsSync(OUT)) { console.error(`MISSING: ${path.relative(repoRoot, OUT)}`); process.exit(1); }
    const have = fs.readFileSync(OUT);
    if (have.length !== bits.length || !have.equals(Buffer.from(bits))) {
      console.error(`STALE: ${path.relative(repoRoot, OUT)} does not match a fresh build. Run: npm run build:landmask`);
      process.exit(1);
    }
    console.log('\nok — the committed landmask matches its sources');
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bits);
  console.log(`\nwrote ${path.relative(repoRoot, OUT)}`);
}

const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

main().catch((err) => { console.error(`\nlandmask build failed: ${err.message}`); process.exit(1); });

#!/usr/bin/env node
// scripts/build-train-atlas.mjs — Rail Journeys Atlas data builder.
//
// Reads the Virtuoso train-itineraries extract and produces:
//   public/maps/train/itinerary.json        {BRANDS, REGIONS, ROUTES, TRIPS} (jet-atlas shape)
//   public/maps/train/data/rail-routes.json {legs:{key:{m,p}}, trips:{id:[{k,rev}]}}
//   data/atlas/train/itinerary.json         copy of itinerary.json for lib/atlas/trains.js
//
// Route geometry follows real railway lines via the signal.eu.org OSM rail
// router (OSRM train profile); falls back to OSRM road routing where the rail
// graph has gaps (Japan, Malaysia border), and to a gentle arc for over-water
// connections (ferries / internal flights). Geocoding + leg geometry are
// cached under scripts/cache/ so re-runs are cheap.
//
// Regen after train-itineraries.json changes:
//   node scripts/build-train-atlas.mjs [--source /path/to/train-itineraries.json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const SOURCE = argVal(
  "--source",
  "/Users/payntar/Documents/Codex/2026-06-24/visit-links-create-port-by-port-2/train-itineraries.json"
);
const CACHE_DIR = path.join(__dirname, "cache");
const GEO_CACHE = path.join(CACHE_DIR, "train-geocode.json");
const LEG_CACHE = path.join(CACHE_DIR, "train-legs.json");
const OUT_PUBLIC = path.join(ROOT, "public", "maps", "train");
const OUT_DATA = path.join(ROOT, "data", "atlas", "train");
const TODAY = new Date().toISOString().slice(0, 10);

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(path.join(OUT_PUBLIC, "data"), { recursive: true });
fs.mkdirSync(OUT_DATA, { recursive: true });

const unescapeHtml = (s) =>
  String(s == null ? "" : s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&rsquo;|&#8217;/g, "’");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loadJson = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return dflt; } };
const saveJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v));

// ---------------------------------------------------------------- regions --
const REGIONS = {
  BRITAIN:  { name: "Great Britain & Ireland",    ab: "Britain",   coord: [55.6, -3.6] },
  EUROPE:   { name: "Continental Europe",         ab: "Europe",    coord: [46.5, 10.2] },
  NORDICS:  { name: "Scandinavia & the Nordics",  ab: "Nordics",   coord: [61.4, 9.0] },
  EASTASIA: { name: "Japan & Korea",              ab: "E. Asia",   coord: [36.2, 133.5] },
  SEASIA:   { name: "Southeast Asia",             ab: "SE Asia",   coord: [4.0, 103.0] },
  INDIA:    { name: "India & South Asia",         ab: "S. Asia",   coord: [22, 80] },
  AFRICA:   { name: "Southern Africa",            ab: "Africa",    coord: [-27.0, 25.0] },
  SAM:      { name: "South America",              ab: "S. America",coord: [-13.5, -72.5] },
  AMERICAS: { name: "American West & Alaska",     ab: "U.S.",      coord: [41.0, -111.5] },
  CANADA:   { name: "Canada Coast to Coast",      ab: "Canada",    coord: [51.3, -120.5] },
  ANZ:      { name: "Australia & New Zealand",    ab: "ANZ",       coord: [-33, 151] },
};
const COUNTRY_REGION = [
  [/ (AB|BC|QC|ON|PE|NS|MB|NB|SK|YT|NT|NL) Canada$|, Canada$/, "CANADA", "CA"],
  [/ (AK|CO|UT|MT|NV|WY|AZ|NM|CA|WA|OR|ID|SD|ND|CO) United States$|, United States$/, "AMERICAS", "US"],
  [/United Kingdom$|Ireland$/, "BRITAIN", "GB,IE"],
  [/Norway$|Sweden$|Denmark$|Finland$|Iceland$/, "NORDICS", "NO,SE,DK,FI,IS"],
  [/Italy$|Switzerland$|France$|Austria$|Germany$|Hungary$|Romania$|Bulgaria$|Czech Republic$|Czechia$|Poland$|Portugal$|Spain$|Turkey$|Netherlands$|Belgium$|Monaco$|Greece$|Croatia$|Slovakia$|Slovenia$|Liechtenstein$|Luxembourg$/, "EUROPE", "IT,CH,FR,AT,DE,HU,RO,BG,CZ,PL,PT,ES,TR,NL,BE,MC,GR,HR,SK,SI,LI,LU"],
  [/Japan$|South Korea$|Korea$|Taiwan$|China$/, "EASTASIA", "JP,KR,TW,CN"],
  [/Singapore$|Malaysia$|Indonesia$|Myanmar$|Thailand$|Vietnam$|Laos$|Cambodia$/, "SEASIA", "SG,MY,ID,MM,TH,VN,LA,KH"],
  [/India$|Sri Lanka$|Nepal$|Bhutan$/, "INDIA", "IN,LK,NP,BT"],
  [/South Africa$|Zimbabwe$|Zambia$|Botswana$|Namibia$|Tanzania$|Kenya$/, "AFRICA", "ZA,ZW,ZM,BW,NA,TZ,KE"],
  [/Peru$|Ecuador$|Chile$|Argentina$|Bolivia$|Brazil$/, "SAM", "PE,EC,CL,AR,BO,BR"],
  [/Australia$|New Zealand$/, "ANZ", "AU,NZ"],
];
function regionFor(name) {
  for (const [re, key] of COUNTRY_REGION) if (re.test(name)) return key;
  return null;
}
function expectedCC(name) {
  for (const [re, , cc] of COUNTRY_REGION) if (re.test(name)) return cc.split(",");
  return null;
}

// ----------------------------------------------------------------- brands --
const BRAND_DEFS = [
  [/^Belmond Trains$/i, "belmond", "Belmond Trains", "belmond.com", "#1a3a34"],
  [/^Belmond Peruvian/i, "belmondperu", "Belmond Peruvian Trains", "belmond.com", "#2c554a"],
  [/La Dolce Vita/i, "dolcevita", "La Dolce Vita Orient Express", "orient-express.com", "#7a1e2d"],
  [/Canada by Design/i, "canadabydesign", "Canada by Design", "canadabydesign.com", "#b03c2e"],
  [/^Inside Travel/i, "insidetravel", "Inside Travel (Japan)", "insidetravelgroup.com", "#c0392b"],
  [/Canyon Spirit/i, "canyonspirit", "Canyon Spirit", "canyonspirit.com", "#a5652c"],
  [/Avanti Destinations/i, "avanti", "Avanti Destinations", "avantidestinations.com", "#0f6d75"],
  [/Bucher Travel/i, "bucher", "Bucher Travel — Switzerland", "buchertravel.ch", "#c8102e"],
  [/andBeyond/i, "andbeyond", "andBeyond South Africa", "andbeyond.com", "#4a5d23"],
  [/EXO Travel/i, "exo", "EXO Travel", "exotravel.com", "#0e7c66"],
  [/Rocky Mountaineer/i, "rockymountaineer", "Rocky Mountaineer", "rockymountaineer.com", "#143c6b"],
  [/Knightly Tours/i, "knightly", "Knightly Tours", "knightlytours.com", "#5b4a86"],
  [/Abercrombie/i, "ak", "Abercrombie & Kent", "abercrombiekent.com", "#1f3a5f"],
  [/Keytours/i, "keytours", "Keytours Vacations", "keytours.com", "#28626e"],
  [/Delta of Scandinavia/i, "deltascan", "Delta of Scandinavia", "", "#33658a"],
  [/Adams & Butler/i, "adamsbutler", "Adams & Butler", "adamsandbutler.com", "#3f5d45"],
  [/Remote Lands/i, "remotelands", "Remote Lands", "remotelands.com", "#b08d57"],
  [/ICS Travel/i, "ics", "ICS Travel Group", "icstravelgroup.com", "#8a5a2b"],
  [/Mazurkas/i, "mazurkas", "Mazurkas Travel — Poland", "mazurkas.com.pl", "#7d2e46"],
  [/Ker & Downey/i, "kerdowney", "Ker & Downey", "kerdowney.com", "#6b4f2a"],
  [/50 Degrees North/i, "fiftynorth", "50 Degrees North", "fiftydegreesnorth.com", "#2e5e63"],
];
function brandFor(operator) {
  for (const [re, key] of BRAND_DEFS) if (re.test(operator)) return key;
  return "other";
}

// Named trains → card chip + the "Legendary Trains" marquee view (world flag).
const NAMED_TRAINS = [
  [/venice simplon[- ]orient[- ]?express/i, "Venice Simplon-Orient-Express"],
  [/royal scotsman/i, "Royal Scotsman"],
  [/britannic explorer/i, "Britannic Explorer"],
  [/eastern (&|and) oriental/i, "Eastern & Oriental Express"],
  [/rocky mountaineer/i, "Rocky Mountaineer"],
  [/andean explorer|belmond in peru/i, "Andean Explorer"],
  [/la dolce vita/i, "La Dolce Vita Orient Express"],
  [/jacobite/i, "Jacobite Steam Train"],
  [/glacier express/i, "Glacier Express"],
  [/bernina/i, "Bernina Express"],
  [/maharajas/i, "Maharajas' Express"],
  [/golden eagle/i, "Golden Eagle"],
  [/rovos/i, "Rovos Rail"],
  [/blue train/i, "The Blue Train"],
  [/seven stars/i, "Seven Stars in Kyushu"],
  [/shiki[- ]?shima/i, "Train Suite Shiki-Shima"],
  [/via rail|the canadian/i, "VIA Rail Canadian"],
];
function namedTrain(t) {
  const hay = `${t.name} ${t.sourceTitle || ""} ${t.category || ""}`;
  for (const [re, label] of NAMED_TRAINS) if (re.test(hay)) return label;
  return null;
}

// ---------------------------------------------------------------- geocode --
const CA_PROV = { AB: "Alberta", BC: "British Columbia", QC: "Quebec", ON: "Ontario", PE: "Prince Edward Island", NS: "Nova Scotia", MB: "Manitoba", NB: "New Brunswick", SK: "Saskatchewan", YT: "Yukon", NT: "Northwest Territories", NL: "Newfoundland and Labrador" };
const US_STATE = { AK: "Alaska", CO: "Colorado", UT: "Utah", MT: "Montana", NV: "Nevada", WY: "Wyoming", AZ: "Arizona", NM: "New Mexico", WA: "Washington", OR: "Oregon", ID: "Idaho" };
function geocodeQuery(name) {
  let q = name;
  let m = q.match(/^(.*), ([A-Z]{2}) Canada$/);
  if (m && CA_PROV[m[2]]) q = `${m[1]}, ${CA_PROV[m[2]]}, Canada`;
  m = q.match(/^(.*), ([A-Z]{2}) United States$/);
  if (m && US_STATE[m[2]]) q = `${m[1]}, ${US_STATE[m[2]]}, United States`;
  return q;
}
// Hand fixes for stops the geocoders misplace or miss.
const GEO_OVERRIDES = {
  // name -> [lat, lng] — photon/nominatim return prefecture centroids for
  // several Japanese city names; pin them to the main rail station instead.
  "Fukuoka, Japan": [33.590, 130.421],   // Hakata Station
  "Hiroshima, Japan": [34.398, 132.475], // Hiroshima Station
  "Kumamoto, Japan": [32.790, 130.689],  // Kumamoto Station
  "Saga, Japan": [33.264, 130.294],      // Saga Station
  "Aso, Japan": [32.941, 131.085],       // Aso Station
};
const geoCache = loadJson(GEO_CACHE, {});
async function geocode(name) {
  if (GEO_OVERRIDES[name]) return GEO_OVERRIDES[name];
  if (name in geoCache) return geoCache[name];
  const expect = expectedCC(name);
  const q = geocodeQuery(name);
  let ll = null;
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=3`);
    if (r.ok) {
      const j = await r.json();
      for (const f of j.features || []) {
        const cc = (f.properties && f.properties.countrycode) || "";
        if (!expect || expect.includes(cc)) {
          ll = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
          break;
        }
      }
    }
  } catch {}
  if (!ll) {
    await sleep(1100);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { "User-Agent": "BeVvip-Atlas-Builder/1.0 (Book@BeVvip.com)" } }
      );
      if (r.ok) {
        const j = await r.json();
        if (j[0]) ll = [Number(j[0].lat), Number(j[0].lon)];
      }
    } catch {}
  }
  if (ll) ll = [Math.round(ll[0] * 1000) / 1000, Math.round(ll[1] * 1000) / 1000];
  geoCache[name] = ll; // cache misses too, so re-runs skip them
  saveJson(GEO_CACHE, geoCache);
  await sleep(260);
  return ll;
}

// ----------------------------------------------------------------- routing --
const R = 6371;
function havKm(a, b) {
  const dLa = ((b[0] - a[0]) * Math.PI) / 180, dLo = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180, la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function simplify(pts, tol) {
  // Douglas–Peucker on [lat,lng] using degrees.
  if (pts.length <= 2) return pts;
  const sq = (x) => x * x;
  function segDist(p, a, b) {
    let x = a[1], y = a[0], dx = b[1] - x, dy = b[0] - y;
    if (dx || dy) {
      const t = ((p[1] - x) * dx + (p[0] - y) * dy) / (sq(dx) + sq(dy));
      if (t > 1) { x = b[1]; y = b[0]; } else if (t > 0) { x += dx * t; y += dy * t; }
    }
    return Math.sqrt(sq(p[1] - x) + sq(p[0] - y));
  }
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) { const d = segDist(pts[i], pts[s], pts[e]); if (d > maxD) { maxD = d; idx = i; } }
    if (maxD > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function arcPts(a, b) {
  const k = 0.10, mx = (a[1] + b[1]) / 2, my = (a[0] + b[0]) / 2;
  const cx = mx - (b[0] - a[0]) * k, cy = my + (b[1] - a[1]) * k;
  const p = [];
  for (let t = 0; t <= 1.0001; t += 0.08) {
    p.push([
      Math.round(((1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * cy + t * t * b[0]) * 1e4) / 1e4,
      Math.round(((1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * cx + t * t * b[1]) * 1e4) / 1e4,
    ]);
  }
  return p;
}
async function osrmRoute(base, profile, a, b) {
  const url = `${base}/route/v1/${profile}/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const j = await r.json();
  if (j.code !== "Ok" || !j.routes || !j.routes[0]) return null;
  const pts = j.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
  return { distKm: j.routes[0].distance / 1000, pts };
}
const legCache = loadJson(LEG_CACHE, {});
async function routeLeg(a, b) {
  const key = `${a[0]},${a[1]}|${b[0]},${b[1]}`;
  if (legCache[key]) return { key, ...legCache[key] };
  const S = havKm(a, b);
  let mode = "arc", pts = null;
  try {
    const rail = await osrmRoute("https://signal.eu.org/osm/eu", "train", a, b);
    await sleep(700);
    if (rail && rail.distKm <= Math.max(S * 4, S + 80)) { mode = "rail"; pts = rail.pts; }
  } catch {}
  if (!pts && S <= 2500) {
    try {
      const road = await osrmRoute("https://router.project-osrm.org", "driving", a, b);
      await sleep(700);
      if (road && road.distKm <= Math.max(S * 3.5, S + 60)) { mode = "road"; pts = road.pts; }
    } catch {}
  }
  if (!pts) { mode = "arc"; pts = arcPts(a, b); }
  else {
    pts = simplify(pts, 0.004).map((p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]);
    // pin endpoints to the requested stops so legs visually connect
    pts[0] = a.slice(); pts[pts.length - 1] = b.slice();
  }
  legCache[key] = { m: mode, p: pts };
  saveJson(LEG_CACHE, legCache);
  return { key, m: mode, p: pts };
}

// ------------------------------------------------------------------- main --
const src = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const items = Object.values(src.itineraries || {});
console.log(`source: ${items.length} itineraries`);

// 1) collect + geocode unique location names
const namesInOrder = [];
const seenNames = new Set();
const SKIP_LOC = /^excursion/i;
for (const it of items)
  for (const d of it.days || [])
    for (const l of d.locations || []) {
      const nm = unescapeHtml((l.name || "").trim());
      if (!nm || SKIP_LOC.test(nm) || seenNames.has(nm)) continue;
      seenNames.add(nm); namesInOrder.push(nm);
    }
console.log(`geocoding ${namesInOrder.length} unique locations (cache: ${Object.keys(geoCache).length})`);
const LL = {};
let done = 0;
for (const nm of namesInOrder) {
  LL[nm] = await geocode(nm);
  if (++done % 25 === 0) console.log(`  geocoded ${done}/${namesInOrder.length}`);
}
const missing = namesInOrder.filter((n) => !LL[n]);
if (missing.length) console.log(`GEOCODE MISSES (${missing.length}):\n  ` + missing.join("\n  "));

// 2) build TRIPS + ROUTES
const shortName = (nm) => nm.split(",")[0].trim();
const BRANDS = {};
for (const [, key, short, domain, color] of BRAND_DEFS) BRANDS[key] = { short, domain, color };
BRANDS.other = { short: "Rail Specialist", domain: "", color: "#555f6e", glyph: "\u{1F686}" };

const TRIPS = [];
const ROUTES = {};
const tripLegs = {}; // id -> [{k, rev}]
const legsOut = {};
let statRail = 0, statRoad = 0, statArc = 0, statDropped = 0;

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const mdy = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${m}/${d}/${y}`; };
const monLabel = (iso) => { const [y, m] = iso.split("-").map(Number); return `${MON[m - 1]} ${y}`; };

for (const it of items) {
  const id = String(it.id);
  const name = unescapeHtml(it.name);
  const operator = unescapeHtml(it.operator || "");
  const b = brandFor(operator);

  // day-by-day stops
  const stops = []; // {n(full), ll, day}
  const itin = []; // {d, n(short), date?}
  for (const d of it.days || []) {
    for (const l of d.locations || []) {
      const nm = unescapeHtml((l.name || "").trim());
      if (!nm || SKIP_LOC.test(nm)) continue;
      if (!itin.length || itin[itin.length - 1].n !== shortName(nm) || itin[itin.length - 1].d !== d.day)
        itin.push({ d: d.day, n: shortName(nm), full: nm });
      const ll = LL[nm];
      if (ll && (!stops.length || stops[stops.length - 1].full !== nm))
        stops.push({ full: nm, ll, day: d.day });
    }
  }
  // outlier drop: stop >1500km from BOTH neighbours while neighbours are close
  const clean = stops.filter((s, i) => {
    const prev = stops[i - 1], next = stops[i + 1];
    if (!prev || !next) return true;
    const dp = havKm(prev.ll, s.ll), dn = havKm(s.ll, next.ll), skip = havKm(prev.ll, next.ll);
    const bad = dp > 1500 && dn > 1500 && skip < 400;
    if (bad) statDropped++;
    return !bad;
  });

  // regions from visited places (ordered), fall back to origin/destination names
  const gset = [];
  for (const s of clean) { const r = regionFor(s.full); if (r && !gset.includes(r)) gset.push(r); }
  if (!gset.length) {
    for (const endp of [it.origin, it.destination]) {
      const r = endp && endp.name ? regionFor(unescapeHtml(endp.name)) : null;
      if (r && !gset.includes(r)) gset.push(r);
    }
  }
  if (!gset.length) { console.log(`  !! no region for ${id} ${name}`); continue; }

  // departures — keep future ones
  const deps = (it.departures || []).filter((d) => d.start >= TODAY).sort((x, y) => x.start.localeCompare(y.start));
  const win = it.departureWindow || null;
  const t = {
    id, n: name, b, g: gset, u: it.url || null, days: it.durationDays || (it.days || []).length,
    img: it.image || null,
  };
  // Guide-backend enrichments (the map ignores these): origin/terminus names,
  // the dominant country, and a marquee-region key where one genuinely applies.
  const originName = it.origin && it.origin.name ? unescapeHtml(it.origin.name) : (clean[0] ? clean[0].full : null);
  const destName = it.destination && it.destination.name ? unescapeHtml(it.destination.name) : (clean.length ? clean[clean.length - 1].full : null);
  if (originName) t.from = originName;
  if (destName) t.to = destName;
  const countryTally = {};
  for (const s of clean) {
    let tail = s.full.includes(",") ? s.full.split(",").pop().trim() : "";
    tail = tail.replace(/^(AB|BC|QC|ON|PE|NS|MB|NB|SK|YT|NT|NL) Canada$/, "Canada")
               .replace(/^(AK|CO|UT|MT|NV|WY|AZ|NM|CA|WA|OR|ID|SD|ND) United States$/, "United States");
    if (tail) countryTally[tail] = (countryTally[tail] || 0) + 1;
  }
  const topCountry = Object.entries(countryTally).sort((a, b) => b[1] - a[1])[0];
  if (topCountry) t.country = topCountry[0];
  const mqSource = `${Object.keys(countryTally).join(" ")} ${name}`;
  if (/Japan/i.test(mqSource)) t.mq = "japan";
  else if (/Norway/i.test(mqSource)) t.mq = "norway";
  else if (/\bAlaska\b/i.test(mqSource) || clean.some((s) => / AK United States$/.test(s.full))) t.mq = "alaska";
  const train = namedTrain({ name, sourceTitle: it.sourceTitle, category: it.category });
  if (train) { t.train = train; t.world = true; }
  if (deps.length) {
    t.d = mdy(deps[0].start); t.r = mdy(deps[0].end);
    t.depCount = deps.length;
    t.mks = [...new Set(deps.map((d) => d.start.slice(0, 7)))];
    const d0 = new Date(deps[0].start + "T00:00:00Z");
    itin.forEach((e) => {
      const dt = new Date(d0.getTime() + (e.d - 1) * 86400000);
      e.date = dt.toISOString().slice(0, 10);
    });
  } else {
    t.onDemand = true;
    if (win && win.start && win.end) t.win = `${monLabel(win.start.slice(0, 7))} – ${monLabel(win.end.slice(0, 7))}`;
  }
  t.itin = itin.map(({ d, n, date }) => (date ? { d, n, date } : { d, n }));

  if (clean.length >= 1) {
    ROUTES[id] = clean.map((s) => ({ n: shortName(s.full), r: regionFor(s.full) || gset[0], ll: s.ll }));
    t.route = id;
  }
  TRIPS.push(t);

  // 3) leg geometry
  if (clean.length >= 2) {
    const seq = [];
    for (let i = 0; i < clean.length - 1; i++) {
      const a = clean[i].ll, bb = clean[i + 1].ll;
      if (havKm(a, bb) < 0.3) continue;
      // orientation-normalized cache key
      const fwd = a[0] < bb[0] || (a[0] === bb[0] && a[1] <= bb[1]);
      const [p1, p2] = fwd ? [a, bb] : [bb, a];
      const leg = await routeLeg(p1, p2);
      if (!legsOut[leg.key]) {
        legsOut[leg.key] = { m: leg.m, p: leg.p };
        if (leg.m === "rail") statRail++; else if (leg.m === "road") statRoad++; else statArc++;
      }
      seq.push({ k: leg.key, rev: fwd ? 0 : 1 });
    }
    tripLegs[id] = seq;
    process.stdout.write(`  routed ${id} ${name.slice(0, 48)} (${seq.length} legs)\n`);
  }
}

// 4) write outputs
const itineraryOut = { BRANDS, REGIONS, ROUTES, TRIPS };
fs.writeFileSync(path.join(OUT_PUBLIC, "itinerary.json"), JSON.stringify(itineraryOut));
fs.writeFileSync(path.join(OUT_DATA, "itinerary.json"), JSON.stringify(itineraryOut));
fs.writeFileSync(path.join(OUT_PUBLIC, "data", "rail-routes.json"), JSON.stringify({ legs: legsOut, trips: tripLegs }));

const bytes = (p) => (fs.statSync(p).size / 1024).toFixed(0) + "KB";
console.log(`\nTRIPS: ${TRIPS.length} · legendary: ${TRIPS.filter((t) => t.world).length} · with dates: ${TRIPS.filter((t) => t.d).length}`);
console.log(`legs unique: ${Object.keys(legsOut).length} (rail ${statRail} / road ${statRoad} / arc ${statArc}) · outlier stops dropped: ${statDropped}`);
console.log(`itinerary.json ${bytes(path.join(OUT_PUBLIC, "itinerary.json"))} · rail-routes.json ${bytes(path.join(OUT_PUBLIC, "data", "rail-routes.json"))}`);
const regTally = {};
for (const t of TRIPS) t.g.forEach((k) => (regTally[k] = (regTally[k] || 0) + 1));
console.log("regions:", JSON.stringify(regTally));

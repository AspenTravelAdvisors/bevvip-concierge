#!/usr/bin/env node
/**
 * audit-port-locations — find stops whose coordinates are in the wrong place.
 *
 *   node scripts/audit-port-locations.mjs            report, exit 0
 *   node scripts/audit-port-locations.mjs --strict   exit 1 if anything is found
 *   node scripts/audit-port-locations.mjs --json     machine-readable findings
 *   node scripts/audit-port-locations.mjs --collection=world
 *   node scripts/audit-port-locations.mjs --all      ignore the confirmed list
 *
 * Corrections live next door, in data/atlas/shared/port-overrides.json, and are
 * applied to the feeds by scripts/fix-port-locations.mjs. That file also holds
 * the `confirmed` list — stops this audit flags that a human has checked and
 * found correct — which is what makes --strict usable as a build gate.
 *
 * ── The problem ────────────────────────────────────────────────────────────
 *
 * "West Point, United Kingdom" sits at 51.41N, 0.73E — the Thames Estuary — in
 * the middle of a world cruise otherwise rounding Cape Horn. The real stop is
 * West Point Island in the Falklands, 51.35S 60.68W: a geocoder matched the
 * name to the wrong hemisphere, and the route obligingly drew a 12,000km spike
 * from Patagonia to Kent and back.
 *
 * The instructive part is what does NOT catch it. The stop is labelled "United
 * Kingdom" and the coordinate IS in the United Kingdom, so every check that
 * compares a name against a gazetteer passes it happily. What gives it away is
 * the company it keeps: the stops on either side are in the South Atlantic.
 *
 * So the checks here are mostly GEOMETRIC, not nominal. They ask whether a stop
 * makes sense where the journey puts it, which needs no gazetteer, no country
 * table, and no per-feed knowledge. Six of them, each with its own blind spot,
 * which is why there are six:
 *
 *   hygiene       a coordinate that cannot be a place at all
 *   detour        a stop far off the line between its neighbours
 *   pace          a hop no vehicle could make in the days allowed
 *   stranded      a stop far from BOTH neighbours, by this journey's own scale
 *   landlocked    a dry stop on a voyage that is otherwise at sea
 *   disagreement  two feeds mapping one name hundreds of km apart
 *
 * Jets are exempt from most of it on purpose: a jet itinerary is a list of
 * places chosen for not being near each other, so the geometry that convicts a
 * ship acquits a jet. Each check below says what it gives up and why.
 *
 * ── Why it is built this way ───────────────────────────────────────────────
 *
 * Cruise, jet and rail data are moving to live APIs, so a checker wired to the
 * current JSON shapes would have to be rewritten the moment that lands. The
 * split here is deliberate:
 *
 *   SOURCES   one small adapter per feed, whose only job is to yield journeys
 *             in a normalised shape: { collection, id, title, stops[] } with
 *             each stop { name, lat, lng, day }.
 *
 *   CHECKS    pure functions over that normalised shape. They never see a file
 *             format, so an API migration cannot break them.
 *
 * To cover a new feed, add a SOURCES entry. To validate a live API response
 * before it is cached, import `auditJourneys` and hand it the same shape — the
 * checks are exported for exactly that.
 *
 * ── What it reports ────────────────────────────────────────────────────────
 *
 * Findings are grouped by STOP, not by journey, because one bad coordinate is
 * one fix however many itineraries it corrupts. Each carries the evidence that
 * flagged it, so a human can confirm before editing anything — none of this
 * rewrites data. Corrections are written down in the ledger and applied by
 * fix-port-locations.mjs, so the fix survives the next feed refresh.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const has = (p) => existsSync(join(ROOT, p));

// ── Geometry ───────────────────────────────────────────────────────────────

const R_EARTH = 6371;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km. Handles the antimeridian by construction. */
export function km(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

// ── Checks ─────────────────────────────────────────────────────────────────

/**
 * How far a journey can plausibly advance in a day, in km.
 *
 * Deliberately far above cruising speed. A fast ship makes ~25 knots, or
 * 1,100km in 24 hours, and a ceiling near that number looks right and is
 * useless: expedition itineraries routinely FLY guests between segments —
 * Ushuaia to Buenos Aires, Longyearbyen to Oslo, Easter Island to Santiago —
 * and each of those charter hops trips a ship-speed test. At 1,600km/day the
 * report was three-quarters charter flights.
 *
 * So this is a "no vehicle did that" line rather than a "no ship did that"
 * one: above a positioning flight, below the 6,700km/day that a stop in the
 * wrong hemisphere produces. It gives up the ability to catch a stop
 * mislocated by a few hundred kilometres, which the detour check sees anyway.
 */
const PACE_CEILING = {
  world: 5000,
  yacht: 5000,
  cruise: 5000,
  jet: 14000,   // a long-range private jet, a positioning leg, and no sleep
  train: 2500,
};
const DEFAULT_PACE = 5000;

/**
 * A detour has to be BOTH disproportionate and large to count.
 *
 * Ratio alone flags every tender stop: two anchorages 5km apart with a 1km
 * hop between them is a 6x "detour" and entirely normal. Absolute distance
 * alone flags every legitimate ocean crossing. Requiring both means a stop is
 * only called out when visiting it adds thousands of kilometres that going
 * straight from its predecessor to its successor would not.
 *
 * The bar is far higher for jets, and that is a real limit rather than a
 * tuned-away nuisance. A ship's itinerary is a path — it has to sail past the
 * places between its stops, so a stop off that path is evidence. A private-jet
 * itinerary is a LIST: London, Tangier, AlUla, and the point of the product is
 * that it does not join up. Every jet finding at the ship threshold was a real
 * itinerary flying somewhere far away on purpose. Raising the bar keeps only
 * the impossible, and leaves jet coverage genuinely weak until those routes
 * carry day numbers (ROUTES has none today) and the pace check can see them.
 */
const DETOUR_MIN_EXTRA_KM = { jet: 12000 };
const DEFAULT_DETOUR_EXTRA_KM = 2000;
const DETOUR_MIN_RATIO = 3;

/**
 * Flag a stop that sits absurdly far off the line between its neighbours.
 *
 * This is the check that catches West Point: its neighbours are both in the
 * South Atlantic, so skipping it costs almost nothing while visiting it costs
 * 24,000km. Needs no day numbers, so it works on feeds that carry only an
 * ordered list of places — which is most of them.
 */
export function checkDetour(journey, findings) {
  const s = journey.stops;
  const minExtra = DETOUR_MIN_EXTRA_KM[journey.collection] ?? DEFAULT_DETOUR_EXTRA_KM;
  for (let i = 1; i < s.length - 1; i++) {
    const direct = km(s[i - 1], s[i + 1]);
    const via = km(s[i - 1], s[i]) + km(s[i], s[i + 1]);
    const extra = via - direct;
    // A ratio against a near-zero direct distance is meaningless; floor it.
    const ratio = via / Math.max(direct, 1);
    if (extra >= minExtra && ratio >= DETOUR_MIN_RATIO) {
      findings.push({
        kind: "detour",
        collection: journey.collection,
        stop: s[i],
        journey,
        detail: `visiting it adds ${Math.round(extra).toLocaleString()}km`
          + ` between ${s[i - 1].name} and ${s[i + 1].name}`,
        score: extra,
      });
    }
  }
}

/**
 * Flag a hop no vehicle of this kind could make in the days allowed.
 *
 * Complements the detour check at the two places it cannot see: the first and
 * last stop of a journey, which have no pair of neighbours to be off the line
 * between. A wrong departure port is exactly as damaging and rather easier to
 * ship unnoticed.
 */
export function checkPace(journey, findings) {
  const ceiling = PACE_CEILING[journey.collection] ?? DEFAULT_PACE;
  const s = journey.stops;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    if (a.day == null || b.day == null) continue;
    // Same-day stops still get a full day's allowance rather than dividing by
    // zero: several calls in one day is normal, and they are always close.
    const days = Math.max(1, (b.day - a.day) || 0);
    const pace = km(a, b) / days;
    if (pace <= ceiling) continue;
    /*
     * Which of the two is actually wrong? Getting this right matters: the
     * report is a list of stops to correct, and naming the innocent
     * neighbour sends someone to edit a perfectly good coordinate.
     *
     * The outlier is the one that is ALSO far from its OTHER neighbour — a
     * misplaced stop is stranded on both sides, while its neighbours are
     * only stranded on the side facing it. Measuring that locally rather
     * than against the journey's centre of mass is what makes it work on a
     * pole-to-pole voyage, where the centre is thousands of kilometres from
     * everything and blames whichever end of the world the route reaches.
     */
    const before = i >= 2 ? km(s[i - 2], a) : null;
    const after = i + 1 < s.length ? km(b, s[i + 1]) : null;
    let suspect;
    if (before == null && after == null) suspect = b;      // a two-stop journey
    else if (before == null) suspect = after > ceiling ? b : a;
    else if (after == null) suspect = before > ceiling ? a : b;
    else suspect = before > after ? a : b;
    findings.push({
      kind: "pace",
      collection: journey.collection,
      stop: suspect,
      journey,
      detail: `${Math.round(km(a, b)).toLocaleString()}km from ${a.name} to ${b.name}`
        + ` in ${days} day${days === 1 ? "" : "s"} (${Math.round(pace).toLocaleString()}km/day)`,
      score: pace,
    });
  }
}

/**
 * Flag a stop marooned from BOTH its neighbours, judged against the journey's
 * own typical leg.
 *
 * This is the "one leg is longer than the rest" idea, with the correction that
 * makes it usable: one long leg is not evidence of anything. Los Angeles to
 * Nawiliwili is 4,222km and 12x the surrounding legs of that voyage, and it is
 * simply the Pacific. Every ocean crossing in the feed looks like that from one
 * side, which is why a leg-length test alone flagged 70 innocent stops.
 *
 * A rogue coordinate is different in kind: it is far from what comes before AND
 * far from what comes after, because the rest of the voyage is somewhere else
 * entirely. "Half Moon Island, Antarctica" landed at 32.5N, 80.7W — coastal
 * South Carolina, so no land check sees it — 9,628km from Port Stanley and
 * 9,000km from the Antarctic Peninsula. Taking the SMALLER of the two distances
 * as the score keeps genuine crossings out by construction: their far end is
 * always close to the stop after it.
 *
 * The yardstick is the journey itself, since a world cruise tolerates legs that
 * would be absurd on a fjord itinerary. Zero-length legs (a ship staying put, or
 * several calls in one port) are excluded from the median, or a repeat-heavy
 * itinerary calibrates to zero and flags everything. MIN_ABS_KM then keeps the
 * ratio honest on short-hop voyages.
 *
 * Terminal stops have only one neighbour, so "both sides" is unavailable and
 * the bar doubles instead. It has to: a voyage that begins in Los Angeles and
 * sails to Hawaii, or ends at Fort Lauderdale after the Atlantic, has exactly
 * the shape of a stranded stop when you can only look one way. Doubling keeps
 * the ends covered against a departure port on the wrong continent while
 * leaving ordinary repositioning alone.
 *
 * Jets are exempt for the reason given above DETOUR_MIN_EXTRA_KM: a jet
 * itinerary is a list of places, not a path.
 */
const STRANDED_MIN_RATIO = 6;
const STRANDED_MIN_ABS_KM = { world: 4000, yacht: 2500, cruise: 2500, train: 1500 };
const STRANDED_TERMINAL_FACTOR = 2;

export function checkStranded(journey, findings) {
  const minAbs = STRANDED_MIN_ABS_KM[journey.collection];
  if (minAbs == null) return;                 // jets, and any feed not listed
  const s = journey.stops;
  const lens = [];
  for (let i = 1; i < s.length; i++) lens.push(km(s[i - 1], s[i]));
  const moved = lens.filter((d) => d > 1);
  if (moved.length < 4) return;               // too short to calibrate against
  const typical = median(moved);
  const bar = Math.max(minAbs, STRANDED_MIN_RATIO * typical);
  for (let i = 0; i < s.length; i++) {
    const before = i > 0 ? lens[i - 1] : null;
    const after = i < s.length - 1 ? lens[i] : null;
    const terminal = before == null || after == null;
    const isolation = before == null ? after : after == null ? before : Math.min(before, after);
    if (isolation == null) continue;
    if (isolation < bar * (terminal ? STRANDED_TERMINAL_FACTOR : 1)) continue;
    const near = before == null ? `${Math.round(after).toLocaleString()}km from ${s[i + 1].name}`
      : after == null ? `${Math.round(before).toLocaleString()}km from ${s[i - 1].name}`
        : `${Math.round(before).toLocaleString()}km from ${s[i - 1].name}`
          + ` and ${Math.round(after).toLocaleString()}km from ${s[i + 1].name}`;
    findings.push({
      kind: "stranded",
      collection: journey.collection,
      stop: s[i],
      journey,
      detail: `${near} — this journey's typical leg is ${Math.round(typical).toLocaleString()}km`,
      score: isolation,
    });
  }
}

/**
 * Flag a stop with no access to the sea on a journey that is otherwise afloat.
 *
 * The land mask the sea router already ships answers "could a ship reach this
 * coordinate?" for free, and a surprising share of rogue ports fail it outright:
 * Churchill's Ontario namesake, "Natal, Brazil" dropped 1,800km inland into
 * Tocantins, "Le Port, France" high in the Pyrenees.
 *
 * Used naively it is useless. A quarter of the inland stops in these feeds are
 * correct — the Amazon above Iquitos, the Rhine to Basel, the Great Lakes, the
 * Snake River, and every Norwegian fjord (the mask is 0.1 deg, too coarse to
 * resolve a fjord at all, so Flåm reads 111km from the sea).
 *
 * What separates them is the company again: a Rhine cruise is inland at every
 * stop, while a rogue is the one dry stop on a voyage that is otherwise at sea.
 * Hence the journey-level guard, and hence "no sea access at all" (the router
 * gives up past ~330km) rather than a distance threshold that fjords trip.
 */
const LANDLOCKED_MAX_SHARE = 0.25;

export function checkLandlocked(journey, findings, seaAccessKm) {
  if (!seaAccessKm) return;
  if (!["world", "yacht", "cruise"].includes(journey.collection)) return;
  const dry = journey.stops.filter((p) => !Number.isFinite(seaAccessKm(p.lat, p.lng)));
  if (!dry.length) return;
  if (dry.length > LANDLOCKED_MAX_SHARE * journey.stops.length) return;  // a river voyage
  for (const stop of dry) {
    findings.push({
      kind: "landlocked",
      collection: journey.collection,
      stop,
      journey,
      detail: "no navigable water within 330km, on a voyage whose other"
        + ` ${journey.stops.length - dry.length} stops are reachable by sea`,
      // Ranked below the geometric checks, whose km figures are the evidence a
      // human wants first; this one is a yes/no.
      score: 1,
    });
  }
}

/** Latitude/longitude that cannot be a place at all. */
export function checkHygiene(journey, findings) {
  for (const stop of journey.stops) {
    const { lat, lng } = stop;
    let problem = null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) problem = "coordinate is not a number";
    else if (Math.abs(lat) > 90) problem = `latitude ${lat} is out of range — lat/lng swapped?`;
    else if (Math.abs(lng) > 180) problem = `longitude ${lng} is out of range`;
    else if (lat === 0 && lng === 0) problem = "null island (0, 0)";
    if (problem) {
      findings.push({ kind: "hygiene", collection: journey.collection, stop, journey, detail: problem, score: Infinity });
    }
  }
}

/*
 * ── A check that was tried and removed: clustering by country ──────────────
 *
 * The obvious nominal check is to group every stop whose name ends in the same
 * country and flag any member sitting far from the rest — no gazetteer needed,
 * the cluster calibrates itself. It was implemented, measured, and deleted: it
 * produced 20 findings, ALL of them false, and caught nothing the geometric
 * checks had not already found.
 *
 * The reason is overseas territories, and this domain is made of them. Greenland
 * is filed under Denmark, French Polynesia and Réunion under France, the
 * Falklands and Anguilla under the United Kingdom, Easter Island under Chile,
 * American Samoa under the United States. Every one is thousands of kilometres
 * from its country's centre of mass and every one is correctly placed.
 *
 * The irony is precise: Bleaker Island and Steeple Jason Island are Falklands
 * stops labelled "United Kingdom" — the identical naming pattern to West Point,
 * the bug that started this — and their coordinates are right. The label was
 * never the problem, so no check on the label can find it.
 */

/**
 * Flag the same place given two different coordinates by two different feeds.
 *
 * A corpus check rather than a per-journey one, and the only one here that
 * comes with the answer attached: when the expedition feed puts "Garibaldi
 * Glacier, Chile" at 54.8S 70.0W and the world-cruise feed puts it at 49.7N
 * 123.1W — Garibaldi Provincial Park, British Columbia — one of them is right
 * and the majority is a good bet for which.
 *
 * The 500km floor is what stops it reporting the ordinary disagreement between
 * two geocoders about where a large port "is" (Rotterdam's dock vs its city
 * hall) or between a fjord's mouth and its head.
 */
const CROSS_FEED_MIN_KM = 500;

export function checkCrossFeed(journeys, findings) {
  /** name -> "lat,lng" -> { stop, collections:Set, journeys:Set } */
  const byName = new Map();
  for (const j of journeys) {
    for (const stop of j.stops) {
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) continue;
      const variants = byName.get(stop.name) || new Map();
      const key = `${stop.lat.toFixed(2)},${stop.lng.toFixed(2)}`;
      const v = variants.get(key) || { stop, collections: new Set(), journeys: new Set() };
      v.collections.add(j.collection);
      v.journeys.add(`${j.collection}:${j.id}`);
      variants.set(key, v);
      byName.set(stop.name, variants);
    }
  }
  for (const [name, variants] of byName) {
    if (variants.size < 2) continue;
    const vs = [...variants.values()].sort((a, b) => b.journeys.size - a.journeys.size);
    const [majority] = vs;
    for (const v of vs.slice(1)) {
      const apart = km(majority.stop, v.stop);
      if (apart < CROSS_FEED_MIN_KM) continue;
      findings.push({
        kind: "disagreement",
        collection: v.stop.collection ?? [...v.collections][0],
        stop: v.stop,
        // The evidence is the other feed, so any journey using this variant
        // will do as the example.
        journey: { collection: [...v.collections][0], id: name, title: name, stops: [] },
        detail: `${name} is also mapped at ${majority.stop.lat}, ${majority.stop.lng}`
          + ` (${[...majority.collections].join(", ")}, ${majority.journeys.size} journeys)`
          + ` — ${Math.round(apart).toLocaleString()}km away`,
        score: apart,
      });
    }
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Run every check over normalised journeys.
 *
 * Exported so an API ingest path can validate a live response before caching
 * it, using the same rules the shipped data is held to.
 */
export function auditJourneys(journeys, { seaAccessKm } = {}) {
  const findings = [];
  for (const journey of journeys) {
    if (!journey.stops || journey.stops.length < 2) continue;
    checkHygiene(journey, findings);
    checkDetour(journey, findings);
    checkPace(journey, findings);
    checkStranded(journey, findings);
    checkLandlocked(journey, findings, seaAccessKm);
  }
  checkCrossFeed(journeys, findings);
  return findings;
}

/**
 * The land mask, if it is on disk — 765KB and a one-second flood fill, so it
 * is loaded once and only when the landlocked check can use it. Absent (a live
 * API caller, a trimmed checkout) the other checks simply run without it.
 */
export async function loadSeaAccess() {
  if (!has("data/atlas/shared/landmask.bin")) return null;
  const { createSeaRouter } = await import("../lib/atlas/sea-router.mjs");
  const router = createSeaRouter(readFileSync(join(ROOT, "data/atlas/shared/landmask.bin")));
  return (lat, lng) => router.seaAccessKm(lat, lng);
}

// ── Sources ────────────────────────────────────────────────────────────────
//
// One adapter per feed. Each returns normalised journeys and knows nothing
// about the checks; the checks know nothing about these shapes. When a feed
// moves to an API, only its adapter changes.

/** world + yacht: PORTS is a name→[lat,lng] lookup, itineraries name ports. */
function fromPortLookup(collection, file) {
  if (!has(file)) return [];
  const d = read(file);
  const PORTS = d.PORTS || {};
  return (d.TRIPS || []).map((t) => ({
    collection,
    id: String(t.id),
    title: t.title || t.n || String(t.id),
    stops: (t.itin || []).flatMap((e) => {
      if (!e?.n) return []; // a sea day names no port
      const ll = PORTS[e.n];
      if (!Array.isArray(ll)) return [];
      return [{ name: e.n, lat: Number(ll[0]), lng: Number(ll[1]), day: e.d ?? null }];
    }),
  }));
}

/** jet + train: ROUTES carries the ordered stops with coordinates inline. */
function fromRoutes(collection, file) {
  if (!has(file)) return [];
  const d = read(file);
  const titles = new Map((d.TRIPS || []).map((t) => [String(t.id ?? t.slug ?? ""), t.n || t.title]));
  return Object.entries(d.ROUTES || {}).map(([key, pts]) => ({
    collection,
    id: key,
    title: titles.get(String(key)) || key,
    // ROUTES carries no day numbers, so only the geometric checks apply here.
    stops: (pts || []).flatMap((p) => (Array.isArray(p?.ll)
      ? [{ name: p.n, lat: Number(p.ll[0]), lng: Number(p.ll[1]), day: null }]
      : [])),
  }));
}

/** expedition cruise: day-keyed, several ports per day, coords inline. */
function fromCruiseRoutes(collection, file) {
  if (!has(file)) return [];
  const d = read(file);
  return Object.entries(d.routes || {}).map(([id, days]) => ({
    collection,
    id,
    title: id,
    stops: (days || []).flatMap((day) => (day.p || []).flatMap((p) => {
      const [name, lat, lng] = p;
      // ~14,500 entries in this feed carry null coordinates; they are absent
      // data rather than wrong data, and the build already drops them.
      if (lat == null || lng == null) return [];
      return [{ name: String(name), lat: Number(lat), lng: Number(lng), day: day.d ?? null }];
    })),
  }));
}

const SOURCES = [
  () => fromPortLookup("world", "data/atlas/world/itinerary.json"),
  () => fromPortLookup("yacht", "data/atlas/yacht/itinerary.json"),
  () => fromRoutes("jet", "data/atlas/jet/itinerary.json"),
  () => fromRoutes("train", "data/atlas/train/itinerary.json"),
  () => fromCruiseRoutes("cruise", "public/maps/cruise/data/itinerary-routes.json"),
];

// ── Report ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const strict = argv.includes("--strict");
const asJson = argv.includes("--json");
const showAll = argv.includes("--all");
const only = (argv.find((a) => a.startsWith("--collection=")) || "").split("=")[1];

let journeys = SOURCES.flatMap((load) => load());
if (only) journeys = journeys.filter((j) => j.collection === only);

const findings = auditJourneys(journeys, { seaAccessKm: await loadSeaAccess() });

/*
 * Stops a human has already looked at and found correct.
 *
 * Every one of these is a real itinerary doing something that looks wrong from
 * geometry alone — a voyage that ends with a charter flight home, an Amazon
 * tributary the mask cannot see. Without the list --strict can never be clean,
 * and a check that can never be clean is a check nobody runs.
 */
const confirmed = new Set(
  (has("data/atlas/shared/port-overrides.json")
    ? read("data/atlas/shared/port-overrides.json").confirmed || []
    : []
  ).map((c) => `${c.collection}|${c.name}`),
);

/*
 * Collapse to one row per stop. A port shared by forty itineraries produces
 * forty findings and needs one correction, so the report counts the journeys
 * and keeps the strongest piece of evidence rather than repeating itself.
 */
const byStop = new Map();
for (const f of findings) {
  if (!showAll && confirmed.has(`${f.collection}|${f.stop.name}`)) continue;
  const key = `${f.collection}|${f.stop.name}|${f.stop.lat},${f.stop.lng}`;
  const row = byStop.get(key) || {
    collection: f.collection, name: f.stop.name, lat: f.stop.lat, lng: f.stop.lng,
    kinds: new Set(), journeys: new Set(), best: f,
  };
  row.kinds.add(f.kind);
  row.journeys.add(f.journey.id);
  if (f.score > row.best.score) row.best = f;
  byStop.set(key, row);
}
const rows = [...byStop.values()].sort((a, b) => b.journeys.size - a.journeys.size);

if (asJson) {
  console.log(JSON.stringify(rows.map((r) => ({
    collection: r.collection, name: r.name, lat: r.lat, lng: r.lng,
    checks: [...r.kinds], journeys: r.journeys.size, evidence: r.best.detail,
  })), null, 2));
} else {
  const counts = {};
  for (const j of journeys) counts[j.collection] = (counts[j.collection] || 0) + 1;
  console.log("");
  console.log("port location audit");
  console.log("=".repeat(78));
  console.log(`  ${journeys.length} journeys across ${Object.keys(counts).length} collections`
    + `  (${Object.entries(counts).map(([c, n]) => `${c} ${n}`).join(", ")})`);
  console.log(`  ${rows.length} suspect stop${rows.length === 1 ? "" : "s"}`
    + ` from ${findings.length} finding${findings.length === 1 ? "" : "s"}`);
  console.log("");
  for (const r of rows) {
    console.log(`  ${r.collection.padEnd(7)} ${r.name}`);
    console.log(`          at ${r.lat}, ${r.lng}   ${r.journeys.size} journey${r.journeys.size === 1 ? "" : "s"}`
      + `   [${[...r.kinds].join(", ")}]`);
    console.log(`          ${r.best.detail}`);
    console.log(`          in "${String(r.best.journey.title).slice(0, 60)}"`);
    console.log("");
  }
  if (!rows.length) console.log("  Nothing looks out of place.\n");
}

process.exit(strict && rows.length ? 1 : 0);

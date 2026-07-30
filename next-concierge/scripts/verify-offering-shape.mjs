/**
 * D5 parity — does the normalizer print exactly what the card printed?
 *
 * The risk in D5 is not that it breaks loudly. It is that one collection's
 * field precedence gets transcribed slightly wrong and a subset of cards
 * quietly loses a date, or shows the first day of a range where it used to show
 * the range. Nothing throws; the card just says less than it did.
 *
 * So this runs lib/offering-shape.ts head-to-head against the ORIGINAL
 * ResultCards helpers (transcribed below from the pre-D5 component) across the
 * full cross product of the field combinations the four upstream vocabularies
 * actually produce — including the contradictory ones, where a source supplies
 * `dates` AND `startDate` AND `month`, or `nights` AND `days`.
 *
 *   node scripts/verify-offering-shape.mjs
 */

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".shape-build");

// Compiled through tsconfig.shape.json rather than a bare `npx tsc <file>`,
// because the normalizer now imports "@/lib/atlas/dates" and only a config file
// can carry the `paths` alias. Same pattern as verify-adapters.mjs, including
// the post-compile rewrite: tsc resolves the alias for TYPES but emits it
// verbatim, and Node cannot.
rmSync(OUT, { recursive: true, force: true });
execFileSync("npx", ["tsc", "-p", "tsconfig.shape.json"], { cwd: ROOT, stdio: "inherit" });
const emitted = join(OUT, "offering-shape.js");
writeFileSync(emitted, readFileSync(emitted, "utf8").replace(
  /from "@\/lib\/atlas\/dates"/g,
  `from ${JSON.stringify(pathToFileURL(join(ROOT, "lib/atlas/dates.js")).href)}`,
));

const { normalizeOffering } = await import(pathToFileURL(emitted).href);

// The REAL parser, so "is this a date the normalizer should have parsed?" is
// answered by the same code the normalizer asks, not a second regex.
const require = createRequire(join(ROOT, "lib/x.js"));
const { normalizeStartDate } = require("../lib/atlas/dates.js");

// ─────────────────────── ORIGINAL helpers, transcribed 1:1 ──────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function originalCardDate(result) {
  const raw = result.dates ?? result.startDate;
  if (typeof raw === "string" && raw.trim()) {
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      const [, y, m, d] = iso;
      const month = MONTHS[Number(m) - 1];
      return month ? `${Number(d)} ${month} ${y}` : raw;
    }
    return raw;
  }
  const month = result.month;
  if (typeof month === "string") {
    const m = month.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const label = MONTHS[Number(m[2]) - 1];
      return label ? `${label} ${m[1]}` : month;
    }
  }
  return null;
}

function originalCardDuration(result) {
  if (result.duration) return String(result.duration);
  const nights = result.nights;
  if (typeof nights === "number") return `${nights} nights`;
  const days = result.days;
  if (typeof days === "number") return `${days} days`;
  return null;
}

// ─────────────────────────────── input space ────────────────────────────────
// Every value each field is actually observed to take, plus the awkward ones:
// absent, empty, whitespace, unparseable, and wrong-typed.
const DATES = [undefined, null, "", "   ", "2027-03-12", "12–17 Mar 2027",
               "Departs weekly", "2027-3-12", "2027-13-45",
               // Shapes the ISO-only branch used to fall through on, printing
               // them raw: jet's US format and the voyage families' range.
               "8/14/2026", "25 Oct 2026 - 01 Nov 2026", " - "];
const START = [undefined, null, "", "2027-11-04", "not a date", "12/1/2026"];
const MONTH = [undefined, null, "", "2027-03", "2027-13", "March 2027", "2027-03-12"];
const DURATION = [undefined, null, "", "5 nights", "8 days", "2 weeks", 0, 12];
// NaN is absent on purpose: JSON cannot express it, so no upstream API can
// send it. The normalizer still guards against it (num() requires finite),
// which is a strictly safer divergence with no reachable behaviour change.
const NIGHTS = [undefined, null, 0, 1, 7, 104, "7"];
const DAYS = [undefined, null, 0, 9, 104, "9"];

let checks = 0, dateFail = 0, durFail = 0, upgraded = 0;
const examples = [];

// ── the date contract, which MOVED on purpose ───────────────────────────────
//
// The original helper is no longer the target for a parseable departure: it
// printed a lone start day (and, for jet, a raw "8/14/2026"), and the whole
// point of this change is that every dated card now carries start, end and
// year. So the parity check splits in two:
//
//   parseable start   assert the NEW contract — a year is present, and no raw
//                     upstream punctuation survives. Not compared to the
//                     original, which is known-different by design.
//   everything else   assert NOTHING CHANGED. Free text, month-only, empty and
//                     absent must still print exactly what they printed, which
//                     is where a careless "improvement" would quietly mangle a
//                     hotel's "12–17 Mar 2027" into "12 Mar".
const YEAR = /\b(19|20)\d{2}\b/;

for (const dates of DATES)
for (const startDate of START)
for (const month of MONTH) {
  const r = {};
  if (dates !== undefined) r.dates = dates;
  if (startDate !== undefined) r.startDate = startDate;
  if (month !== undefined) r.month = month;

  const got = normalizeOffering(r).whenLabel;
  checks++;

  const raw = r.dates ?? r.startDate;

  // Punctuation-only input (worldcruise's bare " - ") is the other deliberate
  // divergence: the original printed the dash, this must print no date at all
  // and fall through to whatever the month says.
  if (typeof raw === "string" && raw.trim() && !/[a-z0-9]/i.test(raw)) {
    upgraded++;
    const want = originalCardDate({ month: r.month });
    if (got !== want) {
      dateFail++;
      if (examples.length < 6) examples.push({ field: "when", input: r, want, got });
    }
    continue;
  }

  if (typeof raw === "string" && normalizeStartDate(raw)) {
    upgraded++;
    // A parsed date must print a year, and must not leak the source's own
    // formatting — a slash here means the M/D/YYYY branch was skipped.
    const ok = typeof got === "string" && YEAR.test(got) && !got.includes("/");
    if (!ok) {
      dateFail++;
      if (examples.length < 6) examples.push({ field: "when", input: r, want: "<year, no slashes>", got });
    }
    continue;
  }

  const want = originalCardDate(r);
  if (want !== got) {
    dateFail++;
    if (examples.length < 6) examples.push({ field: "when", input: r, want, got });
  }
}

for (const duration of DURATION)
for (const nights of NIGHTS)
for (const days of DAYS) {
  const r = {};
  if (duration !== undefined) r.duration = duration;
  if (nights !== undefined) r.nights = nights;
  if (days !== undefined) r.days = days;

  const want = originalCardDuration(r);
  const got = normalizeOffering(r).durationLabel;
  checks++;
  if (want !== got) {
    durFail++;
    if (examples.length < 6) examples.push({ field: "duration", input: r, want, got });
  }
}

for (const e of examples) {
  console.error(`MISMATCH (${e.field}) ${JSON.stringify(e.input)}`);
  console.error(`   original: ${JSON.stringify(e.want)}   normalized: ${JSON.stringify(e.got)}`);
}

// ──────────────────────── the shape's own guarantees ────────────────────────
const extra = [];
{
  const n = normalizeOffering({ dates: "2027-03-12" });
  extra.push(["an ISO date yields startsOn and startsIn",
    n.startsOn === "2027-03-12" && n.startsIn === "2027-03", JSON.stringify(n)]);
}
{
  // The one that would silently mangle a card: a human range must not be
  // reformatted into its first day.
  const n = normalizeOffering({ dates: "12–17 Mar 2027" });
  extra.push(["a free-text range is preserved verbatim",
    n.whenLabel === "12–17 Mar 2027" && n.startsOn === null, JSON.stringify(n.whenLabel)]);
}
{
  const n = normalizeOffering({ month: "2027-03" });
  extra.push(["a month-only source yields startsIn, not startsOn",
    n.startsIn === "2027-03" && n.startsOn === null, JSON.stringify(n)]);
}
{
  const n = normalizeOffering({ brand: null, operator: "Ponant" });
  extra.push(["supplier falls back to operator (cruise)", n.supplier === "Ponant", String(n.supplier)]);
}
{
  const n = normalizeOffering({ brand: "Belmond", operator: "ignored" });
  extra.push(["brand wins over operator", n.supplier === "Belmond", String(n.supplier)]);
}
{
  // Guards the index-signature hole that made the casts necessary.
  const n = normalizeOffering({ nights: "7", days: "9" });
  extra.push(["string-typed counts are rejected, not printed",
    n.nights === null && n.days === null && n.durationLabel === null, JSON.stringify(n.durationLabel)]);
}

// ───────────────── start, end and year, per collection shape ────────────────
// One case per upstream vocabulary, written as the real feeds emit it.
{
  // cruise: ISO start, no end anywhere, nights only.
  const n = normalizeOffering({ startDate: "2027-04-01", nights: 13 });
  extra.push(["cruise derives its end from nights",
    n.whenLabel === "1 Apr – 14 Apr 2027" && n.endsOn === "2027-04-14", JSON.stringify(n.whenLabel)]);
}
{
  // jet: US format on both ends. Used to print the raw "8/14/2026".
  const n = normalizeOffering({ startDate: "8/14/2026", endDate: "8/26/2026", days: 13 });
  extra.push(["jet's M/D/YYYY is parsed, not printed raw",
    n.whenLabel === "14 Aug – 26 Aug 2026" && n.startsOn === "2026-08-14", JSON.stringify(n.whenLabel)]);
}
{
  // jet without a stored end: fall back to days, counting the departure day.
  const n = normalizeOffering({ startDate: "8/14/2026", days: 13 });
  extra.push(["jet without an endDate derives it from days",
    n.endsOn === "2026-08-26", JSON.stringify(n.endsOn)]);
}
{
  // yacht/worldcruise: the end is inside the range string.
  const n = normalizeOffering({ startDate: "25 Oct 2026 - 01 Nov 2026" });
  extra.push(["a voyage range string yields both ends",
    n.whenLabel === "25 Oct – 1 Nov 2026" && n.endsOn === "2026-11-01", JSON.stringify(n.whenLabel)]);
}
{
  // The printed range outranks a contradictory `days` — true on 5 world cruises.
  const n = normalizeOffering({ startDate: "19 Oct 2026 - 28 Dec 2026", days: 82 });
  extra.push(["the printed range beats a contradictory days count",
    n.endsOn === "2026-12-28", JSON.stringify(n.endsOn)]);
}
{
  // The case the year exists for: a departure that returns in the next year.
  const n = normalizeOffering({ startDate: "2026-12-23", endDate: "2027-01-02" });
  extra.push(["a range across new year prints both years",
    n.whenLabel === "23 Dec 2026 – 2 Jan 2027", JSON.stringify(n.whenLabel)]);
}
{
  // ...and the case it is collapsed for.
  const n = normalizeOffering({ startDate: "2026-10-25", endDate: "2026-11-01" });
  extra.push(["a range inside one year prints it once",
    n.whenLabel === "25 Oct – 1 Nov 2026", JSON.stringify(n.whenLabel)]);
}
{
  // on-demand rail: 85 journeys that used to render a blank date line.
  const n = normalizeOffering({ startDate: null, onDemand: true, window: "Jan 2026 – Dec 2027", days: 8 });
  extra.push(["an on-demand journey shows its booking window",
    n.whenLabel === "Jan 2026 – Dec 2027 · dates on request", JSON.stringify(n.whenLabel)]);
}
{
  const n = normalizeOffering({ startDate: null, onDemand: true });
  extra.push(["on-demand with no window falls back to a label",
    n.whenLabel === "On demand", JSON.stringify(n.whenLabel)]);
}
{
  // Hotels and villas: no dates, and none invented. A property has no end.
  const n = normalizeOffering({ name: "Hotel", brand: "Aman" });
  extra.push(["a dateless property gets no range",
    n.whenLabel === null && n.startsOn === null && n.endsOn === null, JSON.stringify(n.whenLabel)]);
}
{
  // The 3 world cruises whose dates field is a bare " - ".
  const n = normalizeOffering({ startDate: " - " });
  extra.push(["an empty range string yields no date, not a broken one",
    n.whenLabel === null && n.endsOn === null, JSON.stringify(n.whenLabel)]);
}

// ────────────── the whole real inventory, not just synthetic rows ───────────
//
// The cross product above proves the RULES; this proves they cover the actual
// feeds. A collection can pass every unit case and still have one supplier
// shipping a shape nobody anticipated — which is exactly how jet spent its life
// printing "8/14/2026" while the harness reported full parity.
//
// Held to three things, per collection:
//   every dated offering prints a year
//   nothing leaks raw upstream formatting (a "/" or a " - " separator)
//   nothing dated prints a lone start day where an end was derivable
const { BACKENDS } = require("../lib/atlas/index.js");
const YEAR_RE = /\b(19|20)\d{2}\b/;
const inventory = [];
for (const key of ["cruise", "jet", "yacht", "worldcruise", "train", "hotel"]) {
  const rows = [];
  for (let offset = 0; ; offset += 24) {
    const page = BACKENDS[key].query({ limit: 24, offset });
    rows.push(...page.results);
    if (offset + 24 >= page.total) break;
  }
  let ranged = 0, windowed = 0, blank = 0, monthOnly = 0, startOnly = 0;
  const offenders = [];
  for (const row of rows) {
    const n = normalizeOffering(row);
    const label = n.whenLabel;
    if (!label) { blank++; continue; }
    if (/dates on request|^On demand$/.test(label)) { windowed++; continue; }
    if (!YEAR_RE.test(label) || label.includes("/") || label.includes(" - ")) offenders.push(label);
    // Classified from the normalized fields, not the string. A month-only
    // label ("Mar 2027") legitimately has no range — worldcruise has 3 voyages
    // whose dates field is a bare " - " and whose monthKey is all that is left
    // to print. Only a parsed START with no end is a failure.
    if (!n.startsOn) monthOnly++;
    else if (n.endsOn) ranged++;
    else startOnly++;
  }
  // Hotels are the control: 2,501 rows, every one of them correctly blank.
  const wantAllBlank = key === "hotel";
  const ok = offenders.length === 0
    && (wantAllBlank ? blank === rows.length : startOnly === 0);
  inventory.push([
    `${key}: ${rows.length.toLocaleString()} offerings`,
    ok,
    wantAllBlank
      ? `${blank} dateless, as they should be`
      : `${ranged} full ranges, ${windowed} on-demand windows, ${monthOnly} month-only, ` +
        `${blank} dateless, ${startOnly} start-only, ${offenders.length} malformed` +
        (offenders.length ? ` — e.g. ${JSON.stringify(offenders[0])}` : ""),
  ]);
}

console.log(`\n${checks.toLocaleString()} cases checked`);
console.log(`  when:     ${dateFail} failures  (${upgraded.toLocaleString()} parseable dates held to the new range contract,`);
console.log(`                         the rest to unchanged parity with the original helper)`);
console.log(`  duration: ${durFail} mismatches vs the original helper\n`);
let bad = dateFail > 0 || durFail > 0;
for (const [name, ok, detail] of extra) {
  console.log(`  ${ok ? " ok  " : "FAIL "} ${name}  (${detail})`);
  if (!ok) bad = true;
}
console.log("\n  Across the real inventory:");
for (const [name, ok, detail] of inventory) {
  console.log(`  ${ok ? " ok  " : "FAIL "} ${name}  —  ${detail}`);
  if (!ok) bad = true;
}
rmSync(OUT, { recursive: true, force: true });
console.log(bad ? "\nFAILED\n" : "\nEvery dated card shows start, end and year; dateless cards show nothing\n");
process.exit(bad ? 1 : 0);

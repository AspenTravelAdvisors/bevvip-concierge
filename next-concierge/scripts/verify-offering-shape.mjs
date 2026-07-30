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

import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = mkdtempSync(join(tmpdir(), "shape-"));

execFileSync("npx", [
  "tsc", "lib/offering-shape.ts",
  "--outDir", OUT, "--module", "esnext", "--target", "es2022",
  "--moduleResolution", "bundler", "--skipLibCheck", "--strict",
], { cwd: ROOT, stdio: "inherit" });

const { normalizeOffering } = await import(
  pathToFileURL(join(OUT, "offering-shape.js")).href
);

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
               "Departs weekly", "2027-3-12", "2027-13-45"];
const START = [undefined, null, "", "2027-11-04", "not a date"];
const MONTH = [undefined, null, "", "2027-03", "2027-13", "March 2027", "2027-03-12"];
const DURATION = [undefined, null, "", "5 nights", "8 days", "2 weeks", 0, 12];
// NaN is absent on purpose: JSON cannot express it, so no upstream API can
// send it. The normalizer still guards against it (num() requires finite),
// which is a strictly safer divergence with no reachable behaviour change.
const NIGHTS = [undefined, null, 0, 1, 7, 104, "7"];
const DAYS = [undefined, null, 0, 9, 104, "9"];

let checks = 0, dateFail = 0, durFail = 0;
const examples = [];

for (const dates of DATES)
for (const startDate of START)
for (const month of MONTH) {
  const r = {};
  if (dates !== undefined) r.dates = dates;
  if (startDate !== undefined) r.startDate = startDate;
  if (month !== undefined) r.month = month;

  const want = originalCardDate(r);
  const got = normalizeOffering(r).whenLabel;
  checks++;
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

console.log(`\n${checks.toLocaleString()} comparisons against the original card helpers`);
console.log(`  when:     ${dateFail} mismatches`);
console.log(`  duration: ${durFail} mismatches\n`);
let bad = dateFail > 0 || durFail > 0;
for (const [name, ok, detail] of extra) {
  console.log(`  ${ok ? " ok  " : "FAIL "} ${name}  (${detail})`);
  if (!ok) bad = true;
}
rmSync(OUT, { recursive: true, force: true });
console.log(bad ? "\nFAILED\n" : "\nEvery card renders exactly what it rendered before\n");
process.exit(bad ? 1 : 0);

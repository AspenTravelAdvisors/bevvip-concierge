/**
 * D4 — can a collection go missing from Explore?
 *
 * The Explore menu is now grouped, and a grouped menu has a failure mode a flat
 * one does not: a collection whose intent is unset, or set to a key no group
 * renders, simply stops appearing. Nothing throws, the menu still looks
 * complete, and an entire atlas becomes unreachable from navigation.
 *
 * So: assert every collection lands in exactly one group, and that the grouped
 * view is a permutation of the flat one.
 *
 *   node scripts/verify-intents.mjs
 */

import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = mkdtempSync(join(tmpdir(), "intents-"));

execFileSync("npx", [
  "tsc", "lib/atlas-config.ts", "lib/types.ts",
  "--outDir", OUT, "--module", "esnext", "--target", "es2022",
  "--moduleResolution", "bundler", "--skipLibCheck",
], { cwd: ROOT, stdio: "inherit" });

const { COLLECTIONS, INTENTS, collectionsByIntent } =
  await import(pathToFileURL(join(OUT, "atlas-config.js")).href);

const groups = collectionsByIntent();
const grouped = groups.flatMap((g) => g.items.map((c) => c.type));
const flat = COLLECTIONS.map((c) => c.type);

const checks = [];

checks.push([
  "every collection appears in Explore",
  grouped.length === flat.length && flat.every((t) => grouped.includes(t)),
  `${grouped.length} grouped vs ${flat.length} collections` +
    (flat.filter((t) => !grouped.includes(t)).length
      ? ` — MISSING: ${flat.filter((t) => !grouped.includes(t)).join(", ")}`
      : ""),
]);

checks.push([
  "no collection appears twice",
  new Set(grouped).size === grouped.length,
  `${new Set(grouped).size} unique of ${grouped.length}`,
]);

checks.push([
  "every intent key is one the menu renders",
  COLLECTIONS.every((c) => INTENTS.some((i) => i.key === c.intent)),
  COLLECTIONS.filter((c) => !INTENTS.some((i) => i.key === c.intent))
    .map((c) => `${c.type}=${c.intent}`).join(", ") || "all valid",
]);

checks.push([
  "no empty group is rendered",
  groups.every((g) => g.items.length > 0),
  groups.map((g) => `${g.key}:${g.items.length}`).join(" "),
]);

// The work order's own example, asserted literally.
const stay = groups.find((g) => g.key === "stay");
checks.push([
  '"Places to stay" is hotels + villas',
  !!stay && stay.items.length === 2 &&
    ["hotel", "villa"].every((t) => stay.items.some((c) => c.type === t)),
  stay ? stay.items.map((c) => c.type).join(" + ") : "group missing",
]);

// Order within a group must still follow each collection's own `order`.
checks.push([
  "groups preserve collection order",
  groups.every((g) => g.items.every((c, i) => i === 0 || g.items[i - 1].order <= c.order)),
  groups.map((g) => `${g.key}[${g.items.map((c) => c.order).join(",")}]`).join(" "),
]);

console.log("\nExplore grouping\n");
let bad = false;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? " ok  " : "FAIL "} ${name}  (${detail})`);
  if (!ok) bad = true;
}
for (const g of groups) {
  console.log(`\n  ${g.label} — ${g.blurb}`);
  for (const c of g.items) console.log(`      ${c.nav.padEnd(14)} ${c.count.toLocaleString()}`);
}
rmSync(OUT, { recursive: true, force: true });
console.log(bad ? "\nFAILED\n" : "\nEvery collection is reachable from Explore\n");
process.exit(bad ? 1 : 0);

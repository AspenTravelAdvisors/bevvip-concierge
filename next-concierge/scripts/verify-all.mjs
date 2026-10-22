#!/usr/bin/env node
// Runs every verification — and runs ALL of them, whatever fails.
//
// `npm run verify` used to be one long `&&` chain. That is the right shape for a
// build, where step two is meaningless without step one, and the wrong shape for
// a verification suite, where the checks are independent claims about different
// parts of the atlas. The cost was not theoretical: the morning the hotel merge
// gate went red over an offer that had expired overnight, the sixteen checks
// behind it silently stopped running, and a genuine route-flight regression sat
// unnoticed behind the false one. A suite that hides its own findings behind the
// first of them is worth less than no suite at all.
//
// So every check runs, its own output is printed as it goes, and the failures
// are collected and named together at the end.
//
//   node scripts/verify-all.mjs              # everything
//   node scripts/verify-all.mjs --bail       # stop at the first failure
//   node scripts/verify-all.mjs virtuoso adapters   # only these
//   node scripts/verify-all.mjs --skip=ports        # all but these
//
// --skip exists for CI, which needs to block on every check that is green
// while one known finding waits on a human decision — and it says what it
// skipped at the end, so a green run cannot pass for the whole suite.

import { spawnSync } from 'node:child_process';

// In the order they were chained, which is roughly cheapest-and-most-basic
// first: a type error makes every later report meaningless.
const CHECKS = [
  'check',
  'verify:virtuoso',
  'verify:adapters',
  'verify:deeplinks',
  'verify:hotels',
  'verify:photoreal',
  'verify:villas',
  'verify:offering-shape',
  'verify:fit-binding',
  'verify:guide-budget',
  'verify:intents',
  'verify:layer-order',
  'verify:legend-focus',
  'verify:ports',
  'verify:landmask',
  'verify:sea-routes',
  'verify:route-order',
  'verify:route-flight',
  'verify:cruise-regions',
  'verify:atlas-regions',
  'verify:safari-camps',
  'verify:gateway-hotels',
  'verify:ambient-tour',
  'verify:atlas-handoff',
  'verify:listings',
  'verify:journey-facts',
  'verify:collection-counts',
  'verify:seo',
];

const args = process.argv.slice(2);
const BAIL = args.includes('--bail');
const only = args.filter(a => !a.startsWith('--'));
const skip = args
  .filter(a => a.startsWith('--skip='))
  .flatMap(a => a.slice('--skip='.length).split(','))
  .filter(Boolean);
const selected = only.length
  ? CHECKS.filter(c => only.some(o => c.includes(o)))
  : CHECKS;
const skipped = selected.filter(c => skip.some(s => c.includes(s)));
const wanted = selected.filter(c => !skipped.includes(c));

if (!wanted.length) {
  console.error(selected.length
    ? `Every selected check was skipped: ${skipped.join(', ')}`
    : `No check matches ${only.join(', ')}. Known: ${CHECKS.join(', ')}`);
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const failed = [];
const started = Date.now();

for (const script of wanted) {
  console.log(`\n${'─'.repeat(70)}\n▸ ${script}\n${'─'.repeat(70)}`);
  const res = spawnSync(npm, ['run', '--silent', script], { stdio: 'inherit' });
  const code = res.status ?? 1;
  if (code !== 0) {
    failed.push(script);
    console.error(`\n✗ ${script} failed (exit ${code})`);
    if (BAIL) break;
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n${'═'.repeat(70)}`);
if (skipped.length) console.log(`Skipped (--skip): ${skipped.join(', ')}`);
if (!failed.length) {
  console.log(`All ${wanted.length} checks passed in ${secs}s.`);
  process.exit(0);
}
console.error(`${failed.length} of ${wanted.length} checks FAILED in ${secs}s:`);
for (const f of failed) console.error(`  ✗ ${f}`);
console.error('\nRe-run one on its own for its full output, e.g.  npm run ' + failed[0]);
process.exit(1);

#!/usr/bin/env node
// Verifies the three controls that stand between /api/guide and the Anthropic
// bill: the daily spend ceiling (lib/guide-budget.ts), the global arm of the
// rate limiter (lib/rate-limit.ts), and who is refused a model round at all
// (lib/guide-botid.ts).
//
// Both were written during the 19 September incident, in which the Guide took
// 1,767 requests in a day against a ~25/day baseline and drained the account's
// credit balance. The per-IP limiter never fired, because the traffic came from
// a proxy pool where no single IP approached 10/min. The regressions worth
// catching here are therefore specific:
//
//   - a global limit that only counts per-IP again (the original bug),
//   - a cost model that under-counts, which silently raises the real ceiling,
//   - a ceiling that fails open when the shared store is unreachable,
//   - a bot rule that refuses anything but an affirmative "bot" verdict, which
//     would turn a classifier's bad day into a lost customer.
//
// These libs are TypeScript, and the repo has no TS test runner. Rather than
// add one, this compiles them to CommonJS with the tsc that is already a
// devDependency and requires the output — CJS resolves the extensionless
// relative imports that Node's ESM loader will not.

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
// Inside the project, not /tmp: the compiled modules `require` real packages
// (lib/guide-botid.ts pulls in botid/server), and Node resolves those by
// walking up from the file — which from /tmp finds nothing. Sibling of the
// other .*-build dirs this repo already ignores.
const out = path.join(root, '.verify-build');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
function check(cond, msg) { cond ? ok(msg) : fail(msg); }
function near(actual, expected, tol, msg) {
  const good = Math.abs(actual - expected) <= tol;
  good ? ok(`${msg} (${actual})`) : fail(`${msg}: expected ~${expected}, got ${actual}`);
}

// Budget knobs must be set before the modules are required: both read env at
// module scope, which is what makes them constant for the life of a lambda.
process.env.GUIDE_DAILY_BUDGET_USD = '1';
process.env.GUIDE_RATE_MAX = '10';
process.env.GUIDE_RATE_GLOBAL_MAX = '30';
process.env.GUIDE_RATE_WINDOW_MS = '60000';
// No UPSTASH_/KV_ vars: this exercises the per-instance fallback, which is the
// path that actually runs when the store is missing or down.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const sources = ['lib/kv.ts', 'lib/guide-telemetry.ts', 'lib/guide-budget.ts', 'lib/rate-limit.ts', 'lib/guide-botid.ts'];
const tsc = spawnSync(
  'npx',
  ['tsc', ...sources, '--outDir', out, '--module', 'commonjs', '--moduleResolution', 'node',
   '--target', 'es2022', '--skipLibCheck', '--esModuleInterop'],
  { cwd: root, encoding: 'utf8' },
);
if (tsc.status !== 0) {
  console.error(tsc.stdout || tsc.stderr);
  console.error('verify:guide-budget — could not compile the modules under test');
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}
writeFileSync(path.join(out, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const require_ = createRequire(path.join(out, 'index.cjs'));
const budget = require_(path.join(out, 'guide-budget.js'));
const limit = require_(path.join(out, 'rate-limit.js'));
const botid = require_(path.join(out, 'guide-botid.js'));

console.log('\nCost model');
// The real shape of a turn, taken from the 19 September runtime logs.
const REAL_TURN = { rounds: 2, input: 1731, output: 602, cacheWrite: 0, cacheRead: 29094 };
const sonnet = budget.__test.turnCostUsd(REAL_TURN, 'claude-sonnet-4-6');
near(Number(sonnet.toFixed(4)), 0.0230, 0.0005, 'a measured turn on sonnet-4-6 costs ~$0.023');

// Cache reads must be billed at a tenth of input, not at full input: getting
// this wrong is a 10x error in the safest direction to overlook.
const allUncached = budget.__test.turnCostUsd(
  { ...REAL_TURN, input: REAL_TURN.input + REAL_TURN.cacheRead, cacheRead: 0 },
  'claude-sonnet-4-6',
);
check(allUncached > sonnet * 3, 'an uncached turn costs several times a cached one');

const unknown = budget.__test.turnCostUsd(REAL_TURN, 'some-model-shipped-next-year');
const priciest = Math.max(
  ...['claude-sonnet-4-6', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-5', 'claude-opus-4-8']
    .map((m) => budget.__test.turnCostUsd(REAL_TURN, m)),
);
near(unknown, priciest, 1e-9, 'an unknown model bills at the priciest known rate');
check(budget.__test.turnCostUsd({ rounds: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, 'claude-sonnet-4-6') === 0,
  'a turn that reached no model costs nothing');

console.log('\nDaily ceiling (per-instance fallback, no shared store)');
const before = await budget.checkDailyBudget();
check(!before.over, 'a fresh day is under the ceiling');
check(before.store === 'unconfigured', 'names the missing store so the log says which fix applies');
near(before.budgetUsd, 1, 1e-9, 'reads the ceiling from GUIDE_DAILY_BUDGET_USD');

// Spend past the $1 ceiling one real turn at a time, as production would.
let turns = 0;
for (let i = 0; i < 500; i++) {
  await budget.recordGuideSpend(REAL_TURN, 'claude-sonnet-4-6');
  turns++;
  if ((await budget.checkDailyBudget()).over) break;
}
const after = await budget.checkDailyBudget();
check(after.over, `the ceiling trips once the day's spend reaches it (after ${turns} turns)`);
near(after.spentUsd, 1, 0.05, "the recorded spend matches the ceiling it tripped at");
// ~43 turns at $0.023 to reach $1. If this drifts far, the cost model moved.
check(turns > 30 && turns < 60, `it took a plausible number of turns to get there (${turns})`);

console.log('\nRate limiter');
const req = (ip) => new Request('https://example.com/api/guide', {
  method: 'POST',
  headers: { 'x-forwarded-for': ip },
});

// Per-IP: one caller, one bucket. 10 allowed, the 11th refused.
let perIpBlockedAt = 0;
for (let i = 1; i <= 12; i++) {
  const r = await limit.isRateLimited(req('203.0.113.7'), {}, { bucket: 'test-perip' });
  if (r && !perIpBlockedAt) perIpBlockedAt = i;
}
check(perIpBlockedAt === 11, `one IP is cut off on request 11 of 10/min (got ${perIpBlockedAt})`);

// The incident shape: every request from a different IP. Without a global
// ceiling this runs forever; with one it stops at 30.
let globalBlockedAt = 0;
for (let i = 1; i <= 40; i++) {
  const r = await limit.isRateLimited(
    req(`198.51.100.${i}`), {}, { bucket: 'test-global', globalMax: 30 },
  );
  if (r && !globalBlockedAt) globalBlockedAt = i;
}
check(globalBlockedAt === 31, `40 distinct IPs are cut off on request 31 of 30/min (got ${globalBlockedAt})`);

// Same traffic, no globalMax — proves the global arm is what stops it, and that
// routes which do not opt in keep their old behavior.
let unguarded = 0;
for (let i = 1; i <= 40; i++) {
  const r = await limit.isRateLimited(req(`192.0.2.${i}`), {}, { bucket: 'test-nolimit' });
  if (r) unguarded++;
}
check(unguarded === 0, 'without globalMax, 40 distinct IPs all pass (per-IP limit alone is blind to this)');

// A caller already refused by the per-IP limit must NOT consume the global
// allowance. Without this ordering the route-wide ceiling becomes a cheap
// availability attack: one IP spamming past its own limit would trip the
// breaker and take the Guide down for every real traveler.
{
  const bucket = 'test-amplify';
  // Burn one IP far past its 10/min allowance — 200 requests, 190 of them refused.
  for (let i = 0; i < 200; i++) {
    await limit.isRateLimited(req('203.0.113.99'), {}, { bucket, globalMax: 30 });
  }
  // A different caller should still be served: only the 10 that passed the
  // per-IP gate should have reached the global counter.
  const other = await limit.isRateLimited(req('203.0.113.100'), {}, { bucket, globalMax: 30 });
  check(other === null, 'one IP spamming past its own limit does not trip the global ceiling for others');
}

// The 429 has to be actionable, not just a status.
const blocked = await limit.isRateLimited(
  req('198.51.100.1'), { 'X-Test': '1' }, { bucket: 'test-global', globalMax: 30 },
);
check(blocked?.status === 429, 'a refused request gets 429');
check(!!blocked?.headers.get('Retry-After'), 'a refused request carries Retry-After');
check(blocked?.headers.get('X-Test') === '1', 'extra headers (CORS) survive onto the 429');

console.log('\nBot classification (enforcing)');
// wouldRefuse IS the enforcement decision, so assert the real one rather than a
// restatement of it. Only an affirmative "bot" may be refused: the other three
// verdicts each represent a caller it would be wrong to turn away, and getting
// any of them wrong costs a real traveler a conversation.
check(botid.wouldRefuse({ verdict: 'bot' }) === true,
  'an automated caller is refused a model round');
check(botid.wouldRefuse({ verdict: 'human' }) === false,
  'a human is served');
check(botid.wouldRefuse({ verdict: 'unknown' }) === false,
  'a check that could not answer fails OPEN — a classifier being down never decides who gets helped');
check(botid.wouldRefuse({ verdict: 'verified' }) === false,
  'a declared agent is served, not swept up as a scraper');

rmSync(out, { recursive: true, force: true });
console.log(failures ? `\nverify:guide-budget — ${failures} failure(s)\n` : '\nverify:guide-budget — all checks passed\n');
process.exit(failures ? 1 : 0);

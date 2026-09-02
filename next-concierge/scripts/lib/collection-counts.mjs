/**
 * Read lib/atlas-counts.ts — the generated table of how many records each
 * collection ships (scripts/build-collection-counts.mjs writes it).
 *
 * By regex, because the table is TypeScript and these scripts are plain Node.
 * That is what it was before too, and it was fragile then for a reason that no
 * longer applies: it was reading a number a person had typed into a 500-line
 * registry, in a shape a refactor could change without anyone thinking about
 * this script. One generator now writes this file to one shape, and three
 * scripts read it — which is why the reading lives here once rather than three
 * times, since that is exactly how the previous version went wrong: two of the
 * copies drifted from the source and warned "no count found" instead of
 * failing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../lib/virtuoso/env.mjs';

export const COUNTS_FILE = 'lib/atlas-counts.ts';

/** `{ hotel: 2240, … }`, or an empty object if the table has not been built. */
export function generatedCounts() {
  const file = path.join(repoRoot, COUNTS_FILE);
  if (!fs.existsSync(file)) return {};
  const src = fs.readFileSync(file, 'utf8');
  return Object.fromEntries(
    [...src.matchAll(/^ {2}([a-z]+): (\d+),$/gm)].map(([, type, n]) => [type, Number(n)]),
  );
}

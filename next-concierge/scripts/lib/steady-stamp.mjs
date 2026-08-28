// A generated file's timestamp, kept steady while its contents are.
//
// Several build steps stamp their output with the moment they ran. Those files
// are committed, and the nightly Virtuoso sync re-runs every step whether or not
// the supplier moved — so the stamp alone made four files differ every night.
// That costs three things: a commit every night regardless, a real change buried
// among noise in the diff, and a "no supplier changes today" test that can never
// be true because the tree is already dirty by the time it is asked.
//
// The fix is the same one `lib/virtuoso/write-feed.mjs` applies to the feeds:
// keep two facts apart. WHEN A GENERATOR RAN is not WHEN ITS OUTPUT CHANGED, and
// only the second belongs in a file whose diff is supposed to mean something.
//
//   writeFileSync(f, JSON.stringify(steadyStamp(f, doc), null, 1));

import fs from 'node:fs';

/**
 * `doc` with `_meta[key]` set to now — or to the stamp already on disk, when
 * nothing else about the document would change.
 *
 * A missing or unreadable file is a first write and always gets a fresh stamp.
 */
export function steadyStamp(file, doc, key = 'generatedAt') {
  const now = new Date().toISOString();

  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { previous = null; }

  /** Everything except the stamp, so two runs can be compared. */
  const payload = d => {
    const { _meta = {}, ...rest } = d ?? {};
    const { [key]: _ignored, ...meta } = _meta;
    return JSON.stringify({ _meta: meta, ...rest });
  };

  const unchanged = previous && payload(previous) === payload(doc);
  const stamp = (unchanged && previous._meta?.[key]) || now;
  return { ...doc, _meta: { ...(doc._meta ?? {}), [key]: stamp } };
}

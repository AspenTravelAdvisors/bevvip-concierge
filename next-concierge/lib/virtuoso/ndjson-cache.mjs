// The resumable detail cache every Virtuoso sync crawls behind.
//
// A detail crawl is thousands of sequential calls at ~800ms each — single-use
// bearer tokens forbid parallelism — so each record is appended to an NDJSON
// file as it arrives and the next run skips whatever is already there. An
// interrupted crawl resumes instead of starting over, which is the difference
// between a nightly job that finishes and one that never does.
//
// One copy, because there were four and they were byte-identical: the streaming
// reader below was fixed once and copy-pasted three times, which is how the
// next fix lands in three files and not the fourth.

import fs from 'node:fs';

/**
 * Every cached record, keyed by id.
 *
 * Streamed, not slurped. The cruise cache reached 1.35GB and
 * `readFileSync(..., 'utf8')` threw ERR_STRING_TOO_LONG at Node's 512MB string
 * ceiling — the crawl had completed and the sync could not read its own cache
 * back. Torn lines (a run killed mid-write) are skipped rather than fatal.
 */
export function readNdjsonCache(file, { force = false } = {}) {
  const entries = new Map();
  if (!fs.existsSync(file) || force) return entries;

  const take = line => {
    if (!line.trim()) return;
    try {
      const rec = JSON.parse(line);
      if (rec?.id) entries.set(String(rec.id), rec);
    } catch { /* torn line — the crawl will refetch it */ }
  };

  let carry = '';
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  try {
    let read;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      carry += buf.toString('utf8', 0, read);
      let nl;
      while ((nl = carry.indexOf('\n')) >= 0) {
        take(carry.slice(0, nl));
        carry = carry.slice(nl + 1);
      }
    }
    take(carry);
  } finally { fs.closeSync(fd); }
  return entries;
}

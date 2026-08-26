// Writes a synced feed without churning the git history.
//
// Every sync stamps the time it ran, and if that stamp lives in the feed then
// the feed differs every night whether or not a single supplier changed
// anything. The nightly job would commit daily, "No supplier changes today"
// could never fire, and a real change — a line dropping forty sailings — would
// be one diff among five noisy ones.
//
// So the two facts are separated. The feed keeps `lastChanged`, which moves only
// when the content moves, and the run time goes in a small shared status file
// that is expected to change nightly. Freshness is judged on `lastChecked` from
// that file, so a quiet week still reads as healthy rather than stale.

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './env.mjs';

const STATUS_FILE = path.join(repoRoot, 'data/atlas/shared/virtuoso-sync-status.json');

/** Everything except the volatile stamps, so two runs can be compared. */
function payloadOf(doc) {
  const { _meta, ...rest } = doc;
  const { lastChanged, lastSynced, generatedAt, ...meta } = _meta ?? {};
  return JSON.stringify({ _meta: meta, ...rest });
}

/**
 * Write `doc` to `relPath`, preserving the previous `lastChanged` when nothing
 * but the timestamp would differ. Returns whether the content actually moved.
 */
export function writeFeed(relPath, doc, { label } = {}) {
  const full = path.join(repoRoot, relPath);
  const now = new Date().toISOString();

  let previous = null;
  if (fs.existsSync(full)) {
    try { previous = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { previous = null; }
  }

  const changed = !previous || payloadOf(previous) !== payloadOf(doc);
  const lastChanged = changed ? now : (previous?._meta?.lastChanged ?? now);

  const out = { ...doc, _meta: { ...(doc._meta ?? {}), lastChanged } };
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(out, null, 1));

  recordCheck(label ?? path.basename(relPath, '.json'), {
    lastChecked: now,
    lastChanged,
    count: doc._meta?.count ?? null,
  });

  return changed;
}

/** The always-updated heartbeat, kept apart from the data it describes. */
function recordCheck(label, entry) {
  let status = { _meta: { purpose: 'When each Virtuoso feed was last checked, and when it last actually changed.' }, feeds: {} };
  if (fs.existsSync(STATUS_FILE)) {
    try { status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch { /* rewrite it */ }
  }
  status.feeds = { ...(status.feeds ?? {}), [label]: entry };
  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 1));
}

export { STATUS_FILE };

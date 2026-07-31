"use client";

/**
 * The panel every error boundary in the app renders, and the one place that
 * decides whether an error is worth showing a human at all.
 *
 * ── The class of failure this is really about ──────────────────────────────
 *
 * "Application error: a client-side exception has occurred" is Next's last
 * resort, shown when nothing else caught the error. The reported symptom —
 * intermittent, always fixed by a refresh, no pattern to which page — is the
 * signature of a CHUNK LOAD FAILURE, not of a bug in the page: the browser is
 * holding HTML from build A and asking for a JavaScript chunk that only exists
 * in build A, while the CDN is now serving build B. Every redeploy opens that
 * window for anyone with the site already open, and a reload closes it, because
 * the reload fetches the new HTML with the new chunk names.
 *
 * Which is why "resolved on a refresh" was the most useful part of the report:
 * an error that a refresh reliably fixes is an error the app can fix itself.
 * So a chunk failure reloads once, silently, and the visitor sees a flicker
 * instead of a dead end.
 *
 * ONCE. The reload is recorded in sessionStorage first, so a genuinely broken
 * deploy shows the panel on the second attempt rather than reloading forever —
 * an infinite refresh loop is a far worse failure than the one being fixed.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";

const RELOAD_FLAG = "bevvip:chunk-reload";

/**
 * Does this error mean "the JavaScript didn't arrive"?
 *
 * Matched on message text because the error crosses a bundler boundary and
 * arrives as a plain Error in production — webpack's ChunkLoadError class is
 * not importable here, and Next strips the stack.
 */
export function isChunkError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`.toLowerCase();
  return (
    text.includes("chunkloaderror") ||
    text.includes("loading chunk") ||
    text.includes("loading css chunk") ||
    text.includes("failed to fetch dynamically imported module") ||
    text.includes("importing a module script failed")
  );
}

export default function AppError({
  error,
  reset,
  title = "Something didn't load",
  body = "This is almost always temporary.",
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  title?: string;
  body?: string;
}) {
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    // Surface the real error. Next's production overlay shows only the digest,
    // which is what made this impossible to diagnose from a screenshot.
    console.error("[bevvip] app error", error?.name, error?.message, error?.digest, error);

    let reloaded = false;
    try {
      reloaded = sessionStorage.getItem(RELOAD_FLAG) === "1";
    } catch { /* private mode — treat as not yet reloaded */ }

    if (isChunkError(error) && !reloaded) {
      try { sessionStorage.setItem(RELOAD_FLAG, "1"); } catch { /* best effort */ }
      window.location.reload();
      return;
    }

    // Not a stale-build problem: re-render the subtree once before giving up.
    // A React render that failed on a transient condition (a feed that arrived
    // half-written, a layout measured mid-resize) usually succeeds on the
    // second attempt, and the visitor never sees this panel.
    if (reset && !isChunkError(error)) {
      const t = setTimeout(reset, 400);
      return () => clearTimeout(t);
    }
  }, [error, reset]);

  // A clean load clears the flag, so the next stale deploy gets its own retry.
  useEffect(() => {
    const t = setTimeout(() => {
      try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* noop */ }
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="atlas-error" role="alert">
      <h2>{title}</h2>
      <p>{body} Reloading usually clears it.</p>
      <div className="atlas-error-actions">
        <button type="button" onClick={() => (reset ? reset() : window.location.reload())}>
          Try again
        </button>
        <Link href="/">Ask The Guide instead →</Link>
      </div>
      {error?.digest && <p className="atlas-error-digest">Reference: {error.digest}</p>}
    </div>
  );
}

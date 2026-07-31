"use client";

/**
 * The villa atlas's error boundary.
 *
 * Villas is the only server-rendered atlas, and the only route that parses a
 * 7MB dataset on a cold start (lib/villas.js requires it at module scope). When
 * that invocation is slow or is evicted mid-render, Next replaces the page with
 * its generic error screen — which is exactly the "loading error that goes away
 * on refresh" this route was showing, because a refresh lands on a warm
 * instance and the same request succeeds.
 *
 * So: retry once, automatically, before showing the traveller anything. A
 * transient cold start should cost a second, not a dead end. If the retry also
 * fails we stop and say so plainly, with the manual retry and a route out —
 * silently retrying forever would just hide a real outage.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";

export default function VillaAtlasError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const retried = useRef(false);

  useEffect(() => {
    if (retried.current) return;
    retried.current = true;
    // A tick of delay: retrying inside the same frame that failed tends to hit
    // the same cold instance.
    const t = setTimeout(() => reset(), 400);
    return () => clearTimeout(t);
  }, [reset]);

  return (
    <div className="atlas-error" role="alert">
      <h2>The villa atlas didn&rsquo;t load</h2>
      <p>
        This is almost always temporary. We&rsquo;re trying again — if nothing happens,
        reload the page.
      </p>
      <div className="atlas-error-actions">
        <button type="button" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/">Ask The Guide instead →</Link>
      </div>
      {error.digest && <p className="atlas-error-digest">Reference: {error.digest}</p>}
    </div>
  );
}

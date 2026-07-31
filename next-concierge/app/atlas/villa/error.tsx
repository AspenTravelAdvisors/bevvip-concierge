"use client";

/**
 * The villa atlas's error boundary.
 *
 * Villas is the only server-rendered atlas and the heaviest client route, so it
 * is the one where a stale-build chunk failure surfaces first — but the recovery
 * is not villa-specific, and lives in AppError.
 */

import AppError from "@/components/AppError";

export default function VillaAtlasError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppError
      error={error}
      reset={reset}
      title="The villa atlas didn't load"
      body="This is almost always temporary — the map and the 3,902 villas are fine."
    />
  );
}

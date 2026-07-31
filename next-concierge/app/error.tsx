"use client";

/**
 * App-wide error boundary.
 *
 * Without one of these, ANY client-side exception anywhere in the app falls
 * through to Next's bare "Application error: a client-side exception has
 * occurred" screen — no retry, no explanation, and no way for the person who
 * hit it to tell us anything except that it happened. This catches everything
 * below the root layout; global-error.tsx catches the layout itself.
 */

import AppError from "@/components/AppError";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppError error={error} reset={reset} />;
}

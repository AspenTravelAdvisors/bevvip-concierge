"use client";

/**
 * The last boundary: errors thrown by the root layout itself, which app/error.tsx
 * sits inside and therefore cannot catch.
 *
 * This is the exact case that produces the bare "Application error: a
 * client-side exception has occurred" page, because at this depth Next has no
 * chrome left to render into — which is why this file must supply its own
 * <html> and <body>, and why it deliberately depends on nothing but AppError:
 * anything it imports is something that can break it in turn.
 *
 * Styles are inline for the same reason. If the failure was the stylesheet
 * chunk, a class name buys nothing.
 */

import AppError from "@/components/AppError";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0d12",
          color: "#efe9dd",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial",
        }}
      >
        <AppError error={error} reset={reset} />
      </body>
    </html>
  );
}

"use client";

// The "The Guide" nav tab. It points at home (where The Guide lives), and
// doubles as the way to replay the intro tour: when you're already on The Guide
// it skips the no-op reload and instead asks IntroTour (mounted app-wide) to
// open, by dispatching the same event the tour listens for. This keeps the
// header uncluttered — no separate tour button is needed, which matters most on
// the tight mobile header.

import Link from "next/link";

export default function GuideTab() {
  return (
    <Link
      className="tab-guide"
      href="/"
      title="The Guide — click to replay the tour"
      onClick={(e) => {
        // Already on The Guide: don't reload, just run the tour. Elsewhere, let
        // the link navigate home as usual.
        if (window.location.pathname === "/") {
          e.preventDefault();
          window.dispatchEvent(new Event("bevvip:start-tour"));
        }
      }}
    >
      The Guide
    </Link>
  );
}

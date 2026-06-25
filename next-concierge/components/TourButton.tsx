"use client";

// The header affordance that re-opens the intro tour. Lives next to the Aspen
// Travel Advisors byline and simply asks IntroTour (mounted app-wide) to open by
// dispatching the same event the tour listens for, so the two stay decoupled.

export default function TourButton() {
  return (
    <button
      type="button"
      className="tour-launch"
      title="Take a tour of Base Camp"
      aria-label="Take a tour of Base Camp"
      onClick={() => window.dispatchEvent(new Event("bevvip:start-tour"))}
    >
      <span aria-hidden="true">✦</span> Tour
    </button>
  );
}

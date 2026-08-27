"use client";

// SiteNav — the header's right side.
//
// This replaces a row of eight tabs (The Guide · Jets · Yachts · Hotels ·
// Villas · Expeditions · World Cruises · Rails) that scrolled sideways whenever
// it didn't fit, which on a phone meant part of the product was simply
// invisible. Worse, it asked the visitor to translate their intent ("somewhere
// warm in February") into our vessel taxonomy before they could click anything
// — the exact translation The Guide exists to do for them.
//
// So: the seven collections collapse into one Explore menu, ordered by how
// often travelers ask for them (lib/atlas-config COLLECTIONS, the single
// canonical list). That frees the one header slot that matters — a persistent
// route to a human, which the app previously did not have anywhere.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { COLLECTIONS, collectionPhrase, collectionsByIntent } from "@/lib/atlas-config";
import { openAdvisor, ADVISOR_CTA_COLD } from "./AdvisorRequest";
import { tourOpened } from "@/lib/analytics";
import { useBucketCount } from "@/lib/bucket-list";

export default function SiteNav() {
  const pathname = usePathname();
  const saved = useBucketCount();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const activeType = pathname?.startsWith("/atlas/") ? pathname.split("/")[2] : null;
  const active = COLLECTIONS.find((c) => c.type === activeType) ?? null;

  // Close on outside click / Esc — a menu that traps you is worse than a tab row.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Navigating closes the menu.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <nav className="site-nav">
      <Link className="nav-link" href="/" data-active={pathname === "/" ? "true" : undefined}>
        The Guide
      </Link>

      <div className="nav-explore" ref={wrapRef}>
        <button
          type="button"
          className="nav-link"
          aria-haspopup="menu"
          aria-expanded={open}
          data-active={active ? "true" : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          {active ? active.nav : "Explore"}
          <span className="nav-caret" aria-hidden="true">
            ▾
          </span>
        </button>

        {open && (
          <div className="nav-menu" role="menu">
            <div className="nav-menu-cap">Browse the collection on a map</div>
            {/*
              Grouped by INTENT, not by inventory type (D4). A flat list of
              seven asked the visitor to know our taxonomy before they could
              look at anything — and "Hotels" vs "Villas" is a distinction in
              how the inventory is filed, not in what the traveller wants.
              Groups come from collectionsByIntent(), which derives from
              COLLECTIONS, so a new collection cannot go missing from here.
            */}
            {collectionsByIntent().map((group) => (
              <div key={group.key} className="nav-menu-group">
                <div className="nav-menu-group-head">
                  <span className="nav-menu-group-label">{group.label}</span>
                </div>
                {group.items.map((c) => (
                  <div key={c.type} className="nav-menu-entry">
                    <Link
                      role="menuitem"
                      className="nav-menu-item"
                      href={`/atlas/${c.type}`}
                      data-active={c.type === activeType ? "true" : undefined}
                    >
                      <i className="nav-dot" style={{ background: c.color }} aria-hidden="true" />
                      <span className="nav-menu-label">{c.nav}</span>
                      <span className="nav-menu-count">{collectionPhrase(c).split(" ")[0]}</span>
                    </Link>
                    {/*
                      A collection's second view, where it has one (hotels: the
                      Google Photorealistic 3D engine). It hangs off its
                      collection rather than sitting in the list as a peer,
                      because it is not another thing to browse — it is another
                      way to look at the same 2,475 hotels.
                    */}
                    {(c.views ?? []).map((v) => (
                      <Link
                        key={v.key}
                        role="menuitem"
                        className="nav-menu-view"
                        href={`/atlas/${c.type}?${v.query}`}
                      >
                        <span className="nav-menu-view-label">{v.label}</span>
                        <span className="nav-menu-view-blurb">{v.blurb}</span>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            ))}
            <div className="nav-menu-foot">
              {/* Counted, not spelled out: the copy used to say "all seven"
                  while the list beside it was generated. */}
              Not sure which? <Link href="/">Just describe the trip</Link> — The Guide searches
              all {COLLECTIONS.length}.
            </div>
          </div>
        )}
      </div>

      <Link
        className="nav-link"
        href="/answers"
        data-active={pathname?.startsWith("/answers") ? "true" : undefined}
      >
        Answers
      </Link>

      {/*
        The list, with its count.

        Only once there is something in it. An empty "Bucket List (0)" in the
        header is a permanent reminder of a thing you haven't done, and on a
        first visit it names a feature the visitor has no reason to want yet —
        the ♡ on the cards is where the feature introduces itself. Once
        something is saved the count is the point: it is the only place in the
        app that says the list is still there, days later, in another tab.
      */}
      {saved > 0 && (
        <Link
          className="nav-link nav-saved"
          href="/bucket-list"
          data-active={pathname?.startsWith("/bucket-list") ? "true" : undefined}
        >
          <span className="nav-saved-glyph" aria-hidden="true">♥</span>
          Bucket List
          <span className="nav-saved-count">{saved}</span>
        </Link>
      )}

      {/* The tour used to hijack the "The Guide" tab: on the home page that tab
          swallowed the click and opened a modal instead of navigating. Same
          control, two behaviors, no signal. It gets its own link now. */}
      <button
        type="button"
        className="nav-link nav-how"
        onClick={() => {
          tourOpened();
          window.dispatchEvent(new Event("bevvip:start-tour"));
        }}
      >
        How this works
      </button>

      <button
        type="button"
        className="nav-cta"
        onClick={() => openAdvisor({ source: "header" })}
      >
        {ADVISOR_CTA_COLD}
      </button>
    </nav>
  );
}

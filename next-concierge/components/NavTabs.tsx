"use client";

// The header collection tabs. All eight live in a single row that scrolls
// sideways whenever it can't fit — landscape phones, tablets, half-width
// windows — instead of clipping the tail of the row off the screen. A soft
// fade is shown only on the side that actually has hidden tabs, so the
// half-visible pill under it reads as "more this way" and stays a deliberate
// tease rather than a bug. On atlas pages the current collection's tab is
// highlighted and scrolled into view on arrival.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import GuideTab from "./GuideTab";

// The atlas tabs carry their map-legend color as text + accent underline.
const ATLAS_TABS = [
  { href: "/atlas/hotel", label: "Hotels", color: "#e6d488" },
  { href: "/atlas/cruise", label: "Expeditions", color: "#5aa9e6" },
  { href: "/atlas/jet", label: "Jets", color: "#dfe5f2" },
  { href: "/atlas/yacht", label: "Yachts", color: "#e0b84a" },
  { href: "/atlas/worldcruise", label: "World", color: "#45d6c2" },
  { href: "/atlas/train", label: "Rails", color: "#e08d5f" },
  { href: "/atlas/villa", label: "Villas", color: "#a8d08d" },
];

export default function NavTabs() {
  const pathname = usePathname();
  const wrapRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // Keep the edge fades in sync with which side has tabs hidden past it.
  useEffect(() => {
    const wrap = wrapRef.current;
    const nav = navRef.current;
    if (!wrap || !nav) return;
    const update = () => {
      const max = nav.scrollWidth - nav.clientWidth;
      wrap.dataset.fadeLeft = String(nav.scrollLeft > 6);
      wrap.dataset.fadeRight = String(nav.scrollLeft < max - 6);
    };
    update();
    nav.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(nav);
    return () => {
      nav.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  // Landing on an atlas page whose tab starts offscreen: center it in the row.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>('a[data-active="true"]');
    if (!active) return;
    nav.scrollLeft = Math.max(
      0,
      active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2
    );
  }, [pathname]);

  return (
    <div className="nav-wrap" ref={wrapRef}>
      <nav ref={navRef}>
        <GuideTab />
        {ATLAS_TABS.map(({ href, label, color }) => (
          <Link
            key={href}
            className="tab-color"
            style={{ "--tab": color } as React.CSSProperties}
            href={href}
            data-active={pathname === href ? "true" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

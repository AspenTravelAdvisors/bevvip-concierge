"use client";

/**
 * Brand mark, ported from the Leaflet atlases' `logoEl()`.
 *
 * The fallback chain is the feature — most of these suppliers have no logo
 * asset in the repo, so the atlas walks three sources before giving up:
 *
 *   1. logos/<domain>.png        bundled asset (rail ships exactly one)
 *   2. Google favicon service    covers most real travel brands
 *   3. DuckDuckGo icon service   catches what Google misses
 *   4. coloured initials         the brand's own colour + 2-letter glyph
 *
 * The original also treats a successfully-loaded but tiny image as a failure
 * (`naturalWidth < 8`), because both icon services return a 1px placeholder
 * rather than a 404 for unknown domains. Without that check the card shows a
 * blank square and looks broken, which is worse than initials.
 */

import { useEffect, useState } from "react";

export interface BrandMark {
  key: string;
  short?: string | null;
  domain?: string | null;
  color?: string | null;
  glyph?: string | null;
}

function initials(m: BrandMark): string {
  if (m.glyph) return m.glyph;
  const letters = (m.short || m.key || "?").match(/[A-Za-z]/g) || ["?"];
  return letters.slice(0, 2).join("").toUpperCase();
}

/** Asset path first, then the two icon services. */
function sourcesFor(m: BrandMark, assetBase: string): string[] {
  if (!m.domain) return [];
  return [
    // Only where a collection actually ships logo assets. Hotels pass an empty
    // base, which used to build "/aman.com.png" — a guaranteed 404 on the app's
    // own origin, once per distinct mark, before every card fell through to the
    // icon service it was always going to use.
    ...(assetBase ? [`${assetBase}/${m.domain}.png`] : []),
    `https://www.google.com/s2/favicons?sz=128&domain=${m.domain}`,
    `https://icons.duckduckgo.com/ip3/${m.domain}.ico`,
  ];
}

export default function BrandLogo({
  brand,
  assetBase,
  size = 34,
}: {
  brand: BrandMark;
  /** e.g. "/maps/train/logos" */
  assetBase: string;
  size?: number;
}) {
  const sources = sourcesFor(brand, assetBase);
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [brand.key, assetBase]);

  const exhausted = idx >= sources.length;
  if (exhausted) {
    return (
      <span
        className="brandlogo brandlogo--glyph"
        style={{ background: brand.color || "#26506e", width: size, height: size }}
        aria-label={brand.short || brand.key}
      >
        {initials(brand)}
      </span>
    );
  }

  return (
    <span className="brandlogo" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sources[idx]}
        alt={brand.short || brand.key}
        loading="lazy"
        onError={() => setIdx((i) => i + 1)}
        onLoad={(e) => {
          // Both icon services answer unknown domains with a 1px placeholder
          // instead of a 404, so a "successful" tiny image is a miss.
          if (e.currentTarget.naturalWidth < 8) setIdx((i) => i + 1);
        }}
      />
    </span>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

/*
 * A card's photograph, or the empty panel when there is none to show.
 *
 * Supplier photo URLs die: Virtuoso deletes a property's old photographs when
 * it replaces them, and a feed can carry the old URL until the next refresh
 * (scripts/sync-virtuoso-hotels.mjs). The card used to draw the browser's
 * broken-image icon on a black square for those. Now a photo that fails to
 * load is swapped for the same empty panel a record with no photograph gets.
 *
 * There is no retry against the full-size original: when the resized variant
 * is gone the original is too (784 of 784 checked), so a retry is only a
 * second 404 per card.
 */
export default function CardPhoto({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);

  // Cards are recycled as filters change; a new record gets a fresh attempt.
  useEffect(() => setFailed(false), [src]);

  // An image can fail before React attaches onError (server-rendered markup
  // loading ahead of hydration), and that error event is never replayed. A
  // finished image with no pixels has failed, whenever it happened.
  const check = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (!src || failed) return <span className="ac-media-empty" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={check} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  );
}

"use client";

import { useEffect, useState } from "react";

/*
 * A card's photograph, with a way down when the picture will not load.
 *
 * The merge scripts point cards at Virtuoso's resized variant
 * (`/Brochures/h400/<id>.webp`, lib/virtuoso/media.mjs) because the originals
 * are megabytes each. But media.virtuoso.com does not answer that request for
 * every image — for many it fails, and the card drew the browser's
 * broken-image icon on a black square. When the sized variant fails we fall
 * back to the original brochure .jpg (every original in the feeds is a .jpg),
 * and when that fails too the card shows the same empty panel it shows for a
 * record with no photograph at all, never a broken image.
 */
const SIZED = /^(https:\/\/media\.virtuoso\.com\/m\/Images\/Brochures\/)h\d+\/([^/?#]+)\.webp$/i;

/** The full-size original behind a resized Virtuoso URL, or null if it is not one. */
function originalOf(url: string): string | null {
  const m = SIZED.exec(url);
  return m ? `${m[1]}${m[2]}.jpg` : null;
}

export default function CardPhoto({ src }: { src: string | null }) {
  const [current, setCurrent] = useState<string | null>(src);

  // Cards are recycled as filters change; a new record starts from its own src.
  useEffect(() => setCurrent(src), [src]);

  if (!current) return <span className="ac-media-empty" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current}
      alt=""
      loading="lazy"
      onError={() => setCurrent((u) => (u ? originalOf(u) : null))}
    />
  );
}

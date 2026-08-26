// Card-sized variants of Virtuoso's media URLs.
//
// `defaultImageUrl` is the supplier's full-resolution brochure image: one yacht
// photograph measured 3840x2880 and 1.4MB, for a card that renders it at
// 280x187. A hundred and twenty of those on one atlas page is well over a
// hundred megabytes of pictures nobody asked for.
//
// media.virtuoso.com will resize on request — inserting a `h<pixels>/` segment
// and asking for .webp returns the same image at that height. The same yacht
// photograph comes back as 17KB, and a heavy hotel image drops from 816KB to
// 54KB. The rail atlas was already using this convention (`/Brochures/h200/…`),
// which is where the trick came from.
//
// Only the CARD thumbnail is shrunk. Dossier galleries keep the full-resolution
// originals, because there the detail is the point.

/** Height in pixels for a card thumbnail: 400 covers a 187px card on a retina screen. */
const CARD_HEIGHT = 400;

const BROCHURE = /^(https:\/\/media\.virtuoso\.com\/m\/Images\/Brochures\/)(?!h\d+\/)([^/?#]+)\.(jpg|jpeg|png|webp)$/i;

/**
 * A card-sized version of a Virtuoso media URL.
 *
 * Anything that is not a plain brochure image — an already-sized URL, another
 * host, a video — comes back untouched rather than being rewritten into a 404.
 */
export function cardImage(url, height = CARD_HEIGHT) {
  if (typeof url !== 'string' || !url) return url ?? null;
  const m = BROCHURE.exec(url);
  if (!m) return url;
  return `${m[1]}h${height}/${m[2]}.webp`;
}

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

/*
 * The key a journey's harvested photograph is filed under.
 *
 * Route AND title, because neither alone is right. The five National Geographic
 * "Around the World by Private Jet" departures are five cards of one journey
 * sharing one route slug — they should share one photograph, and keying on the
 * per-departure id would send this script off to fetch the same page five times
 * to get five copies of the same answer. But route alone collapses the Safrans
 * pairs that deliberately share an anchor: `#sdm-japan` is both the spring
 * journey and the autumn one, and they are photographed in different seasons.
 *
 * The title separates those two and the route holds the departures together.
 * Both halves come from the atlas record, so the harvester and the merge derive
 * the same key without either having to be told it.
 */
export function journeyPhotoKey(trip) {
  const route = String(trip?.route ?? trip?.id ?? '');
  const title = String(trip?.n ?? trip?.name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${route}::${title}`;
}

/*
 * Not every "photo" the supplier sends is a photograph.
 *
 * The API reference files `supplierVideos[]` under the hotel record's Photos
 * block alongside `defaultImageUrl` and `imageLibraryItems[]`, and 1,157 of the
 * 2,073 properties carry one — a minute of the property filming itself, which
 * is the most persuasive thing in the media library and the one piece of it
 * nothing downstream has ever seen. ICE Portal serves them as plain .mp4 off
 * media.virtuoso.com.
 *
 * Two rules, and the reason for each:
 *
 *   A video URL must never reach an <img>. The image library is stills today,
 *   but nothing in the contract says it stays that way, and one .mp4 in that
 *   array renders as a broken card. So the sync partitions the library by what
 *   the URL actually is rather than by which field it arrived in.
 *
 *   A URL that is not a video FILE must never reach a <video>. A supplier
 *   pointing at a YouTube page or a player embed is a link, not a source, and
 *   <video src="…/watch?v=…"> is a black rectangle with a broken play button.
 *   Those are dropped: showing nothing is honest, showing a dead player is not.
 */

/** Containers a browser plays natively in <video>, with no player and no plugin. */
const PLAYABLE_VIDEO = /\.(mp4|m4v|webm|ogv)(?:[?#]|$)/i;

/**
 * `url` when it is a video file a browser can play, else null.
 *
 * Deliberately strict about the scheme too: these end up as a `src` on a page
 * served over https, where an http source is blocked as mixed content anyway.
 */
export function playableVideo(url) {
  const u = typeof url === 'string' ? url.trim() : '';
  if (!u.startsWith('https://')) return null;
  return PLAYABLE_VIDEO.test(u) ? u : null;
}

/**
 * The playable films on one normalized hotel record from the supplier feed.
 *
 * Reads `videos`, which is what the sync writes now, and falls back to the
 * singular `video` the feed carried before it. The fallback is not ceremony:
 * a full detail crawl is half an hour of single-use tokens, so without it the
 * films already sitting in the committed feed would stay invisible until the
 * next nightly sync happened to run.
 */
export function feedVideos(v) {
  const raw = Array.isArray(v?.videos) ? v.videos : v?.video ? [v.video] : [];
  const urls = raw.map(x => playableVideo(typeof x === 'string' ? x : x?.url)).filter(Boolean);
  return [...new Set(urls)];
}

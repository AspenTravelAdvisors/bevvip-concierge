/**
 * The camps a safari journey passes, and where they live in the hotel atlas.
 *
 * This is the read side of scripts/build-safari-camps.mjs — see that file for
 * why the join is by coordinate rather than by name, and why it ships as its
 * own small file instead of as a field on the itinerary.
 *
 * The claim this data makes, and the claim the UI is allowed to make from it,
 * are not the same claim, so it is worth writing down once here.
 *
 *   The DATA says: this property, which we sell and hold perks on, is within
 *   25km of a stop on this journey.
 *
 *   The UI may therefore say: "our camps along this route".
 *
 *   The UI may NOT say: "you will sleep here". Four of our Sabi Sand lodges
 *   sit within 25km of the single itinerary stop "Sabi Sand Game Reserve", and
 *   the tour feed does not name which one the operator has booked. Presenting
 *   one of the four as the traveller's bed would be inventing an itinerary
 *   detail, which is the one thing a concierge atlas cannot do.
 */

export interface SafariCamp {
  /** Hotel atlas id — `h_01778`. The deep link is built from this. */
  id: string;
  name: string;
  /** The house — Singita, Belmond, One&Only — where the feed names one. */
  house: string | null;
  country: string | null;
  /** `[lat, lng]`, the feed's convention. Convert before handing to a map. */
  ll: [number, number];
  thumb: string | null;
  rooms: number | null;
  /** At most three short VIP benefit tags, as the hotel card shows them. */
  perks: string[];
  hasPromotion: boolean;
  /** The itinerary stop this camp was matched to. */
  stop: string | null;
  /** Itinerary day of that stop, where the feed numbers it. */
  day: number | null;
  /** Distance from the stop, kilometres, one decimal. */
  km: number;
}

/** What `public/maps/safari/camps.json` holds, as shipped. */
interface RawCampsFile {
  radiusKm?: number;
  totals?: { category?: number; inSafariCountries?: number };
  CAMPS?: Record<
    string,
    {
      n?: string;
      house?: string | null;
      country?: string | null;
      ll?: [number, number];
      thumb?: string | null;
      rooms?: number | null;
      perks?: string[];
      promo?: number;
    }
  >;
  BYTRIP?: Record<string, { id: string; stop?: string | null; day?: number | null; km?: number }[]>;
}

export interface SafariCampIndex {
  /** Camps on one journey, in itinerary order. Empty array for a journey with none. */
  forTrip: (tripId: string) => SafariCamp[];
  /** How near a camp had to be to count, so the UI can say so. */
  radiusKm: number;
  /** Every `Lodge / Safari` property in the hotel atlas, worldwide. */
  lodgesInCategory: number;
  /** The subset in countries this collection's journeys actually visit. */
  lodgesInSafariCountries: number;
}

const EMPTY: SafariCamp[] = [];

/** An index that knows nothing — what the atlas uses when the file is absent. */
export const NO_CAMPS: SafariCampIndex = {
  forTrip: () => EMPTY,
  radiusKm: 0,
  lodgesInCategory: 0,
  lodgesInSafariCountries: 0,
};

export function indexCamps(raw: RawCampsFile | null | undefined): SafariCampIndex {
  if (!raw?.CAMPS || !raw?.BYTRIP) return NO_CAMPS;
  const camps = raw.CAMPS;
  const byTrip = raw.BYTRIP;
  const cache = new Map<string, SafariCamp[]>();

  return {
    radiusKm: raw.radiusKm ?? 25,
    lodgesInCategory: raw.totals?.category ?? 0,
    lodgesInSafariCountries: raw.totals?.inSafariCountries ?? 0,
    forTrip(tripId: string) {
      const key = String(tripId);
      const hit = cache.get(key);
      if (hit) return hit;
      const rows = byTrip[key] ?? [];
      const out: SafariCamp[] = [];
      for (const r of rows) {
        const c = camps[r.id];
        if (!c || !Array.isArray(c.ll)) continue;
        out.push({
          id: r.id,
          name: c.n ?? "",
          house: c.house ?? null,
          country: c.country ?? null,
          ll: [c.ll[0], c.ll[1]],
          thumb: c.thumb ?? null,
          rooms: c.rooms ?? null,
          perks: c.perks ?? [],
          hasPromotion: c.promo === 1,
          stop: r.stop ?? null,
          day: r.day ?? null,
          km: r.km ?? 0,
        });
      }
      cache.set(key, out);
      return out;
    },
  };
}

/**
 * Where a camp lives on the hotel atlas.
 *
 * `?hotel=` and not `?ids=`: the hotel descriptor declares it in
 * `extraIdParams` and treats it as HIGHLIGHT-only, so arriving from here
 * enlarges and frames the camp without hiding its neighbours. That is the
 * right behaviour for this link in particular — a traveller following a camp
 * out of an itinerary is asking "what else is near this", and an atlas
 * narrowed to one pin cannot answer.
 */
export function campHref(camp: { id: string }): string {
  return `/atlas/hotel?hotel=${encodeURIComponent(camp.id)}`;
}

/**
 * Where ALL the safari lodges live.
 *
 * `category=Lodge / Safari` is a declared facet on the hotel descriptor, so
 * this filters on arrival rather than dropping the reader into 2,240 hotels
 * to find the lodges themselves.
 */
export const ALL_LODGES_HREF = `/atlas/hotel?category=${encodeURIComponent("Lodge / Safari")}`;

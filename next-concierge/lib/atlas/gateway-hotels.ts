/**
 * The hotels at either end of a journey, and where they live in the hotel atlas.
 *
 * This is the read side of scripts/build-gateway-hotels.mjs — see that file for
 * why the join is by coordinate, why the gateways are stored once and shared,
 * and why the brand affinity exists at all.
 *
 * Sibling of safari-camps.ts, and the distinction between them is the whole
 * point. The camps are ON the itinerary: a safari's stops are places we sell.
 * These hotels are NOT on the itinerary — they are the nights on either side of
 * it, which is the only part of a jet expedition or a world cruise we can put a
 * bed against. So, as there:
 *
 *   The DATA says: this property, which we sell and hold perks on, is within
 *   `radiusKm` of the place this journey begins (or ends).
 *
 *   The UI may therefore say: "where to stay before" / "after".
 *
 *   The UI may NOT say the night is included, booked, or the operator's own
 *   pre-cruise hotel. Some fares do include one and the feed never says which;
 *   presenting ours as that one would be inventing a booking.
 */

export interface GatewayStay {
  /** Hotel atlas id — `h_01778`. The deep link is built from this. */
  id: string;
  name: string;
  /** The house as a traveller names it — Aman, Belmond, Rosewood — or null. */
  house: string | null;
  city: string | null;
  country: string | null;
  /** `[lat, lng]`, the feed's convention. Convert before handing to a map. */
  ll: [number, number];
  thumb: string | null;
  rooms: number | null;
  /** At most three short VIP benefit tags, as the hotel card shows them. */
  perks: string[];
  hasPromotion: boolean;
  /** Distance from the gateway, kilometres, one decimal. */
  km: number;
  /** True when this hotel is the journey's own house — see `house` below. */
  sameHouse: boolean;
}

export interface GatewaySide {
  /** The place as the itinerary names it: "Venice, Italy", "Ushuaia". */
  place: string | null;
  stays: GatewayStay[];
}

export interface JourneyStays {
  pre: GatewaySide | null;
  post: GatewaySide | null;
  /** How near a hotel had to be to count, so the UI can say so. */
  radiusKm: number;
  /**
   * The house this journey is branded to — "Four Seasons" for a Four Seasons
   * Private Jet expedition, "Aman" for Aman at Sea — or null for the operators
   * that do not also run hotels. It is what `sameHouse` was decided against,
   * and the UI names it, because "Four Seasons" is the reason that row is first.
   */
  house: string | null;
  /** True when a round trip begins and ends in the same place. */
  sameEnds: boolean;
}

/** What `public/maps/<atlas>/gateways.json` holds, as shipped. */
interface RawGatewayFile {
  radiusKm?: number;
  HOTELS?: Record<
    string,
    {
      n?: string;
      house?: string | null;
      aff?: string | null;
      city?: string | null;
      country?: string | null;
      ll?: [number, number];
      thumb?: string | null;
      rooms?: number | null;
      perks?: string[];
      promo?: number;
    }
  >;
  GATES?: Record<string, { n?: string | null; ll?: [number, number]; h?: [string, number][] }>;
  BYTRIP?: Record<string, { pre?: string | null; post?: string | null; house?: string | null }>;
}

export interface GatewayIndex {
  /** The nights either side of one journey, or null when it has neither. */
  forTrip: (tripId: string) => JourneyStays | null;
  radiusKm: number;
  /** Distinct hotels in the shipped file, for a collection-level line. */
  hotelCount: number;
  /** Distinct departure/arrival places the file covers. */
  gatewayCount: number;
}

/** An index that knows nothing — what an atlas uses when the file is absent. */
export const NO_GATEWAYS: GatewayIndex = {
  forTrip: () => null,
  radiusKm: 0,
  hotelCount: 0,
  gatewayCount: 0,
};

/**
 * How many hotels one end of a journey is allowed to show.
 *
 * The file keeps more than this — four nearest plus a pick for each house the
 * collection sells — precisely so that this cut can be made per journey rather
 * than per gateway: a Four Seasons expedition and a National Geographic one
 * leave from the same Bangkok and should not be offered the same three beds.
 * Three is what fits under an itinerary without becoming the page.
 */
const PER_SIDE = 3;

export function indexGateways(raw: RawGatewayFile | null | undefined): GatewayIndex {
  if (!raw?.HOTELS || !raw?.GATES || !raw?.BYTRIP) return NO_GATEWAYS;
  const hotels = raw.HOTELS;
  const gates = raw.GATES;
  const byTrip = raw.BYTRIP;
  const radiusKm = raw.radiusKm ?? 40;
  const cache = new Map<string, JourneyStays | null>();

  const side = (key: string | null | undefined, house: string | null): GatewaySide | null => {
    if (!key) return null;
    const gate = gates[key];
    if (!gate?.h?.length) return null;
    const stays: GatewayStay[] = [];
    for (const [id, km] of gate.h) {
      const h = hotels[id];
      if (!h || !Array.isArray(h.ll)) continue;
      stays.push({
        id,
        name: h.n ?? "",
        house: h.house ?? null,
        city: h.city ?? null,
        country: h.country ?? null,
        ll: [h.ll[0], h.ll[1]],
        thumb: h.thumb ?? null,
        rooms: h.rooms ?? null,
        perks: h.perks ?? [],
        hasPromotion: h.promo === 1,
        km: km ?? 0,
        sameHouse: Boolean(house && h.aff === house),
      });
    }
    if (!stays.length) return null;
    /*
     * The journey's own house first, then by distance.
     *
     * This is the only reordering the read side does, and it is the reason the
     * affinity is carried per journey rather than baked into the gateway: the
     * gateway is shared by every collection member that leaves from there, and
     * "Four Seasons first" is true of twelve of Bangkok's departures and of
     * none of the others.
     */
    stays.sort((a, b) => Number(b.sameHouse) - Number(a.sameHouse) || a.km - b.km);
    return { place: gate.n ?? key, stays: stays.slice(0, PER_SIDE) };
  };

  return {
    radiusKm,
    hotelCount: Object.keys(hotels).length,
    gatewayCount: Object.keys(gates).length,
    forTrip(tripId: string) {
      const key = String(tripId);
      if (cache.has(key)) return cache.get(key) ?? null;
      const row = byTrip[key];
      let out: JourneyStays | null = null;
      if (row) {
        const house = row.house ?? null;
        const pre = side(row.pre, house);
        const post = side(row.post, house);
        if (pre || post) {
          out = {
            pre,
            post,
            radiusKm,
            house,
            // Compared on the GATEWAY key, not on the display name: two
            // different calls can print the same city, and a round trip is the
            // one that returns to the same key.
            sameEnds: Boolean(row.pre && row.post && row.pre === row.post),
          };
        }
      }
      cache.set(key, out);
      return out;
    },
  };
}

/**
 * Where a gateway hotel lives on the hotel atlas.
 *
 * `?hotel=` and not `?ids=`, for the same reason campHref uses it: the hotel
 * descriptor treats that param as HIGHLIGHT-only, so arriving from here frames
 * the property without hiding its neighbours — and a traveller picking the
 * night before a departure is exactly the reader who wants to see what else is
 * on that square.
 */
export function stayHref(stay: { id: string }): string {
  return `/atlas/hotel?hotel=${encodeURIComponent(stay.id)}`;
}

/** Where the rest of a gateway's hotels are — the city, on the hotel atlas. */
export function cityHref(city: string | null | undefined): string | null {
  return city ? `/atlas/hotel?city=${encodeURIComponent(city)}` : null;
}

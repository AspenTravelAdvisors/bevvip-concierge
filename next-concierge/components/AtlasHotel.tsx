"use client";

/**
 * VIP Hotels — one surface, two engines.
 *
 * Deliverable 2 shipped this as a SPLIT: browse on the Mapbox globe here,
 * inspect in Google Photorealistic 3D over in `public/maps/hotel/index.html`,
 * reached by opening a new tab. The engineering was right and the placement was
 * wrong. The work order's own words are why:
 *
 *   > Mapbox has no equivalent (its "3D buildings" are extruded footprints — a
 *   > grey block where the hotel is). For a luxury travel product this is the
 *   > single most persuasive thing the app does. It stays.
 *
 * A thing that persuasive should not be three clicks and a tab away. So the
 * split is now along the camera, not along the page: photoreal is an ENGINE
 * CHOICE on this map (see AtlasShell's `photoreal` prop and Atlas3DLayer),
 * carrying the filters, the selection and the camera across the switch. The
 * hotel atlas's own numbers still define where each engine earns its keep —
 * DETAIL_TILT engages at DETAIL_RANGE = 2,600 m and eases flat by 220 km —
 * they just no longer imply two destinations.
 *
 *   BROWSE   2,501 hotels, filtered by category, program, country and
 *            macro-region, on whichever engine is drawing.
 *   INSPECT  a card or a pin opens the property dossier and flies to the
 *            building; on the photoreal engine that is the real building, in
 *            photogrammetry mesh. The `?hotel=<id>` deep link lands there
 *            directly — reliable since the camera-race fix in STATE.md, which
 *            Atlas3DLayer ports along with the rest of the camera.
 *
 * Hotels are the first collection whose filter grammar genuinely differs from
 * the five retired atlases; every divergence is documented in
 * lib/atlas/adapters/hotel.ts and asserted by scripts/verify-hotels.mjs
 * (1.75M comparisons against the original predicate).
 *
 * Nothing here touches GOOGLE_MAPS_API_KEY, /api/hotel/config, or the
 * /maps/hotel/api/* rewrite — all three must survive, per the work order's
 * "three things that will look like cleanup and are not".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AtlasCollection from "./AtlasCollection";
import { adaptHotels, HOTEL_DESCRIPTOR, type RawHotelPoints } from "@/lib/atlas/adapters/hotel";
import { REGION_ORDER } from "@/lib/atlas/adapters/hotel-regions";
import { programDomain } from "@/lib/atlas/adapters/hotel-programs";
import { hotelBrandDomain } from "@/lib/atlas/adapters/hotel-brands";
import type { ParseContext } from "@/lib/atlas/adapters/params";
import type { AtlasOffering } from "@/lib/atlas/adapters/types";
import type { BrandMark } from "./BrandLogo";
import { hotel3dOpened, bookingClicked } from "@/lib/analytics";
import HotelDossier from "./HotelDossier";
import { bookingLink } from "@/lib/atlas/booking.js";
import { getTrip, onTrip } from "@/lib/trip-state";
import type { TripState } from "@/lib/types";

/** What /api/hotel/tw hands back per hotel — enough to build a rate search. */
interface TwIdentity {
  hotelId?: string | number;
  lat?: number;
  lon?: number;
  label?: string;
}

export default function AtlasHotel() {
  /**
   * TravelWits identities for the hotels currently on screen.
   *
   * The static point feed the globe downloads carries no `tw` (it is attached
   * server-side from the harvested overlay), so a browse card cannot build a
   * rate search on its own. Rather than shipping the overlay to every visitor,
   * we resolve the identities for the ~120 rendered cards in one request and
   * cache them for the session — filtering to a new region costs one more.
   */
  const [tw, setTw] = useState<Record<string, TwIdentity>>({});
  const [bookUrls, setBookUrls] = useState<Record<string, string>>({});
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const askedRef = useRef<Set<string>>(new Set());

  // The shared trip, so a rate search prices the dates the traveller already
  // gave The Guide. With none, lib/atlas/booking.js prices tomorrow night —
  // the same one-night default the standalone hotel atlas uses.
  const [trip, setTrip] = useState<TripState | null>(null);
  useEffect(() => {
    setTrip(getTrip());
    return onTrip(setTrip);
  }, []);

  const onVisibleIds = useCallback((ids: string[]) => {
    const missing = ids.filter((id) => id && !askedRef.current.has(id));
    if (!missing.length) return;
    for (const id of missing) askedRef.current.add(id);
    fetch(`/api/hotel/tw?ids=${encodeURIComponent(missing.join(","))}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (j: {
          tw?: Record<string, TwIdentity>;
          bookUrl?: Record<string, string>;
          bookPassword?: Record<string, string>;
        }) => {
          if (j.tw && Object.keys(j.tw).length) setTw((prev) => ({ ...prev, ...j.tw }));
          if (j.bookUrl && Object.keys(j.bookUrl).length) {
            setBookUrls((prev) => ({ ...prev, ...j.bookUrl }));
          }
          if (j.bookPassword && Object.keys(j.bookPassword).length) {
            setPasswords((prev) => ({ ...prev, ...j.bookPassword }));
          }
        },
      )
      .catch(() => {
        // A miss just means no rate link on those cards — "See it in 3D",
        // "View details" and "Ask The Guide" all still work. Let them be
        // retried on the next filter change rather than sticking.
        for (const id of missing) askedRef.current.delete(id);
      });
  }, []);

  /**
   * The card's primary action: a TravelWits search of THIS property at the VIP
   * rate codes.
   *
   * Rendered as a real anchor with a real href — never a button that fetches
   * and then opens a window, which browsers treat as a popup. The link simply
   * does not exist until the identity has resolved, so no one can click through
   * to a search that cannot run.
   */
  const cardPrimary = useCallback(
    (o: AtlasOffering) => {
      const identity = tw[o.id];
      const portal = bookUrls[o.id];
      // Nothing resolved yet (or nothing to resolve) — render no CTA rather
      // than a link that lands somewhere useless.
      if (!identity && !portal) return null;
      const booking = bookingLink(
        {
          type: "hotel",
          id: o.id,
          name: o.title,
          ...(identity ? { tw: identity } : {}),
          ...(portal ? { bookUrl: portal } : {}),
          ...(passwords[o.id] ? { bookPassword: passwords[o.id] } : {}),
        },
        trip,
      );
      if (!booking?.url) return null;
      return (
        <span className="ac-book-wrap" onClick={(e) => e.stopPropagation()}>
          <a
            className="ac-book"
            href={booking.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              bookingClicked("hotel", !booking.needsDates);
            }}
          >
            {booking.label} ↗
          </a>
          {booking.note && <span className="ac-book-code">{booking.note}</span>}
        </span>
      );
    },
    [tw, bookUrls, passwords, trip],
  );

  const load = useCallback(async () => {
    /*
     * The same point feed the home globe already fetches — no new payload.
     *
     * `no-cache`, NOT `force-cache`. force-cache serves a cached copy however
     * stale and never revalidates, which was survivable when this file only
     * changed on a human deploy. The nightly Virtuoso sync rewrites it, so a
     * returning visitor was pinned to whatever inventory their browser cached
     * the first time — old properties still listed, new ones missing, and no
     * photographs at all, since the pre-sync feed had no `thumb`. `no-cache`
     * revalidates and the server answers 304 when nothing moved, so the cost is
     * a conditional request rather than the payload.
     */
    const raw: RawHotelPoints = await fetch("/maps/hotel/hotel-points.json", {
      cache: "no-cache",
    }).then((r) => {
      if (!r.ok) throw new Error(`hotel points ${r.status}`);
      return r.json();
    });

    const offerings = adaptHotels(raw);

    // Macro-regions in the original's geographic display order, not alphabetical
    // — "North America, Caribbean, … Polar" reads as a journey outward.
    const present = new Set(offerings.flatMap((o) => o.regions));
    const ordered = REGION_ORDER.filter((r) => present.has(r));
    const regionLabels: Record<string, string> = {};
    for (const r of ordered) regionLabels[r] = r;

    // Marks are keyed by whatever `logoKey` chose — the hotel's BRAND where it
    // has a confirmed mark, else its PROGRAM. Both maps are consulted here in
    // that order, so a key like "Fairmont" (which is both a brand and a
    // program) resolves the same either way, and every card still gets a logo.
    const brandMarks: Record<string, BrandMark> = {};
    for (const o of offerings) {
      const key = o.logoKey;
      if (!key || brandMarks[key]) continue;
      brandMarks[key] = { key, short: key, domain: hotelBrandDomain(key) ?? programDomain(key) };
    }

    const ctx: ParseContext = {
      brands: [],
      regions: ordered.map((key) => ({ key, name: key })),
      // Hotels have no itinerary, so no stop filter — see the descriptor.
      stopNames: [],
    };

    return {
      offerings,
      ctx,
      regionLabels,
      // A hotel has no route. Returning null lets AtlasCollection fall through
      // to framing its single located stop: click a card, fly to the property.
      routeFor: () => null,
      brandMarks,
      logoBase: "",
    };
  }, []);

  /**
   * Open the property here.
   *
   * This used to be `window.open("/atlas/hotel?hotel=…", "_blank")` — the
   * dossier and the photoreal building lived in an iframe on another tab, so
   * the card's most interesting action was also the one that left the app,
   * abandoning the filters and the camera on the way out.
   *
   * Now it selects AND discloses: the shared selection drives the card list and
   * the map pin, the dossier opens beside the map (or inside the card, on a
   * phone), and if the photoreal engine is drawing, the camera flies to the
   * building. Same gesture, same destination, no tab.
   *
   * This is the ONLY thing on a card that opens the dossier. Clicking the card
   * itself selects the property — flies to it, highlights its pin — and stops
   * there: browsing a list of 120 hotels should not fire the property file 120
   * times, and on a phone every one of those buried the map under a panel.
   */
  const openProperty = useCallback(
    (
      o: AtlasOffering,
      api: {
        openDetail: () => void;
        showPhotoreal: () => void;
        close: () => void;
        open: boolean;
      },
    ) => {
      // Open, so the label reads "Hide details" — and a button that says so
      // has to close. On a phone that is the difference between a card that
      // expands and one that only ever grows.
      if (api.open) {
        api.close();
        return;
      }
      hotel3dOpened(o.id, "card");
      api.showPhotoreal();
      api.openDetail();
    },
    [],
  );

  /**
   * Where the property is, above its name.
   *
   * City first, then country — the order a traveller says it in, and the same
   * shape villa's crumb has. The card's meta line beneath drops the country it
   * used to repeat and says what the property IS instead.
   */
  const cardCrumb = useCallback(
    (o: AtlasOffering) =>
      [o.attributes?.city as string | null, o.country].filter(Boolean).join(" · "),
    [],
  );

  /**
   * What the traveller gets — the VIP amenity block, reduced to three tags.
   *
   * "Daily breakfast · $100 credit · Room upgrade". This is what a preferred-
   * partner atlas is FOR, and until now it existed only inside the dossier,
   * three clicks from the card that was trying to persuade anyone to open it.
   * lib/atlas/hotel-perks.js does the reduction at build time; the prose stays
   * in luxury-hotels.json for the dossier, which is where the caveats belong.
   */
  const cardNote = useCallback((o: AtlasOffering) => {
    const perks = o.attributes?.perks;
    if (!Array.isArray(perks) || !perks.length) return null;
    return perks.join(" · ");
  }, []);

  /**
   * The property's photograph, at the card's top edge.
   *
   * AtlasCollection's rule for `cardMedia` is that media is photo-CAPABLE, not
   * photo-required: a collection passes it only once its feed actually carries
   * images, or every card becomes a grey rectangle. Hotels withheld it for
   * exactly that reason — `thumb` was cut end to end and empty on all of them.
   * The Virtuoso sync filled it, so the slot opens now: 2,066 of 2,382
   * properties have a supplier photograph, and the rest fall through to the
   * considered empty space `.ac-media-empty` already draws.
   *
   * No badge over it. The program mark is a brand logo the card body already
   * renders, and putting it here too would say the same thing twice.
   */
  const cardMedia = useCallback((o: AtlasOffering) => {
    const src = typeof o.thumb === "string" ? o.thumb : null;
    return (
      <span className="ac-media">
        {/* A live supplier offer, flagged on the point feed. The offer's terms
            are in the dossier; on a card the badge only has to be worth the
            click. */}
        {o.hasPromotion && <span className="ac-offer-badge">✦ Offer</span>}
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" />
        ) : (
          <span className="ac-media-empty" />
        )}
      </span>
    );
  }, []);

  return (
    <AtlasCollection
      type="hotel"
      descriptor={HOTEL_DESCRIPTOR}
      load={load}
      cardCrumb={cardCrumb}
      cardNote={cardNote}
      cardMedia={cardMedia}
      // The program mark rides on the photograph now that there is one, and
      // leaves the head row to the property's name.
      markOverMedia
      // The hotel atlas's own accent.
      accent="#caa44e"
      initialStyle="satellite"
      cardPrimary={cardPrimary}
      onVisibleIds={onVisibleIds}
      /*
       * "See it in 3D" undersold where it goes. That panel is not a 3D toy —
       * it is the only place the property's description, star and award
       * ratings, address, program, VIP benefit list and rate access code
       * exist. A traveller reading the label had no way to know the details
       * were behind it, so the most complete page in the product was being
       * offered as a novelty view.
       *
       * Both halves now live on this page: `detailFor` renders that dossier
       * beside the map (components/HotelDossier), and `photoreal` puts the
       * actual building under it.
       */
      cardAction={{
        /*
         * The label names what the press will ADD to the screen.
         *
         * From the Mapbox globe that is both halves — the dossier and the
         * building — and no arrow any more, because this no longer leaves the
         * page. Once the photoreal engine is already drawing, promising 3D is
         * promising the thing the traveller is looking at: all that is left to
         * offer is the details. And on the open card the same button is the
         * way back out.
         */
        label: ({ engine, open }) =>
          open ? "Hide details" : engine === "photoreal" ? "Details" : "Property details & 3D",
        title: ({ engine, open }) =>
          open
            ? "Close this property's profile"
            : engine === "photoreal"
              ? "Full profile: description, ratings, address, VIP benefits and rates"
              : "Full profile: description, ratings, address, VIP benefits and rates — with the photoreal 3D view of the building",
        onSelect: openProperty,
      }}
      // The engine, and the panel that makes it worth reaching.
      photoreal
      detailFor={(o, { close }) => (
        <HotelDossier id={o.id} fallbackName={o.title} onClose={close} />
      )}
    />
  );
}

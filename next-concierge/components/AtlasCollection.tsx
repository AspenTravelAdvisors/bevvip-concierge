"use client";

/**
 * A collection browsed on the globe — the replacement for one iframed Leaflet
 * atlas.
 *
 * Composes pieces that already exist and are already verified rather than
 * introducing a fourth map product:
 *
 *   AtlasShell        the Mapbox globe, scoped to this collection's layer
 *   adapters/*        itinerary.json → AtlasOffering[] (parity-tested)
 *   params.ts         deep links in, Share links out (parity-tested)
 *   AtlasFilterRail   one rail, driven by the descriptor
 *
 * The globe shows ambient region pins plus ONE traced route — the interaction
 * the Leaflet atlases had. It deliberately does not reuse The Guide's
 * `bevvip:atlas-plot` path; see the note above the trace helpers for why.
 *
 * The URL is the source of truth for filter state. Every change rewrites the
 * query string, so the browser's Share/copy-URL gives a link identical in shape
 * to the ones the old Share buttons produced — and every link those buttons
 * ever produced still parses (see D3-FILTER-INVENTORY.md).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { OfferingType } from "@/lib/types";
import type { AtlasFilterDescriptor, AtlasOffering } from "@/lib/atlas/adapters/types";
import { matchesOffering, type AtlasFilterState } from "@/lib/atlas/adapters/filter";
import { parseDeepLink, toSearchParams, type ParseContext } from "@/lib/atlas/adapters/params";
import { whenLabelFor, sortOfferings, SORT_MODES, type SortMode } from "@/lib/atlas/dates";
import AtlasFilterRail, { type AtlasQuery } from "./AtlasFilterRail";
import AtlasShell, { type StyleKey } from "./AtlasShell";
import type { Point3D } from "./Atlas3DLayer";
import { useIsMobile } from "@/lib/use-is-mobile";
import { askAboutProperty, askGuide, askGuideHref } from "@/lib/atlas/ask";
import BrandLogo, { type BrandMark } from "./BrandLogo";
import { internalAtlasLink } from "@/lib/atlas-config";

/** One drawable leg of a traced route, already in [lng, lat]. */
export interface RouteLegOut {
  mode: string;
  coordinates: [number, number][];
}

/** What a card's secondary action is being drawn against right now. */
export interface CardActionState {
  /** Which renderer is on screen, for collections that offer photoreal. */
  engine: "mapbox" | "photoreal";
  /** Whether THIS card is the open one. */
  open: boolean;
}

interface Props {
  type: OfferingType;
  descriptor: AtlasFilterDescriptor;
  /** Collection accent for routes and stop dots — the atlas's own --accent. */
  accent?: string;
  /** Basemap this collection opens on. */
  initialStyle?: StyleKey;
  /** false → open flat. Long-haul arcs read better in 2D. */
  initialGlobe?: boolean;
  /**
   * A secondary action on every card. Hotels use it to open the property view —
   * the Google Photorealistic building AND the full dossier that sits beside it
   * (description, ratings, address, program, VIP benefits, access code). That
   * panel is the only place most of those live, which is why the label names
   * the details rather than only the 3D.
   *
   * It used to be the loudest thing on the card (filled gold). It now sits at
   * the same weight as "Ask The Guide": inspecting a building is a lovely
   * detour, but it is not the action a traveller came to take.
   *
   * `title` is the long-form promise, for the hover the label has no room for.
   */
  cardAction?: {
    /**
     * A plain string, or a function of what the page is currently showing.
     *
     * Hotels need the function: "Property details & 3D" is an honest promise
     * from the Mapbox globe and a redundant one once the photoreal engine is
     * already drawing the building — at that point the only half of the label
     * still worth offering is the details. See AtlasHotel.
     */
    label: string | ((state: CardActionState) => string);
    title?: string | ((state: CardActionState) => string);
    /**
     * `api` is what the action can do to this page. Hotels use it to open a
     * property AND put the photoreal engine on screen in one gesture — which
     * is the whole action, and used to be a new browser tab.
     *
     * `close` exists because the label can say "Hide details": a button whose
     * label promises to close something has to actually close it, and `select`
     * deliberately does nothing when the card is already open.
     */
    onSelect: (
      o: AtlasOffering,
      api: {
        select: () => void;
        showPhotoreal: () => void;
        close: () => void;
      } & CardActionState,
    ) => void;
  };
  /**
   * The card's PRIMARY action, rendered first and given the filled treatment.
   *
   * Hotels use it for the VIP rate search. The collection owns the rendering
   * (it may need to resolve a link asynchronously) and this component only
   * decides where it sits in the hierarchy — which is the whole point: exactly
   * one filled button per card, and it is the one that starts a booking.
   */
  cardPrimary?: (o: AtlasOffering) => React.ReactNode;
  /**
   * The ids currently on screen, whenever that set changes.
   *
   * Lets a collection resolve `cardPrimary` links for the visible cards in one
   * batch instead of per card — 120 cards, one request.
   */
  onVisibleIds?: (ids: string[]) => void;
  /**
   * Offer the Google Photorealistic 3D engine on this collection's map.
   *
   * Collections whose offerings ARE a single place — hotels, and villas when
   * they converge — pass this. A collection of routes does not: photoreal 3D of
   * a shipping lane is an expensive picture of water.
   *
   * The engine draws whatever the rail has filtered, and shares the pinned
   * selection with the card list, so the switch keeps every decision the
   * traveller has already made.
   */
  photoreal?: boolean;
  /**
   * The selected offering's own panel — the property dossier, for hotels.
   *
   * Description, ratings, address, program, VIP benefits and rates, which
   * until now existed ONLY inside the standalone 3D page. Bringing the engine
   * into the shell without bringing this would have moved the picture and left
   * the substance behind.
   *
   * It has TWO homes, and the viewport picks (see `inlineDetail` below): beside
   * the map on desktop, and inside the open card on phones. Rendered in one of
   * them at a time, never both — this mounts a component that fetches the
   * property record, so a second copy hidden by CSS is a second request.
   */
  detailFor?: (o: AtlasOffering, opts: { close: () => void }) => React.ReactNode;
  /** Loads and adapts this collection's raw feed. Collection-specific. */
  load: () => Promise<{
    offerings: AtlasOffering[];
    ctx: ParseContext;
    regionLabels: Record<string, string>;
    /**
     * Real route geometry for one offering, when the collection has it.
     * Rail ships actual track polylines; without this a traced route falls back
     * to straight legs between stops, which is honest but much less useful.
     */
    routeFor?: (o: AtlasOffering) => RouteLegOut[] | null;
    /** Brand marks for logos — key, display name, domain, brand colour. */
    brandMarks?: Record<string, BrandMark>;
    /** Where bundled logo assets live, e.g. "/maps/train/logos". */
    logoBase?: string;
  }>;
}

/**
 * Does any part of this offering fall inside the on-screen box?
 *
 * "Any part", not "its centre": a cruise whose route crosses the viewport is
 * something you are looking at even when both its ports are off-screen, and a
 * hotel has exactly one point so the two rules agree there anyway.
 *
 * The west > east case is a viewport straddling the antimeridian, where the box
 * is the OUTSIDE of the interval rather than the inside — without it, panning
 * to the date line silently empties the list.
 */
function touchesBox(o: AtlasOffering, box: [number, number, number, number]) {
  const [w, s, e, n] = box;
  const inLng = (lng: number) => (w <= e ? lng >= w && lng <= e : lng >= w || lng <= e);
  const hit = (lng: number, lat: number) => lat >= s && lat <= n && inLng(lng);
  for (const st of o.stops) if (st.at && hit(st.at[0], st.at[1])) return true;
  for (const c of o.path) if (hit(c[0], c[1])) return true;
  return false;
}

const dayRange = (a: number | null, b: number | null) =>
  a == null ? "" : a === b ? `Day ${a}` : `Days ${a}-${b}`;

/**
 * Sort options, in menu order. `departure` is the default and deliberately
 * first: the list is capped at 120 cards, so whatever leads the order is the
 * only part of a 3,239-sailing collection most people ever see.
 */
const SORT_LABELS: Record<SortMode, string> = {
  "departure": "Next departure",
  "duration-desc": "Longest first",
  "duration-asc": "Shortest first",
  "name": "Name (A–Z)",
};

/**
 * How many cards the list renders. Named rather than inlined because the sort
 * order and this cap are one decision: the cap is only defensible if the cards
 * it keeps are the ones worth keeping.
 */
const CARD_LIMIT = 120;

/**
 * How many points the filter-fit is allowed to measure (see fitFilterResults).
 *
 * The whole expedition collection is 3,239 sailings; measuring every stop of
 * every one of them to compute one bounding box is work the traveller pays for
 * in dropped frames. Sampling beyond this cap changes the box by less than the
 * padding around it.
 */
const FIT_POINT_CAP = 3000;

/** Only ever trust a `sort=` the current menu can actually render. */
const readSort = (
  raw: string | null,
  fallback: SortMode,
  modes: readonly SortMode[],
): SortMode => (modes as readonly string[]).includes(raw || "") ? (raw as SortMode) : fallback;

/**
 * A single day inside an expanded itinerary — "25 Oct", no year.
 *
 * The year is deliberately absent HERE and only here. These rows sit under a
 * card header that now prints the full range with years, so repeating 2026 on
 * every one of a 245-day world cruise's day lines adds noise without adding
 * information. Card-level dates go through formatRange, which always carries
 * the year; see lib/atlas/dates.js.
 *
 * Parsed as UTC and formatted as UTC. The old implementation appended
 * "T00:00:00" (local) and let toLocaleDateString use the local zone — west of
 * UTC that renders midnight as the PREVIOUS day, so a traveler in Los Angeles
 * saw every itinerary date shifted one day early.
 */
const fmtDay = (iso?: string | null) =>
  iso
    ? new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
        day: "numeric", month: "short", timeZone: "UTC",
      })
    : "";

export default function AtlasCollection({
  type, descriptor, load, accent, initialStyle, initialGlobe, cardAction,
  cardPrimary, onVisibleIds, photoreal = false, detailFor,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [offerings, setOfferings] = useState<AtlasOffering[] | null>(null);
  const [ctx, setCtx] = useState<ParseContext | null>(null);
  const [regionLabels, setRegionLabels] = useState<Record<string, string>>({});
  const [routeFor, setRouteFor] = useState<{ fn?: (o: AtlasOffering) => RouteLegOut[] | null }>({});
  const [brandMarks, setBrandMarks] = useState<Record<string, BrandMark>>({});
  const [logoBase, setLogoBase] = useState("");
  const [failed, setFailed] = useState(false);
  /**
   * The pinned trip, mirroring the Leaflet atlas's `routeLocked` + `pinnedTrip`.
   * Hover is a PREVIEW; a click pins. While something is pinned, hovering other
   * cards does not steal the map, and leaving a card restores the pinned route
   * rather than clearing it — which is why "the route vanishes when I click" was
   * the right complaint about a hover-only trace.
   */
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  /**
   * Which map engine is drawing.
   *
   * Owned here rather than in the shell because everything that needs it lives
   * at this level: the deep-link parse that may arrive asking for `engine=3d`,
   * the Share link that has to carry it, and the card action that switches to
   * photoreal while opening a property.
   */
  const [engine, setEngine] = useState<"mapbox" | "photoreal">("mapbox");
  const hoverTimer = useRef<number | null>(null);
  // Live map view, so Share can capture basemap + projection + camera.
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  /*
   * The rendered cards, by id — so opening a property can scroll to its card
   * on a phone, whether the gesture was on the card or on a map pin. Both
   * engines' pins already land in `togglePin` (AtlasShell's popup action and
   * the photoreal marker's `onSelect`), so a pin behaves like a card for free.
   */
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  /**
   * Whether this page CAN open a property inside its card — the viewport and
   * the collection, not the selection.
   *
   * Deliberately the capability rather than `inlineDetail` below: nothing is
   * open at the moment the traveller opens something, so a ref that tracked the
   * rendered state would be false on every first press and the scroll would go
   * to the map instead of the card. Whether the property HAS a card on screen
   * is answered separately, by whether it has a ref in `cardRefs`.
   */
  const inlineOkRef = useRef(false);
  const phone = useIsMobile();
  const viewRef = useRef<{
    style: string; engine?: "mapbox" | "photoreal"; globe: boolean;
    center: { lng: number; lat: number }; zoom: number; pitch: number; bearing: number;
    bounds?: [number, number, number, number] | null;
  } | null>(null);
  const [shared, setShared] = useState(false);

  /**
   * "Search this area" — limit the CARD LIST to what is on screen.
   *
   * The villa atlas established this and the rule that makes it work is that
   * the map is untouched: pins ignore the box entirely. Hiding the pins outside
   * the viewport would empty the map the moment anyone panned, which reads as a
   * broken map rather than a narrowed list. So this is "show me what's in
   * view", not a filter on geography.
   *
   * Local state rather than a URL param: unlike every real filter, a viewport
   * is not a thing worth putting in a shared link — the shared camera already
   * carries it, and a stale bbox riding along with someone else's screen size
   * would contradict what they see.
   */
  const [areaBox, setAreaBox] = useState<[number, number, number, number] | null>(null);

  const searchThisArea = useCallback(() => {
    const b = viewRef.current?.bounds;
    if (!b) return;
    setAreaBox(b);
  }, []);

  // Any change to the real filters drops the area limit: the map refits to the
  // new filter, so a box drawn around the old one is describing a view that no
  // longer exists. Same rule the villa atlas uses.
  const searchKey = searchParams.toString();
  useEffect(() => { setAreaBox(null); }, [searchKey]);

  // Today, pinned once per mount so the past-trip cutoff can't shift mid-session.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((r) => {
        if (cancelled) return;
        setOfferings(r.offerings);
        setCtx(r.ctx);
        setRegionLabels(r.regionLabels);
        setRouteFor({ fn: r.routeFor });
        setBrandMarks(r.brandMarks || {});
        setLogoBase(r.logoBase || "");
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [load]);

  // Filter state derives from the URL, so back/forward and shared links all
  // behave without a second source of truth.
  const parsed = useMemo(() => {
    if (!ctx) return null;
    return parseDeepLink(new URLSearchParams(searchParams.toString()), descriptor, ctx);
  }, [searchParams, descriptor, ctx]);

  const state: AtlasFilterState | null = parsed?.state ?? null;
  const query: AtlasQuery = useMemo(
    () => ({ q: searchParams.get("q") || "", country: searchParams.get("country") || "" }),
    [searchParams],
  );
  const sortModes = useMemo<SortMode[]>(
    () => (type === "hotel" ? ["name"] : [...SORT_MODES]),
    [type],
  );
  const defaultSort: SortMode = type === "hotel" ? "name" : "departure";

  // Sort lives in the URL alongside the filters, so a shared link reproduces
  // the list someone was actually looking at rather than just its contents.
  const sort = useMemo(
    () => readSort(searchParams.get("sort"), defaultSort, sortModes),
    [searchParams, defaultSort, sortModes],
  );

  const filtered = useMemo(() => {
    if (!offerings || !state) return [];
    let matched = offerings.filter((o) => matchesOffering(o, state, descriptor, today));
    if (areaBox) matched = matched.filter((o) => touchesBox(o, areaBox));
    // Ordering, not just filtering. Before this the list was rendered in feed
    // order and then truncated to 120 — so an expedition-cruise browser saw
    // 120 arbitrary sailings out of 3,239 rather than the next 120 to sail.
    return sortOfferings(matched, sort);
  }, [offerings, state, descriptor, today, sort, areaBox]);

  // The cards actually rendered. Named once so the list and the batch that
  // resolves their primary CTAs can never disagree about which those are.
  const visible = useMemo(() => filtered.slice(0, CARD_LIMIT), [filtered]);
  const visibleKey = useMemo(() => visible.map((o) => o.id).join(","), [visible]);
  useEffect(() => {
    if (!onVisibleIds) return;
    onVisibleIds(visibleKey ? visibleKey.split(",") : []);
    // visibleKey, not `visible`: a new array with the same ids must not refetch.
  }, [visibleKey, onVisibleIds]);

  /** Push a new filter state into the URL; the memo above picks it back up. */
  const writeUrl = useCallback(
    (next: AtlasFilterState, nextQuery: AtlasQuery) => {
      const qs = toSearchParams(next, parsed?.view ?? {}, descriptor, {
        q: nextQuery.q,
        country: nextQuery.country,
      });
      // Re-attached rather than threaded through toSearchParams: that function
      // is the deep-link contract the Leaflet atlases established and
      // verify-deeplinks round-trips 291 assertions against it. Sort is a view
      // preference, not a filter, and adding a param there would change a
      // shared surface to carry something no atlas ever emitted. Omitted at the
      // default so ordinary links stay clean.
      if (sort !== defaultSort) qs.set("sort", sort);
      const s = qs.toString();
      router.replace(s ? `/atlas/${type}?${s}` : `/atlas/${type}`, { scroll: false });
    },
    [router, type, descriptor, parsed?.view, sort, defaultSort],
  );

  /** Change the ordering, preserving every filter currently in the URL. */
  const setSort = useCallback(
    (next: SortMode) => {
      const qs = new URLSearchParams(searchParams.toString());
      if (next === defaultSort) qs.delete("sort");
      else qs.set("sort", next);
      const s = qs.toString();
      router.replace(s ? `/atlas/${type}?${s}` : `/atlas/${type}`, { scroll: false });
    },
    [router, type, searchParams, defaultSort],
  );

  /**
   * Trace one trip's route on the globe — hover previews, click pins. This is
   * the interaction the Leaflet atlases had, and drawing a whole collection's
   * routes at once is not a substitute for it.
   *
   * Note what is deliberately absent: these pages do NOT dispatch
   * `bevvip:atlas-plot`. Reusing The Guide's plot path looked economical and
   * was wrong three ways — it drops a "N plotted / Reset" badge belonging to
   * the chat, it frames the camera on a generic pin rather than the journey,
   * and `plotResults` writes sessionStorage under `bevvip:atlas:last-plot`,
   * which the HOME globe replays on boot. Browsing a collection would have
   * poisoned the home page with that collection's trips.
   */
  const emitRoute = useCallback(
    (o: AtlasOffering | null, fit = false) => {
      if (!o) {
        window.dispatchEvent(new CustomEvent("bevvip:atlas-route", { detail: { legs: [] } }));
        return;
      }
      const real = routeFor.fn?.(o) ?? null;
      const legs: RouteLegOut[] = real ?? (() => {
        // No shipped geometry: draw straight legs between located stops rather
        // than inventing a curve the vehicle does not travel.
        const pts = o.stops.filter((s) => s.at).map((s) => [s.at![0], s.at![1]] as [number, number]);
        return pts.length >= 2 ? [{ mode: "arc", coordinates: pts }] : [];
      })();
      // A click always moves the camera. When a trip has no drawable geometry
      // at all, fall back to framing its located stops so clicking a card is
      // never a no-op.
      const fallback = legs.length
        ? []
        : o.stops.filter((s) => s.at).map((s) => [s.at![0], s.at![1]] as [number, number]);
      // Stops travel with the route: the globe draws them as numbered dots with
      // hover labels, as the Leaflet atlas did.
      const stops = o.stops
        .filter((s) => s.at)
        .map((s) => ({ name: s.name, at: [s.at![0], s.at![1]] as [number, number], day: s.day ?? null }));
      window.dispatchEvent(
        new CustomEvent("bevvip:atlas-route", {
          detail: { legs, stops, fit, fitPoints: fallback.length ? fallback : undefined },
        }),
      );
    },
    [routeFor],
  );

  /**
   * Frame a SET of offerings without tracing any one of them.
   *
   * Uses real route geometry where the collection ships it, falling back to
   * located stops — so a shortlist of yacht sailings frames the water they
   * actually cover, not the bounding box of their embarkation ports.
   */
  const fitOfferings = useCallback(
    (list: AtlasOffering[]) => {
      const pts: [number, number][] = [];
      for (const o of list) {
        const real = routeFor.fn?.(o);
        if (real?.length) {
          for (const leg of real) for (const c of leg.coordinates) pts.push(c);
        } else if (o.path.length) {
          for (const c of o.path) pts.push([c[0], c[1]]);
        } else {
          for (const s of o.stops) if (s.at) pts.push([s.at[0], s.at[1]]);
        }
      }
      if (!pts.length) return;
      window.dispatchEvent(
        new CustomEvent("bevvip:atlas-route", {
          detail: { legs: [], fit: true, fitPoints: pts },
        }),
      );
    },
    [routeFor],
  );

  /**
   * Frame the map on whatever the filters currently match.
   *
   * The villa atlas has done this since it shipped — every filter change refits
   * — and it is the reason picking a region there feels like a search. The
   * collection atlases only ever framed a deep-linked shortlist, so choosing
   * "Antarctica" from the rail updated the card list and left the camera over
   * Europe: the results were on the map, just off screen.
   *
   * Deliberately coarser than fitOfferings: stops (or the drawn path where a
   * collection has no named stops), never the full route geometry. A bounding
   * box is settled by outliers, and asking framePoints() to sort a quarter of a
   * million coordinates on every filter click is a hitch you can feel. The
   * stride sample caps that work for the widest filters, where the box is
   * enormous anyway and a few dropped points cannot move it.
   */
  const fitFilterResults = useCallback((list: AtlasOffering[]) => {
    const pts: [number, number][] = [];
    for (const o of list) {
      if (o.stops.length) {
        for (const s of o.stops) if (s.at) pts.push([s.at[0], s.at[1]]);
      } else {
        for (const c of o.path) pts.push([c[0], c[1]]);
      }
    }
    if (!pts.length) return;
    const stride = Math.ceil(pts.length / FIT_POINT_CAP);
    const sample = stride > 1 ? pts.filter((_, i) => i % stride === 0) : pts;
    window.dispatchEvent(
      new CustomEvent("bevvip:atlas-route", {
        detail: { legs: [], fit: true, fitPoints: sample },
      }),
    );
  }, []);

  const byId = useMemo(() => new Map(filtered.map((o) => [o.id, o])), [filtered]);

  /** Hover previews a route — but never over a pinned one. 170ms debounce
   *  matches the original, so dragging the pointer across the grid doesn't
   *  thrash the map. */
  const previewRoute = useCallback(
    (o: AtlasOffering) => {
      if (pinnedId) return;
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => emitRoute(o), 170);
    },
    [pinnedId, emitRoute],
  );

  /** Leaving a card restores the pinned route, or clears when nothing is pinned. */
  const endPreview = useCallback(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (pinnedId) {
      const pinned = byId.get(pinnedId);
      if (pinned) emitRoute(pinned);
      return;
    }
    emitRoute(null);
  }, [pinnedId, byId, emitRoute]);

  /** Click pins; clicking the pinned card again releases it. */
  const togglePin = useCallback(
    (o: AtlasOffering) => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      if (pinnedId === o.id) {
        setPinnedId(null);
        emitRoute(null);
        return;
      }
      setPinnedId(o.id);
      emitRoute(o, true);
      /*
       * Bring the map back for the click — at every width, and only when it has
       * actually scrolled away.
       *
       * Phones used to be excluded because the map was pinned to the top of the
       * frame and could never be off screen. Pinning is gone (see THE PAGE
       * SCROLLS in globals.css): a phone scrolls the whole page like desktop
       * does, so it has exactly the desktop problem — you click the fortieth
       * card and trace a route onto a map a screen and a half above you. One
       * layout, one rule, and this is the piece of pinning worth keeping.
       *
       * Only when it has scrolled away: a card clicked while the map is already
       * on screen must not move the page under the pointer.
       */
      /*
       * On a phone, where the dossier opens INSIDE the card, the two things the
       * traveller now needs on screen are the building and the card under it —
       * so the card is what gets scrolled to, and the map band above it stays
       * put because it is sticky while a property is open. `scroll-margin-top`
       * on the pinned card (globals.css) is what keeps the landing clear of the
       * stuck map; without it the card would arrive underneath it.
       *
       * Refs rather than deps: `detailFor` is an inline arrow in every caller,
       * so reading it from the closure would rebuild this callback — and with
       * it every card's handler — on each render.
       */
      const card = cardRefs.current.get(o.id);
      if (inlineOkRef.current && card) {
        // After the commit: the card is only offset from the stuck map once
        // `data-pinned` is on it, and it only expands once the panel is in it.
        requestAnimationFrame(() => card.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      }
      const box = mapWrapRef.current?.getBoundingClientRect();
      if (!box) return;
      const visible = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
      if (visible < box.height * 0.5) {
        mapWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [pinnedId, emitRoute],
  );

  /**
   * An arriving `engine=3d` opens on photoreal.
   *
   * Applied once, like every other arrival intent on this page: after that the
   * engine belongs to whoever is looking at the map, and re-applying it would
   * yank someone back to 3D every time the URL changed under a filter.
   */
  const arrivedEngine = useRef(false);
  useEffect(() => {
    if (arrivedEngine.current || !photoreal) return;
    /*
     * Wait for the deep link to have been PARSED before latching.
     *
     * `parsed` is null until the collection's feed resolves (it needs `ctx` to
     * know this atlas's regions and stop names), so this effect's first run
     * happens with nothing to read. Latching there consumed the one chance to
     * act and left `?engine=3d` and `?hotel=` opening on Mapbox — the arriving
     * intent was dropped a beat before it existed.
     */
    if (!parsed) return;
    arrivedEngine.current = true;
    if (parsed?.view.engine === "photoreal") {
      setEngine("photoreal");
      return;
    }
    /*
     * A single-property deep link (`?hotel=<id>`) opens on the building.
     *
     * Someone following a link to ONE property is not browsing — they were sent
     * a place to look at. That link used to route to the standalone 3D page for
     * exactly this reason, and it must keep meaning the same thing now the
     * engine lives here. A `trip=`/`ids=` share is different: those carry their
     * own engine, so an absent one there means Mapbox.
     */
    const propertyLink = (descriptor.extraIdParams || []).some((p) => searchParams.get(p));
    if (propertyLink) setEngine("photoreal");
  }, [parsed, photoreal, descriptor, searchParams]);

  /**
   * A deep link that resolves to exactly one trip opens it — pinned, traced and
   * framed. The Leaflet atlas did this in highlightDeepLinkIds():
   * `if (state.ids.size === 1 && hit.length === 1) openDetail(hit[0])`.
   * Without it, /atlas/train?ids=15694760 shows the whole globe and leaves the
   * traveller to find their own journey in the grid.
   */
  const autoPinned = useRef(false);
  useEffect(() => {
    if (autoPinned.current || !state) return;
    if (!state.ids.size || filtered.length !== 1) return;
    autoPinned.current = true;
    setPinnedId(filtered[0].id);
    emitRoute(filtered[0], true);
  }, [state, filtered, emitRoute]);

  /**
   * A region pin filters to that region. Toggling: clicking the pin of the
   * region you are already in clears it, so the map is a filter control rather
   * than a one-way trip. Writes through the URL like every other filter, so the
   * rail's Region select follows and the link stays shareable.
   */
  const selectRegion = useCallback(
    (regionKey: string) => {
      if (!state) return;
      const already = state.regions.size === 1 && state.regions.has(regionKey);
      writeUrl({ ...state, regions: new Set(already ? [] : [regionKey]) }, query);
    },
    [state, query, writeUrl],
  );

  /**
   * Build a link that reproduces exactly what is on screen and copy it.
   *
   * This is an advisor tool: the share has to carry the filters (regions,
   * supplier, ships, month, port/location + role, free text), the pinned
   * journey, AND the view — basemap, 2D/3D, and the exact camera. A link that
   * only carries filters drops the client into a different-looking map.
   */
  const share = useCallback(async () => {
    if (!state) return;
    const v = viewRef.current;
    const qs = toSearchParams(
      state,
      {
        ...(parsed?.view ?? {}),
        trip: pinnedId,
        style: v?.style ?? initialStyle ?? null,
        flat: v ? !v.globe : initialGlobe === false,
        // A link shared from the photoreal view opens on it. "Look at THIS,
        // like THIS" has to say which engine was drawing.
        engine: engine === "photoreal" ? "photoreal" : null,
        camera: v
          ? { lng: v.center.lng, lat: v.center.lat, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing }
          : null,
      },
      descriptor,
      { q: query.q, country: query.country },
    );
    const url = `${window.location.origin}/atlas/${type}${qs.toString() ? `?${qs}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 1600);
    } catch {
      // Clipboard can be blocked; put it in the URL bar so it is still copyable.
      router.replace(url.replace(window.location.origin, ""), { scroll: false });
    }
  }, [state, parsed?.view, pinnedId, descriptor, query, type, router, initialStyle, initialGlobe, engine]);

  // `trip=` pins a journey, the same param the Leaflet Share button emitted.
  const autoTripped = useRef(false);
  /**
   * Arriving from the Guide's "Open in the Atlas": frame what was sent.
   *
   * This used to key off `trip=` alone, which only the atlas's own Share button
   * emits. The Guide sends `ids=` — so every chat handoff except a single
   * hotel landed on an unmoved map with no route traced: the shortlist was
   * correctly filtered in the card list and completely invisible on the globe.
   * (Hotels appeared to work only because they had a bespoke `ids` fallback.)
   *
   * Three cases, because framing a set is not the same gesture as tracing one:
   *   trip=            the atlas's own link — pin and trace it
   *   one result       the same thing: pin, trace, fly
   *   several results  fit ALL of them. Tracing one of five would be an
   *                    arbitrary choice presented as an answer.
   */
  useEffect(() => {
    if (autoTripped.current || !filtered.length || !state) return;
    const explicit = parsed?.view.trip;
    if (!explicit && !state.ids.size) return;

    // For collections where `ids` filters, `filtered` IS the shortlist; for
    // highlight-only ones (hotels) it is the whole field, so match explicitly.
    const shortlist = state.ids.size
      ? filtered.filter((o) => o.idAliases.some((a) => state.ids.has(a)))
      : [];

    const wanted = explicit || (shortlist.length === 1 ? shortlist[0].id : null);
    if (wanted) {
      const hit = filtered.find((o) => o.idAliases.includes(wanted) || o.id === wanted);
      if (hit) {
        autoTripped.current = true;
        setPinnedId(hit.id);
        emitRoute(hit, !parsed?.view.camera); // an explicit camera wins over fitting
        return;
      }
    }
    if (shortlist.length > 1) {
      autoTripped.current = true;
      if (!parsed?.view.camera) fitOfferings(shortlist);
    }
  }, [parsed?.view.trip, parsed?.view.camera, filtered, emitRoute, fitOfferings, state]);

  /**
   * The filters, canonicalized — and ONLY the filters.
   *
   * `searchParams.toString()` is the wrong key here: it also carries the
   * basemap, the 2D/3D flag, the camera and `sort`, so panning the globe or
   * re-sorting the cards would read as a filter change and re-fly the camera
   * out from under whoever just moved it. Reusing toSearchParams with an empty
   * view is exactly the filter half of the deep-link contract.
   */
  const filterKey = useMemo(
    () =>
      state
        ? toSearchParams(state, {}, descriptor, { q: query.q, country: query.country }).toString()
        : "",
    [state, descriptor, query],
  );

  /**
   * Refit the globe whenever the filters change — the villa atlas's behaviour,
   * which is what makes its rail feel like a search rather than a legend.
   *
   * The FIRST key this ever sees is the one the page arrived with, and that
   * frame belongs to someone else: an explicit camera in the link, a `trip=`
   * being traced, or the shortlist effect above. So arrival is recorded and
   * stood down from; only a change the traveller made moves the camera.
   */
  const lastFitKey = useRef<string | null>(null);
  useEffect(() => {
    if (!state || !offerings) return; // nothing to frame until the feed lands
    if (lastFitKey.current === null) {
      lastFitKey.current = filterKey; // the arriving view owns the camera
      return;
    }
    if (lastFitKey.current === filterKey) return;
    // A traced journey is the more specific intent, so it keeps the camera —
    // and the key stays UNCONSUMED, so the moment the trace is released (by
    // hand, or by a filter that removed it from the list) the globe catches up
    // to the filters instead of sitting on a route that is no longer shown.
    if (pinnedId) return;
    lastFitKey.current = filterKey;
    if (!filterKey) return; // filters cleared — leave the globe where it is
    if (!filtered.length) return; // nothing matched; an empty frame says nothing
    fitFilterResults(filtered);
  }, [filterKey, filtered, state, offerings, pinnedId, fitFilterResults]);

  // A pinned trip that filtering removes from the list should release its pin.
  useEffect(() => {
    if (pinnedId && !byId.has(pinnedId)) {
      setPinnedId(null);
      emitRoute(null);
    }
  }, [pinnedId, byId, emitRoute]);

  /**
   * The filtered set, as points the photoreal engine can draw.
   *
   * Built from `filtered` rather than from every offering, so switching engines
   * preserves the rail: someone who narrowed to Alpine ski properties and
   * flipped to 3D should see those, not all 2,501 again. Offerings without a
   * located stop are simply absent — a hotel with no coordinate cannot be a
   * building you look at.
   */
  const photorealPoints = useMemo<Point3D[]>(() => {
    if (!photoreal) return [];
    const out: Point3D[] = [];
    for (const o of filtered) {
      const at = o.stops.find((st) => st.at)?.at;
      if (!at) continue;
      out.push({
        id: o.id,
        lng: at[0],
        lat: at[1],
        name: o.title,
        category: (o.attributes?.category as string | null) ?? null,
      });
    }
    return out;
  }, [photoreal, filtered]);

  const pinned = pinnedId ? byId.get(pinnedId) ?? null : null;

  /*
   * THE DOSSIER'S TWO HOMES.
   *
   * Beside the map on desktop, where a 340px panel costs nothing. Inside the
   * open card on a phone, where it cost everything: the panel was a bottom
   * sheet over a map band already clamped to 240-400px, so opening the details
   * left about 150px of building — the photoreal engine's whole argument,
   * reduced to a strip. The card list sits directly under the map on a phone
   * (the filter rail is a fixed bottom bar there, not a block in the flow), so
   * "building above, details in the card beneath" is the page's own order.
   *
   * Only when the property HAS a card on screen. A `?hotel=` deep link or a pin
   * tap can select something outside the first CARD_LIMIT cards, and there is
   * nothing to expand then — those keep the sheet, which is still correct, just
   * no longer the common case.
   */
  const inlineCapable = phone && !!detailFor;
  const inlineDetail = inlineCapable && !!pinned && visible.some((o) => o.id === pinned.id);
  inlineOkRef.current = inlineCapable;

  /** Closing is the same act from the panel's ✕, the card button and the pin. */
  const closeDetail = useCallback(() => {
    setPinnedId(null);
    emitRoute(null);
  }, [emitRoute]);

  if (failed) {
    return (
      <div className={`atlas-collection atlas-collection--${type}`}>
        <p className="atlas-empty">
          This collection could not be loaded.{" "}
          <a href={`/maps/${type}/index.html`}>Open the standalone atlas →</a>
        </p>
      </div>
    );
  }

  return (
    <div className={`atlas-collection atlas-collection--${type}`}>
      {/* `stuck`: on a phone with the dossier in the card, the map band sticks
          to the top of the viewport so the building stays on screen while the
          details are read beneath it. Scoped to an open property on purpose —
          the permanent pinned map this page used to have is not coming back
          (see THE PAGE SCROLLS in globals.css); the page still scrolls. */}
      <div ref={mapWrapRef} className={`atlas-mapwrap${inlineDetail ? " stuck" : ""}`}>
      {/* No routesAlways for rail: an ambient layer of every route at once is
          not what the Leaflet atlas did, and for trains it would have to be
          drawn from arcs, which is wrong. Routes trace one at a time from real
          geometry on card hover/click — see traceRoute. */}
      <AtlasShell
        type={type}
        region={null}
        externalLink={internalAtlasLink(type)}
        // No ambient web of every route. A collection page traces ONE route;
        // drawing all of them underneath buries it.
        ambientRoutes={false}
        onRegionSelect={selectRegion}
        accent={accent}
        // A shared link's basemap/projection/camera override the collection's
        // own defaults — the whole point of sharing a view.
        initialStyle={(parsed?.view.style as StyleKey | null) ?? initialStyle}
        initialGlobe={parsed?.view.flat ? false : initialGlobe}
        initialCamera={parsed?.view.camera ?? null}
        onViewChange={(v) => { viewRef.current = v; }}
        // The engine choice. Points are the filtered set and the selection is
        // the pinned card, so 3D is a view OF this browse rather than a
        // separate browse — the whole reason it stopped being a second page.
        photoreal={
          photoreal
            ? {
                points: photorealPoints,
                selectedId: pinnedId,
                onSelect: (id: string) => {
                  const hit = byId.get(id);
                  if (hit) togglePin(hit);
                },
                engine,
                onEngineChange: setEngine,
              }
            : undefined
        }
        // No Share on the map here — this page's Share is in the filter rail,
        // where the filters that make up most of the link already live. The
        // shell reports the camera up (onViewChange) and the rail sends it.
      />
      {/*
        The selected offering's own panel, over the map.

        Hotels put the property dossier here — the description, ratings,
        address, program, VIP benefits and rate access code that used to exist
        only inside the standalone 3D page. It rides the SAME selection as the
        card list and the map pin, so clicking a card, clicking a pin and
        arriving on a ?hotel= link all end in the same place.
      */}
      {detailFor && pinned && !inlineDetail && (
        <div className="atlas-detail" onClick={(e) => e.stopPropagation()}>
          {detailFor(pinned, { close: closeDetail })}
        </div>
      )}
      {/*
        Sits over the map rather than in the filter rail on purpose: it is a
        question about the map ("what is in THIS view?"), and its answer changes
        every time the camera moves. A control for that belongs where the
        gesture happens.
      */}
      <div className="atlas-area-ctrl" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="actrl"
          onClick={searchThisArea}
          title="Limit the list below to what is in the current map view"
        >
          ⌖ Search this area
        </button>
        {areaBox && (
          <button
            type="button"
            className="actrl area-clear"
            onClick={() => setAreaBox(null)}
            title="Show results from everywhere again"
          >
            ✕ Clear area
          </button>
        )}
      </div>
      </div>

      {state && offerings ? (
        <AtlasFilterRail
          descriptor={descriptor}
          offerings={offerings}
          state={state}
          query={query}
          regionLabels={regionLabels}
          today={today}
          onStateChange={(next) => writeUrl(next, query)}
          onQueryChange={(next) => state && writeUrl(state, next)}
          onCommit={(nextState, nextQuery) => writeUrl(nextState, nextQuery)}
          onShare={share}
          shareLabel={shared ? "Link copied" : "Share"}
          trailing={
            <>
              {filtered.length > CARD_LIMIT && (
                <span className="atlas-showing">first {CARD_LIMIT}</span>
              )}
              {sortModes.length > 1 && (
                <label className="atlas-sort">
                  <span>Sort</span>
                  <select
                    value={sort}
                    onChange={(e) => setSort(readSort(e.target.value, defaultSort, sortModes))}
                    aria-label="Sort results"
                  >
                    {sortModes.map((m) => (
                      <option key={m} value={m}>{SORT_LABELS[m]}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          }
        />
      ) : (
        <div className="villa-filters" aria-busy="true">
          <span className="atlas-count">Loading…</span>
        </div>
      )}

      {/* Guaranteed scroll target between the map and the cards. Mapbox eats
          vertical drags, so without this the only grabbable area on a phone is
          whatever gap is left over — which was a few pixels. */}
      <div className="atlas-scrollcue">
        {/*
          An explicit way out of a traced route.
          Releasing a pin was only possible by finding the same card again and
          clicking it a second time — an undo whose control is wherever you
          happened to leave the list, and invisible if you scrolled or filtered
          since. Naming what is traced also answers "which one is this?" without
          hunting for the highlighted card.
        */}
        {pinnedId && byId.get(pinnedId) ? (
          <>
            <span className="atlas-tracing">
              Tracing <strong>{byId.get(pinnedId)!.title}</strong>
            </span>
            <button
              type="button"
              className="atlas-untrace"
              onClick={() => { setPinnedId(null); emitRoute(null); }}
            >
              Clear route
            </button>
          </>
        ) : (
          <>
            {filtered.length.toLocaleString()} {filtered.length === 1 ? "result" : "results"}
            {/* Say WHY the number is what it is. A count that silently drops
                because the map moved is the same unanswerable question the
                120-card cap used to pose. */}
            {areaBox && <span className="atlas-areaflag"> in this map area</span>}
          </>
        )}
      </div>

      {/*
        MOBILE ONLY (CSS hides it above 680px).
        On desktop the same two things now ride in the filter rail via its
        `trailing` slot — one row instead of a rail, a count line and a sort
        line all describing the same result set. On phones the rail collapses to
        a Filters pill with no room for them, so they keep this bar.
      */}
      {sortModes.length > 1 && (
        <div className="atlas-sortbar">
          {/* Say so when the list is truncated. 120 of 3,239 was silent before,
              which made "where did the sailing I just saw go?" unanswerable. */}
          <span className="atlas-showing">
            {filtered.length > CARD_LIMIT
              ? `Showing the first ${CARD_LIMIT} of ${filtered.length.toLocaleString()}`
              : ""}
          </span>
          <label className="atlas-sort">
            <span>Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(readSort(e.target.value, defaultSort, sortModes))}
              aria-label="Sort results"
            >
              {sortModes.map((m) => (
                <option key={m} value={m}>{SORT_LABELS[m]}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="atlas-results">
        {visible.map((o) => {
          const attr = (key: string) => {
            const value = o.attributes?.[key];
            return Array.isArray(value) ? value[0] : value;
          };
          const whenLine = [
            // Start, end and year for anything dated; the booking window for
            // on-demand journeys; "On demand" for the rest. Hotels have no
            // date line, by design.
            whenLabelFor(o),
            o.departures && o.departures > 1 ? `${o.departures} departures` : null,
          ].filter(Boolean).join("  ·  ");
          const metaParts =
            type === "hotel"
              ? [o.brandLabel || o.operator, attr("category"), o.country]
              : [
                  o.vessel || o.brandLabel || o.operator,
                  o.days ? `${o.days} days` : null,
                  o.stops.length ? `${o.stops.length} stops` : null,
                ];
          return (
            <article
              key={o.id}
              ref={(el) => {
                if (el) cardRefs.current.set(o.id, el);
                else cardRefs.current.delete(o.id);
              }}
              className={`atlas-card${o.world ? " world" : ""}`}
              data-id={o.id}
              data-pinned={pinnedId === o.id ? "" : undefined}
              onMouseEnter={() => previewRoute(o)}
              onMouseLeave={endPreview}
              onFocus={() => previewRoute(o)}
              onBlur={endPreview}
              onClick={() => togglePin(o)}
            >
              <div className="ac-head">
                {/* Look the mark up by whichever field this collection filters
                    on. cruise has NO brand — its marks are keyed by operator
                    name — so a `o.brand`-only lookup silently dropped every
                    cruise logo. */}
                {(() => {
                  const markKey = o.logoKey ?? (descriptor.brandField === "operator" ? o.operator : o.brand);
                  if (!markKey && !o.operator) return null;
                  return (
                    <BrandLogo
                      brand={
                        brandMarks[markKey || ""] || {
                          key: markKey || o.operator || "",
                          short: o.brandLabel || o.operator,
                        }
                      }
                      assetBase={logoBase}
                    />
                  );
                })()}
                <div className="ac-headtext">
                  <h3>{o.title}</h3>
                  {/* Date line, mirroring the original's three non-hotel cases:
                      a real range (plus a departures count when the product runs
                      many dates), an on-demand window, or nothing scheduled. */}
                  {whenLine && <p className="ac-when">{whenLine}</p>}
                </div>
              </div>

              <p className="ac-meta">
                {metaParts.filter(Boolean).join("  ·  ")}
              </p>

              {/*
                The route as text, so a card is readable without the map — but
                ONLY where there is no day-by-day block to say the same thing
                better. Printed above an itinerary it was pure duplication, and
                expensive duplication: a 27-stop Alaska sailing spent 417px on
                an arrow-separated wall of port names that the collapsed
                itinerary below it covers in one line. Since the results are a
                grid, that one card also set the height of every card in its
                row — the whole list arrived looking expanded.
              */}
              {o.stops.length > 1 && o.itinerary.length === 0 && (
                <p className="ac-path">{o.stops.map((st) => st.name).join(" → ")}</p>
              )}

              {o.itinerary.length > 0 && (
                <details className="ac-itin" onClick={(e) => e.stopPropagation()}>
                  <summary>Day-by-day itinerary</summary>
                  {o.itinerary.map((r, i) => (
                    <div className="ac-dayline" key={`${r.name}-${i}`}>
                      <b>{dayRange(r.startDay, r.endDay)}</b>
                      {r.startDate ? ` · ${fmtDay(r.startDate)}` : ""} · {r.name}
                    </div>
                  ))}
                </details>
              )}

              <div className="ac-actions">
                {/* The two boxed actions sit together, then the plain links.
                    Splitting them with "View details" made a matched pair read as
                    two unrelated controls. */}
                {cardPrimary?.(o)}
                {cardAction && (() => {
                  // What the label is being drawn against: which renderer is
                  // painting, and whether this card is the open one.
                  const st: CardActionState = { engine, open: pinnedId === o.id };
                  const text = (v: string | ((s: CardActionState) => string)) =>
                    typeof v === "function" ? v(st) : v;
                  return (
                    <button
                      type="button"
                      className="ac-3d"
                      title={cardAction.title ? text(cardAction.title) : undefined}
                      aria-expanded={inlineDetail && st.open ? true : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        cardAction.onSelect(o, {
                          ...st,
                          select: () => {
                            if (pinnedId !== o.id) togglePin(o);
                          },
                          showPhotoreal: () => {
                            if (photoreal) setEngine("photoreal");
                          },
                          close: closeDetail,
                        });
                      }}
                    >
                      {text(cardAction.label)}
                    </button>
                  );
                })()}
                {o.url && (
                  <a
                    className="ac-link"
                    href={o.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View details ↗
                  </a>
                )}
                {/*
                  Same escape hatch the Leaflet cards had: ask instead of filter.

                  What it SENDS changed. It used to be the title and a listing
                  URL — "Hotel Name (listing: …)" — so The Guide had to
                  re-derive the city, the country, the program and the category
                  it had just been shown, or ask the traveller to repeat what
                  was on screen. Now the question carries them (lib/atlas/ask),
                  and it is delivered into the chat mounted on this page rather
                  than navigating to the home one.
                */}
                <button
                  type="button"
                  className="ac-ask"
                  onClick={(e) => {
                    e.stopPropagation();
                    const text = askAboutProperty({
                      name: o.title,
                      city: (o.attributes?.city as string | null) ?? null,
                      country: o.country,
                      region: regionLabels[o.regions[0]] ?? o.regions[0] ?? null,
                      category: (o.attributes?.category as string | null) ?? null,
                      program: (o.attributes?.program as string | null) ?? null,
                      brand: o.brandLabel,
                      url: o.url,
                    });
                    if (!askGuide(text, "card")) router.push(askGuideHref(text, type));
                  }}
                >
                  ✦ Ask The Guide
                </button>
              </div>

              {/* The dossier, on a phone: under this card's own actions, with
                  the building held above it by the stuck map band. */}
              {inlineDetail && pinnedId === o.id && detailFor && (
                <div className="ac-detail" onClick={(e) => e.stopPropagation()}>
                  {detailFor(o, { close: closeDetail })}
                </div>
              )}
            </article>
          );
        })}
        {!!filtered.length && filtered.length > 120 && (
          <p className="atlas-more">
            Showing 120 of {filtered.length.toLocaleString()} — narrow the filters to see the rest.
          </p>
        )}
        {state && offerings && !filtered.length && (
          <p className="atlas-empty">Nothing matches those filters.</p>
        )}
      </div>
    </div>
  );
}

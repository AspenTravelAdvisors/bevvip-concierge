"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GuideMeta, GuideToolMeta, OfferingResult, OfferingType, TripState } from "@/lib/types";
import { atlasRegionQuery, internalAtlasLink, isOfferingType } from "@/lib/atlas-config";
import type { NormalizedOffering } from "@/lib/offering-shape";
import { bookingLink } from "@/lib/atlas/booking.js";
import { getTrip, onTrip, setTrip as persistTrip } from "@/lib/trip-state";
import { atlasOpened, bookingClicked } from "@/lib/analytics";

// The shared trip drives the hotel booking CTAs: bookingLink prices the
// captured dates and party (tomorrow-night default), and hotel atlas links
// carry the trip so the embedded atlas prices the same stay.
function useTrip(): TripState | null {
  const [trip, setTrip] = useState<TripState | null>(null);
  useEffect(() => {
    setTrip(getTrip());
    return onTrip(setTrip);
  }, []);
  return trip;
}

// Cap cards per brand within a category (so one operator can't flood the row),
// not per category — a two-brand comparison ("Aman vs Orient Express") and an
// open search that surfaced several operators must show every brand, not just
// whichever the last tool happened to fill the category bucket with.
const GUIDE_CARD_LIMIT_PER_BRAND = 5;
// Three, not five. Five cards plus a group CTA plus a per-card booking link
// plus the advisor CTA gave every answer four competing next-actions; the eye
// has to price all of them before it can act. Three examples and an honest
// count of the rest reads faster and says more.
const GUIDE_CARD_LIMIT_TOTAL = 3;

// Inventory cards built from the Guide's meta frame.
//
// The action hierarchy here is deliberate and is the whole point of the
// component. Before, a single hotel answer offered: "Open in Atlas →" on each
// card, "Book VIP rate →" on each card, "Open in the Atlas →" beneath the row,
// and the advisor CTA below that — two of them worded almost identically and
// meaning different things (one property vs. the whole shortlist). Now:
//
//   primary   — the advisor CTA (rendered by GuideChat's ChatMoves, below)
//   secondary — the map: the card itself, and one group link scoped by count
//   tertiary  — booking, hotels only, only once real dates exist
export default function ResultCards({ meta }: { meta: GuideMeta }) {
  const cards = collectResultCards(meta);
  const trip = useTrip();
  const ctaHref = internalLeadLink(meta, trip);
  const total = totalResults(meta);
  const hidden = Math.max(0, total - cards.length);

  if (!cards.length && !ctaHref) return null;

  const leadType = leadOfferingType(meta);

  return (
    <div>
      {cards.length > 0 && (
        <div className="cards">
          {cards.map(({ result, type }, i) => (
            <Card
              key={`${type}:${result.id ?? result.name ?? i}`}
              result={result}
              fallbackType={type}
              trip={trip}
            />
          ))}
        </div>
      )}
      {/* One map link, worded by what it actually opens — and only when there
          is something beyond the cards to see. When every result is already on
          screen, the cards are the link. */}
      {ctaHref && hidden > 0 && (
        <div>
          <Link
            className="atlas-cta"
            href={ctaHref}
            onClick={() => atlasOpened(leadType ?? "", "shortlist")}
          >
            See all {total} on the map →
          </Link>
        </div>
      )}
    </div>
  );
}

function totalResults(meta: GuideMeta): number {
  const seen = new Set<string>();
  for (const tool of meta.tools ?? []) {
    for (const r of tool.results ?? []) {
      seen.add(`${r.id ?? ""}|${r.name ?? ""}|${String(r.startDate ?? "")}`);
    }
  }
  return seen.size;
}

function leadOfferingType(meta: GuideMeta): OfferingType | null {
  const tools = [...(meta.tools ?? [])].reverse();
  const tool = tools.find((t) => (t.results ?? []).length > 0) ?? tools[0];
  return normalizeType(String(tool?.type ?? tool?.input?.type ?? ""));
}

function collectResultCards(meta: GuideMeta): Array<{ result: OfferingResult; type: OfferingType | null }> {
  const cards: Array<{ result: OfferingResult; type: OfferingType | null }> = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const add = (result: OfferingResult | undefined, rawType: unknown) => {
    if (!result) return;
    if (cards.length >= GUIDE_CARD_LIMIT_TOTAL) return;
    const type = normalizeType(String(result.type ?? rawType ?? ""));
    const brandKey = String(result.brand ?? result.operator ?? "").toLowerCase().trim();
    const bucket = `${type ?? "other"}|${brandKey}`;
    if ((counts.get(bucket) ?? 0) >= GUIDE_CARD_LIMIT_PER_BRAND) return;
    const key = [
      bucket,
      result.id ?? "",
      result.name ?? "",
      String(result.startDate ?? ""),
      String(result.month ?? ""),
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    cards.push({ result, type });
  };

  for (const tool of [...(meta.tools ?? [])].reverse()) {
    const toolType = tool.type ?? tool.input?.type;
    for (const result of tool.results ?? []) add(result, toolType);
    for (const rel of relatedEntries(tool.related)) {
      for (const result of rel.results) add(result, rel.kind);
    }
  }
  return cards;
}

function relatedEntries(raw: unknown): Array<{ kind?: string; results: OfferingResult[] }> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is { kind?: string; results: OfferingResult[] } => {
    if (!entry || typeof entry !== "object") return false;
    const results = (entry as { results?: unknown }).results;
    return Array.isArray(results);
  });
}

function Card({
  result,
  fallbackType,
  trip,
}: {
  result: OfferingResult;
  fallbackType: OfferingType | null;
  trip: TripState | null;
}) {
  const kicker =
    result.brand || result.operator || result.category || fallbackType || "Offering";
  const where = [
    result.city,
    result.country,
    result.region,
    cardDuration(result),
    cardDate(result),
  ]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <span className="kicker">{String(kicker)}</span>
      <span className="name">{result.name || "Untitled"}</span>
      {where && <span className="where">{where}</span>}
      {/* Was "Open in Atlas →", which sat one line above a group CTA reading
          "Open in the Atlas →". Two near-identical labels, different scopes. */}
      <span className="open">See on the map →</span>
    </>
  );

  // The atlas link covers most of the card. We reuse the query the standalone
  // deep link carried (region + ids) so the embedded atlas focuses the same
  // record; otherwise fall back to the result's region. Hotel links also carry
  // the captured trip so the atlas's own booking CTA prices the same stay.
  const href = withTripQuery(internalCardLink(result, fallbackType), fallbackType, trip);
  const atlasLink = href ? (
    <Link
      className="card-link"
      href={href}
      onClick={() => atlasOpened(String(fallbackType ?? ""), "card")}
    >
      {body}
    </Link>
  ) : (
    <div className="card-link">{body}</div>
  );

  return (
    <div className="card">
      {atlasLink}
      <CardBooking result={result} trip={trip} type={fallbackType} />
    </div>
  );
}

/**
 * The tertiary booking affordance, rendered as a sibling of the card's <a> so
 * anchors never nest.
 *
 * The important behavior is the dateless case. `bookingLink` will happily build
 * a TravelWits search using an invented tomorrow-night stay, which is how a
 * traveler planning next spring ended up on a list priced for tonight. When
 * `needsDates` is set we don't link at all — we ask, inline, and only then send
 * them somewhere real. One extra step; every click lands on a true search.
 */
function CardBooking({
  result,
  trip,
  type,
}: {
  result: OfferingResult;
  trip: TripState | null;
  type: OfferingType | null;
}) {
  const [asking, setAsking] = useState(false);
  const booking = bookingLink(result, trip);
  if (!booking) return null;

  const kindClass = booking.kind === "deep" ? " deep" : "";
  // The access code, always shown alongside a link that leaves for TravelWits —
  // as secondary text beneath the CTA, never inside the button (BOOKING-SPEC:
  // on the CTA itself it reads as a barrier at the moment of intent).
  const code = booking.note ? <span className="card-book-code">{booking.note}</span> : null;

  if (booking.kind === "deep" && booking.needsDates) {
    return asking ? (
      <>
        <BookingDates
          result={result}
          trip={trip}
          onCancel={() => setAsking(false)}
          onDone={() => setAsking(false)}
        />
        {code}
      </>
    ) : (
      <>
        <button type="button" className={`card-book${kindClass}`} onClick={() => setAsking(true)}>
          {booking.label} →
        </button>
        {code}
      </>
    );
  }

  const stay = booking.stay;
  return (
    <>
      <a
        className={`card-book${kindClass}`}
        href={booking.url}
        target="_blank"
        rel="noreferrer"
        onClick={() => bookingClicked(String(type ?? ""), !booking.needsDates)}
      >
        {booking.label} {booking.kind === "deep" ? "→" : "↗"}
        {/* The dates being searched, said before the click rather than
            discovered after it. */}
        {stay && <span className="card-book-note">{formatStay(stay.checkIn, stay.checkOut)}</span>}
      </a>
      {code}
    </>
  );
}

/** Two dates, inline, so the link that follows is priced for a real stay. */
function BookingDates({
  result,
  trip,
  onCancel,
  onDone,
}: {
  result: OfferingResult;
  trip: TripState | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const ready = !!checkIn && !!checkOut && checkOut > checkIn;

  const go = () => {
    if (!ready) return;
    // Persist first: the trip is shared, so every other card's CTA lights up
    // with the same dates the moment this one is answered.
    const next = persistTrip(
      {
        destination: trip?.destination ?? (result.city as string) ?? null,
        checkIn,
        checkOut,
        adults: trip?.adults ?? 2,
        childrenAges: trip?.childrenAges ?? [],
      },
      "strip",
    );
    const link = bookingLink(result, next);
    bookingClicked(String(result.type ?? ""), true);
    if (link?.url) window.open(link.url, "_blank", "noopener,noreferrer");
    onDone();
  };

  return (
    <div className="card-dates">
      <div className="cd-cap">Which nights?</div>
      <div className="cd-row">
        <input
          type="date"
          aria-label="Check-in"
          min={today}
          value={checkIn}
          onChange={(e) => {
            setCheckIn(e.target.value);
            if (checkOut && e.target.value && checkOut <= e.target.value) setCheckOut("");
          }}
        />
        <input
          type="date"
          aria-label="Check-out"
          min={checkIn || today}
          value={checkOut}
          onChange={(e) => setCheckOut(e.target.value)}
        />
      </div>
      <div className="cd-actions">
        <button type="button" className="cd-go" disabled={!ready} onClick={go}>
          Search rates
        </button>
        <button type="button" className="cd-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function formatStay(checkIn: string, checkOut: string): string {
  const fmt = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : iso;
  };
  return `${fmt(checkIn)} – ${fmt(checkOut)}`;
}

// Build the in-app atlas link for a result. Prefer the search string the
// standalone deep link already encoded (region + forward-compatible ids), then
// fall back to the result's region, then the bare atlas.
function internalCardLink(result: OfferingResult, type: OfferingType | null): string | null {
  if (!type) return null;
  if (type === "hotel") {
    const id = resultId(result);
    if (id) return `/maps/hotel/index.html?hotel=${encodeURIComponent(id)}`;
  }
  let query = "";
  if (typeof result.deepLink === "string" && result.deepLink) {
    try {
      // Deep links are internal paths ("/maps/hotel/?ids=h_1"), so parse
      // against a placeholder base — a bare `new URL()` throws on them.
      query = new URL(result.deepLink, "http://internal.atlas").search; // e.g. "?region=MED&regions=MED&ids=y_12"
    } catch {
      /* not a parseable URL — ignore and fall back */
    }
  }
  if (!query && result.region) query = atlasRegionQuery(result.region);
  return internalAtlasLink(type, query);
}

function resultId(result: OfferingResult): string {
  if (typeof result.deepLink === "string" && result.deepLink) {
    try {
      const params = new URL(result.deepLink, "http://internal.atlas").searchParams;
      const id = params.get("hotel") || params.get("ids") || "";
      if (id.trim()) return id.trim();
    } catch {
      /* fall back to result.id below */
    }
  }
  return result.id == null ? "" : String(result.id).trim();
}

// The "Open in the Atlas" CTA target: the lead tool's type, focused on the
// chart region AND carrying every result id in the lead shortlist. The atlas
// reads `ids` to restrict the map to the shortlist, enlarge those pins, and
// frame (zoom to fit) all of them — so the CTA opens showing the whole set,
// not just the region. Individual card links still carry a single id so they
// open one property. Mirrors how the meta frame picks its lead/deepLink.
function internalLeadLink(meta: GuideMeta, trip: TripState | null): string | null {
  const tools = [...(meta.tools ?? [])].reverse();
  const tool = tools.find((t) => (t.results ?? []).length > 0) ?? tools[0];
  const type = normalizeType(String(tool?.type ?? tool?.input?.type ?? ""));
  if (!type) return null;
  const params = new URLSearchParams();
  const region = meta.chartRegion;
  if (region) {
    params.set("region", region);
    params.set("regions", region);
  }
  const ids = leadShortlistIds(tool);
  if (ids.length) params.set("ids", ids.join(","));
  const query = params.toString();
  return withTripQuery(internalAtlasLink(type, query ? `?${query}` : ""), type, trip);
}

// Append the captured trip (dates + party) to a hotel atlas link so the
// embedded atlas's booking CTA prices the same stay even when the map opens
// without the shared sessionStorage (a shared or new-tab link). Non-hotel
// atlases don't read these params, so their links stay clean.
function withTripQuery(
  href: string | null,
  type: OfferingType | null,
  trip: TripState | null,
): string | null {
  if (!href || type !== "hotel" || !trip) return href;
  const url = new URL(href, "http://internal.atlas");
  if (trip.checkIn && trip.checkOut) {
    url.searchParams.set("checkIn", trip.checkIn);
    url.searchParams.set("checkOut", trip.checkOut);
  }
  if (trip.adults >= 1) url.searchParams.set("adults", String(trip.adults));
  if (trip.childrenAges.length) url.searchParams.set("childrenAges", trip.childrenAges.join(","));
  return `${url.pathname}${url.search}`;
}

// Collect the ids of the lead tool's results — the shortlist the cards show —
// preferring the id the per-result deep link already encoded (so the format
// always matches what the atlas markers key on), falling back to result.id.
function leadShortlistIds(tool: GuideToolMeta | undefined): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const result of tool?.results ?? []) {
    let id = "";
    if (typeof result.deepLink === "string" && result.deepLink) {
      try {
        id = new URL(result.deepLink, "http://internal.atlas").searchParams.get("ids") ?? "";
      } catch {
        /* not a parseable URL — fall back to result.id */
      }
    }
    if (!id && result.id != null) id = String(result.id);
    id = id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// The cruise/yacht/world-cruise atlases carry departure timing as `startDate`
// (an ISO day for expedition cruises, an already-friendly range for yachts and
// world cruises) plus a `month` ("YYYY-MM") fallback — never the `dates` field
// hotels would use. Surface whichever real value the record has so cruise cards
// always show a date.
/**
 * The normalized view attached by lib/offering-shape.ts, when present.
 *
 * `search_offerings` attaches it to every result now. The local derivations
 * below are kept as a FALLBACK rather than deleted, because GuideMeta is
 * replayed from sessionStorage (`bevvip:atlas:last-plot`) — a plot stored
 * before this shipped would otherwise come back with no dates and no duration
 * on any card.
 */
function normalized(result: OfferingResult): NormalizedOffering | null {
  const n = result.normalized;
  return n && typeof n === "object" ? (n as NormalizedOffering) : null;
}

function cardDate(result: OfferingResult): string | null {
  const n = normalized(result);
  if (n) return n.whenLabel;
  const raw = result.dates ?? (result.startDate as unknown);
  if (typeof raw === "string" && raw.trim()) {
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      const [, y, m, d] = iso;
      const month = MONTHS[Number(m) - 1];
      return month ? `${Number(d)} ${month} ${y}` : raw;
    }
    return raw;
  }
  const month = result.month as unknown;
  if (typeof month === "string") {
    const m = month.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      const label = MONTHS[Number(m[2]) - 1];
      return label ? `${label} ${m[1]}` : month;
    }
  }
  return null;
}

// Trip length: hotels carry `duration`; cruises carry `nights`, world cruises
// carry `days`.
function cardDuration(result: OfferingResult): string | null {
  const n = normalized(result);
  if (n) return n.durationLabel;
  if (result.duration) return String(result.duration);
  const nights = result.nights as unknown;
  if (typeof nights === "number") return `${nights} nights`;
  const days = result.days as unknown;
  if (typeof days === "number") return `${days} days`;
  return null;
}

function normalizeType(raw: string): OfferingType | null {
  const t = raw.toLowerCase();
  return isOfferingType(t) ? t : null;
}

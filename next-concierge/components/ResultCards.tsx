"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GuideMeta, GuideToolMeta, OfferingResult, OfferingType, TripState } from "@/lib/types";
import { internalAtlasLink, isOfferingType } from "@/lib/atlas-config";
import { bookingLink } from "@/lib/atlas/booking.js";
import { getTrip, onTrip } from "@/lib/trip-state";

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
const GUIDE_CARD_LIMIT_TOTAL = 5;

// Rich inventory cards built from the Guide's meta frame. Cards now open the
// matching atlas *inside Base Camp* (the /atlas/<type> route), carrying the same
// region/ids the standalone deep link used so the embedded atlas focuses the
// right records. The home-page Living Atlas still plots the same results live
// alongside the chat.
export default function ResultCards({ meta }: { meta: GuideMeta }) {
  const cards = collectResultCards(meta);
  const trip = useTrip();
  const ctaHref = internalLeadLink(meta, trip);

  if (!cards.length && !ctaHref) return null;

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
      {ctaHref && (
        <div>
          <Link className="atlas-cta" href={ctaHref}>
            Open in the Atlas →
          </Link>
        </div>
      )}
    </div>
  );
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
      <span className="open">Open in Atlas →</span>
    </>
  );

  // The atlas link covers most of the card. We reuse the query the standalone
  // deep link carried (region + ids) so the embedded atlas focuses the same
  // record; otherwise fall back to the result's region. Hotel links also carry
  // the captured trip so the atlas's own booking CTA prices the same stay.
  const href = withTripQuery(internalCardLink(result, fallbackType), fallbackType, trip);
  const atlasLink = href ? (
    <Link className="card-link" href={href}>
      {body}
    </Link>
  ) : (
    <div className="card-link">{body}</div>
  );

  // Booking affordance via the single seam (lib/atlas/booking.js), rendered as
  // a sibling <a> inside the same card box so anchors never nest. Hotel cards
  // get a TravelWits property search priced for the captured trip (tomorrow
  // night when no dates yet); cruise/jet/yacht cards get the Virtuoso journey
  // page, labeled "See more details" since it's not a rate quote (booking.js
  // picks the label by result type).
  const booking = bookingLink(result, trip);
  return (
    <div className="card">
      {atlasLink}
      {booking && (
        <a
          className={`card-book${booking.kind === "deep" ? " deep" : ""}`}
          href={booking.url}
          target="_blank"
          rel="noreferrer"
        >
          {booking.label} {booking.kind === "deep" ? "→" : "↗"}
          {booking.note && <span className="card-book-note">{booking.note}</span>}
        </a>
      )}
    </div>
  );
}

// Build the in-app atlas link for a result. Prefer the search string the
// standalone deep link already encoded (region + forward-compatible ids), then
// fall back to the result's region, then the bare atlas.
function internalCardLink(result: OfferingResult, type: OfferingType | null): string | null {
  if (!type) return null;
  let query = "";
  if (typeof result.deepLink === "string" && result.deepLink) {
    try {
      // Deep links are internal paths ("/maps/hotel/?ids=h_1"), so parse
      // against a placeholder base — a bare `new URL()` throws on them.
      query = new URL(result.deepLink, "http://internal.atlas").search; // e.g. "?region=Med&ids=y_12"
    } catch {
      /* not a parseable URL — ignore and fall back */
    }
  }
  if (!query && result.region) query = `?region=${encodeURIComponent(result.region)}`;
  return internalAtlasLink(type, query);
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
  if (region) params.set("region", region);
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
function cardDate(result: OfferingResult): string | null {
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

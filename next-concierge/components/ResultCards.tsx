import Link from "next/link";
import type { GuideMeta, OfferingResult, OfferingType } from "@/lib/types";
import { internalAtlasLink, isOfferingType } from "@/lib/atlas-config";
import { bookingLink } from "@/lib/atlas/booking.js";
import { getTrip } from "@/lib/trip-state";

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
  const ctaHref = internalLeadLink(meta);

  if (!cards.length && !ctaHref) return null;

  return (
    <div>
      {cards.length > 0 && (
        <div className="cards">
          {cards.map(({ result, type }, i) => (
            <Card key={`${type}:${result.id ?? result.name ?? i}`} result={result} fallbackType={type} />
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
}: {
  result: OfferingResult;
  fallbackType: OfferingType | null;
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

  // The whole card opens that result in the in-app atlas (/atlas/<type>). We
  // reuse the query the standalone deep link carried (region + ids) so the
  // embedded atlas focuses the same record; otherwise fall back to the result's
  // region.
  const href = internalCardLink(result, fallbackType);
  const card = href ? (
    <Link className="card" href={href}>
      {body}
    </Link>
  ) : (
    <div className="card">{body}</div>
  );

  // Booking affordance via the single seam (lib/atlas/booking.js). In portal
  // mode this is the VipTravelAi.com portal + access code, kept secondary under
  // the card — the Atlas link stays the primary move (trust rule, SPEC §6).
  // Rendered outside the atlas <Link> so anchors never nest.
  const booking = bookingLink(result, getTrip());
  if (!booking) return card;
  return (
    <div className="card-cell">
      {card}
      <a className="card-book" href={booking.url} target="_blank" rel="noreferrer">
        {booking.label} ↗
        {booking.note && <span className="card-book-note">{booking.note}</span>}
      </a>
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
// chart region. Mirrors how the meta frame picks its lead/deepLink.
function internalLeadLink(meta: GuideMeta): string | null {
  const tools = [...(meta.tools ?? [])].reverse();
  const tool = tools.find((t) => (t.results ?? []).length > 0) ?? tools[0];
  const type = normalizeType(String(tool?.type ?? tool?.input?.type ?? ""));
  if (!type) return null;
  const region = meta.chartRegion;
  return internalAtlasLink(type, region ? `?region=${encodeURIComponent(region)}` : "");
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

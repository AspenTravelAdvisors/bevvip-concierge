import type { GuideMeta, OfferingResult, OfferingType } from "@/lib/types";
import { ATLASES, isOfferingType } from "@/lib/atlas-config";

// Cap cards per brand within a category (so one operator can't flood the row),
// not per category — a two-brand comparison ("Aman vs Orient Express") and an
// open search that surfaced several operators must show every brand, not just
// whichever the last tool happened to fill the category bucket with.
const GUIDE_CARD_LIMIT_PER_BRAND = 4;
const GUIDE_CARD_LIMIT_TOTAL = 12;

// Rich inventory cards built from the Guide's meta frame. Every card and the
// shortlist handoff open the full standalone Atlas (in a new tab, so the
// conversation is never lost). The home-page Living Atlas plots the same
// results live alongside the chat, so there is no separate in-app atlas route.
export default function ResultCards({ meta }: { meta: GuideMeta }) {
  const cards = collectResultCards(meta);

  if (!cards.length && !meta.deepLink) return null;

  return (
    <div>
      {cards.length > 0 && (
        <div className="cards">
          {cards.map(({ result, type }, i) => (
            <Card key={`${type}:${result.id ?? result.name ?? i}`} result={result} fallbackType={type} />
          ))}
        </div>
      )}
      {meta.deepLink && (
        <div>
          <a className="atlas-cta" href={meta.deepLink} target="_blank" rel="noreferrer">
            Open full Atlas ↗
          </a>
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
  const where = [result.city, result.country, result.region, result.duration, result.dates]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <span className="kicker">{String(kicker)}</span>
      <span className="name">{result.name || "Untitled"}</span>
      {where && <span className="where">{where}</span>}
      <span className="open">Open in Atlas ↗</span>
    </>
  );

  // The whole card opens that result in its full standalone Atlas, in a new tab.
  // Prefer the offering's own deep link (focuses the record with its detail
  // open); otherwise fall back to the atlas, focused on the result's region.
  const href = result.deepLink || externalCardLink(result, fallbackType);
  if (href) {
    return (
      <a className="card" href={href} target="_blank" rel="noreferrer">
        {body}
      </a>
    );
  }
  return <div className="card">{body}</div>;
}

// Fallback when a result carries no deep link: the result's full Atlas, focused
// on its region when known.
function externalCardLink(result: OfferingResult, type: OfferingType | null): string | null {
  if (!type) return null;
  const base = ATLASES[type].base;
  return result.region ? `${base}/?region=${encodeURIComponent(result.region)}` : base;
}

function normalizeType(raw: string): OfferingType | null {
  const t = raw.toLowerCase();
  return isOfferingType(t) ? t : null;
}

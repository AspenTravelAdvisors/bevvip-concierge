import Link from "next/link";
import type { GuideMeta, OfferingResult, OfferingType } from "@/lib/types";
import { isOfferingType } from "@/lib/atlas-config";

const GUIDE_CARD_LIMIT_PER_CATEGORY = 4;

// Rich inventory cards built from the Guide's meta frame, plus the Atlas
// handoff: external deep link to the standalone atlas app and an internal
// link into the unified /atlas/[type] shell when a chart region is known.
export default function ResultCards({ meta }: { meta: GuideMeta }) {
  const lead =
    [...meta.tools].reverse().find((t) => (t.results?.length ?? 0) > 0) || null;
  const cards = collectResultCards(meta);
  const leadType = normalizeType(lead?.type ?? String(lead?.input?.type ?? ""));

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
      <div>
        {leadType && meta.chartRegion && (
          <Link
            className="atlas-cta"
            href={`/atlas/${leadType}?region=${encodeURIComponent(meta.chartRegion)}`}
          >
            View on the Living Atlas →
          </Link>
        )}{" "}
        {meta.deepLink && (
          <a className="atlas-cta" href={meta.deepLink} target="_blank" rel="noreferrer">
            Open full Atlas ↗
          </a>
        )}
      </div>
    </div>
  );
}

function collectResultCards(meta: GuideMeta): Array<{ result: OfferingResult; type: OfferingType | null }> {
  const cards: Array<{ result: OfferingResult; type: OfferingType | null }> = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const add = (result: OfferingResult | undefined, rawType: unknown) => {
    if (!result) return;
    const type = normalizeType(String(result.type ?? rawType ?? ""));
    const bucket = type ?? "other";
    if ((counts.get(bucket) ?? 0) >= GUIDE_CARD_LIMIT_PER_CATEGORY) return;
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
  return (
    <div className="card">
      <span className="kicker">{String(kicker)}</span>
      <span className="name">{result.name || "Untitled"}</span>
      {where && <span className="where">{where}</span>}
      {result.deepLink && (
        <a className="open" href={result.deepLink} target="_blank" rel="noreferrer">
          Open in Atlas ↗
        </a>
      )}
    </div>
  );
}

function normalizeType(raw: string): OfferingType | null {
  const t = raw.toLowerCase();
  return isOfferingType(t) ? t : null;
}

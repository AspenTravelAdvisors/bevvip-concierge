import Link from "next/link";
import type { GuideMeta, OfferingResult, OfferingType } from "@/lib/types";
import { isOfferingType } from "@/lib/atlas-config";

// Rich inventory cards built from the Guide's meta frame, plus the Atlas
// handoff: external deep link to the standalone atlas app and an internal
// link into the unified /atlas/[type] shell when a chart region is known.
export default function ResultCards({ meta }: { meta: GuideMeta }) {
  const lead =
    [...meta.tools].reverse().find((t) => (t.results?.length ?? 0) > 0) || null;
  const results = lead?.results?.slice(0, 6) ?? [];
  const leadType = normalizeType(lead?.type ?? String(lead?.input?.type ?? ""));

  if (!results.length && !meta.deepLink) return null;

  return (
    <div>
      {results.length > 0 && (
        <div className="cards">
          {results.map((r, i) => (
            <Card key={r.id ?? i} result={r} fallbackType={leadType} />
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

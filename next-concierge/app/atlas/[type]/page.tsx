import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ATLASES, ATLAS_TYPES, externalAtlasLink, isOfferingType } from "@/lib/atlas-config";
import AtlasShell from "@/components/AtlasShell";

// Unified Living Atlas: /atlas/hotel | cruise | jet | yacht, honoring the
// same ?region= deep-link contract the standalone atlas apps use
// (DEEPLINK-HANDOFF.md). Server-rendered for SEO; the map hydrates on top.

interface Props {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ region?: string; q?: string }>;
}

export function generateStaticParams() {
  return ATLAS_TYPES.map((type) => ({ type }));
}

// The four atlas types are the complete set — anything else is a hard 404.
export const dynamicParams = false;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { type } = await params;
  // Raised here (not only in the page body) so the 404 status is set
  // before streaming begins.
  if (!isOfferingType(type)) notFound();
  const { region } = await searchParams;
  const atlas = ATLASES[type];
  return {
    title: region ? `${atlas.label} · ${region}` : atlas.label,
    description: atlas.tagline,
  };
}

export default async function AtlasPage({ params, searchParams }: Props) {
  const { type } = await params;
  if (!isOfferingType(type)) notFound();
  const { region } = await searchParams;
  const atlas = ATLASES[type];

  return (
    <div className="atlas-page">
      <div className="atlas-tabs">
        {ATLAS_TYPES.map((t) => (
          <Link
            key={t}
            href={region ? `/atlas/${t}?region=${encodeURIComponent(region)}` : `/atlas/${t}`}
            data-active={t === type}
          >
            {ATLASES[t].label}
          </Link>
        ))}
      </div>
      <div className="atlas-head">
        <h1>
          {atlas.label}
          {region ? ` · ${region}` : ""}
        </h1>
        <p>{atlas.tagline}</p>
      </div>
      <AtlasShell type={type} region={region ?? null} externalLink={externalAtlasLink(type, region)} />
    </div>
  );
}

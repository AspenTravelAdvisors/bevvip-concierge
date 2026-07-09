import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ATLASES, isOfferingType } from "@/lib/atlas-config";
import AtlasView from "@/components/AtlasView";

// In-app atlas view. Each of the five atlases now lives inside Base Camp as a
// self-contained Leaflet page under public/maps/<type>/. We render it as-is in
// a full-bleed iframe (no Leaflet→Mapbox coordinate porting) and overlay The
// Guide as a minimizable bottom sheet. The header chrome comes from layout.tsx,
// so the traveler never leaves Base Camp.

export function generateStaticParams() {
  return Object.keys(ATLASES).map((type) => ({ type }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const { type } = await params;
  return isOfferingType(type) ? { title: ATLASES[type].label } : {};
}

export default async function AtlasPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { type } = await params;
  if (!isOfferingType(type)) notFound();

  // Forward every deep-link param through to the embedded atlas so a shared
  // link (built by the atlas's own Share button, which now targets /atlas/<type>)
  // reproduces the full view — region, brand/program, operator, port, month,
  // shortlist ids and any other filter the atlas encoded.
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, v] of Object.entries(sp)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) qs.set(key, value);
  }
  const query = qs.toString();
  const src = `/maps/${type}/index.html${query ? `?${query}` : ""}`;

  return <AtlasView label={ATLASES[type].label} src={src} />;
}

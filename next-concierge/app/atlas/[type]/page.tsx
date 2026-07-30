import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ATLASES, isOfferingType } from "@/lib/atlas-config";
import type { OfferingType } from "@/lib/types";
import AtlasFrame from "@/components/AtlasFrame";
import AtlasView from "@/components/AtlasView";
import AtlasTrain from "@/components/AtlasTrain";
import AtlasJet from "@/components/AtlasJet";
import AtlasYacht from "@/components/AtlasYacht";
import AtlasWorldCruise from "@/components/AtlasWorldCruise";
import AtlasCruise from "@/components/AtlasCruise";
import AtlasHotel from "@/components/AtlasHotel";

/**
 * Collections migrated off their Leaflet iframe onto the Mapbox globe
 * (Deliverable 3). Everything not listed here still renders the iframe, so the
 * five can be moved one at a time and each reviewed on its own — rather than a
 * single switch that changes all of them at once.
 *
 * Removing a collection from its iframe is also what frees its
 * public/maps/<type>/ directory for deletion, including the three duplicated
 * landmask.bin copies the sea atlases still fetch.
 */
const NATIVE_COLLECTIONS: Partial<Record<OfferingType, () => React.ReactElement>> = {
  train: () => <AtlasTrain />,
  jet: () => <AtlasJet />,
  yacht: () => <AtlasYacht />,
  worldcruise: () => <AtlasWorldCruise />,
  cruise: () => <AtlasCruise />,
  // Deliverable 2: browse here, inspect in Google 3D via the card action.
  hotel: () => <AtlasHotel />,
};

// In-app atlas view. Each of the five atlases now lives inside Base Camp as a
// self-contained Leaflet page under public/maps/<type>/. We render it as-is in
// a full-bleed iframe (no Leaflet→Mapbox coordinate porting) and overlay The
// Guide as a minimizable bottom sheet. The header chrome comes from layout.tsx,
// so the traveler never leaves Base Camp.

export function generateStaticParams() {
  // villa has no /maps/villa iframe page — it's the server-rendered atlas at
  // the static app/atlas/villa route, which wins over this dynamic segment.
  return Object.keys(ATLASES)
    .filter((type) => type !== "villa")
    .map((type) => ({ type }));
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
  // "villa" never reaches here at runtime (the static app/atlas/villa route
  // takes precedence); the guard covers direct generateStaticParams misuse.
  if (!isOfferingType(type) || type === "villa") notFound();

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

  // ?hero=1 — ambient mode for the marketing landers, which embed this route
  // as a dimmed hero background. Hides Base Camp's header here (and, since the
  // param is forwarded above, the atlas hides its own chrome) so only the map
  // shows through the blur.
  const hero = qs.get("hero") === "1";

  // Ambient hero embeds get the bare map — no chrome of ours to bleed through
  // the lander's own headline. Still served by the iframe even for migrated
  // collections: the landers want a bare ambient map, not a filter rail.
  if (hero) return <AtlasView label={ATLASES[type].label} src={src} hero />;

  const native = NATIVE_COLLECTIONS[type];
  if (native) {
    return <AtlasFrame type={type}>{native()}</AtlasFrame>;
  }

  return (
    <AtlasFrame type={type}>
      <AtlasView label={ATLASES[type].label} src={src} />
    </AtlasFrame>
  );
}

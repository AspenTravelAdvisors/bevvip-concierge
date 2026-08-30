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
import AtlasSafari from "@/components/AtlasSafari";

/**
 * Collections migrated off their standalone iframe onto the shared browse
 * surface. Everything not listed here still renders the iframe, so collections
 * can be moved one at a time and each reviewed on its own — rather than a
 * single switch that changes all of them at once.
 *
 * Removing a collection from its iframe is also what frees its
 * public/maps/<type>/ directory for deletion, including the three duplicated
 * landmask.bin copies the sea atlases still fetch.
 */
const NATIVE_COLLECTIONS: Partial<Record<OfferingType, () => React.ReactElement>> = {
  hotel: () => <AtlasHotel />,
  train: () => <AtlasTrain />,
  jet: () => <AtlasJet />,
  yacht: () => <AtlasYacht />,
  worldcruise: () => <AtlasWorldCruise />,
  cruise: () => <AtlasCruise />,
  safari: () => <AtlasSafari />,
};

// In-app atlas view. Each standalone atlas now lives inside Base Camp as a
// self-contained map page under public/maps/<type>/. We render it as-is in
// a full-bleed iframe (no standalone-map coordinate porting) and overlay The
// Guide as a minimizable bottom sheet. The header chrome comes from layout.tsx,
// so the traveler never leaves Base Camp.

export function generateStaticParams() {
  // villa has no /maps/villa iframe page — it's the server-rendered atlas at
  // the static app/atlas/villa route, which wins over this dynamic segment.
  return Object.keys(ATLASES)
    .filter((type) => type !== "villa")
    .map((type) => ({ type }));
}

/*
 * The atlas shells are noindex, follow.
 *
 * Every one of them is a full-bleed map: a client component or an iframe whose
 * entire content arrives after JS runs. What a crawler is served is a title, a
 * header and an empty stage — a thin page, eight times over, sitting on top of
 * the hub tree at /hotels, /villas and /journeys that says the same things in
 * text a crawler can read. Indexing them competes with those hubs using the
 * weakest version of the same content.
 *
 * `follow` is the half that matters and is easy to get wrong: these pages are
 * still crawled and their links still carry, so nothing below them is orphaned
 * by this. And it is `robots` metadata rather than a robots.txt Disallow for
 * the same reason — a URL blocked from crawling can still be indexed from
 * inbound links, because the crawler never reads the noindex telling it not to.
 */
const ATLAS_ROBOTS = { index: false, follow: true } as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const { type } = await params;
  return isOfferingType(type)
    ? { title: ATLASES[type].label, robots: ATLAS_ROBOTS }
    : { robots: ATLAS_ROBOTS };
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
  // ?hero=1 — ambient mode for the marketing landers, which embed this route
  // as a dimmed hero background. Hides Base Camp's header here (and, since the
  // param is forwarded above, the atlas hides its own chrome) so only the map
  // shows through the blur.
  const hero = qs.get("hero") === "1";
  /*
   * `?hotel=<id>` used to force the iframe.
   *
   * That was the routing half of the split: the Google Photorealistic 3D
   * property view existed only inside public/maps/hotel/index.html, so a link
   * to one property had to leave the shared surface to reach it — which is
   * exactly why the best thing in the product read as buried. The engine now
   * lives on the collection page itself (components/Atlas3DLayer), so the same
   * link lands on the same building with the filters, the rail and the dossier
   * around it, and every share link already in circulation keeps working.
   *
   * A property deep link opens ON the photoreal engine — decided client-side
   * in AtlasCollection, which is the only place that can see the URL the
   * browser actually has (this route's native branch renders a client
   * component that reads its own search params).
   *
   * `?legacy=1` still opens the standalone page. It stays reachable on purpose:
   * it is the fallback if the Maps key or the tiles are ever unavailable, and
   * it is what the `?hero=1` marketing embeds render.
   */
  const legacy = qs.get("legacy") === "1";
  const native = legacy ? undefined : NATIVE_COLLECTIONS[type];

  // The standalone /maps page has its own title rail. Inside Base Camp's
  // AtlasFrame that becomes duplicate chrome, so iframe pages get an internal
  // embed flag that strips the standalone rail while keeping filters/details.
  if (!hero && !native) qs.set("embed", "1");
  const query = qs.toString();
  const src = `/maps/${type}/index.html${query ? `?${query}` : ""}`;

  // Ambient hero embeds get the bare map — no chrome of ours to bleed through
  // the lander's own headline. Still served by the iframe even for migrated
  // collections: the landers want a bare ambient map, not a filter rail.
  if (hero) return <AtlasView label={ATLASES[type].label} src={src} hero />;

  if (native) {
    return <AtlasFrame type={type}>{native()}</AtlasFrame>;
  }

  return (
    <AtlasFrame type={type}>
      <AtlasView label={ATLASES[type].label} src={src} />
    </AtlasFrame>
  );
}

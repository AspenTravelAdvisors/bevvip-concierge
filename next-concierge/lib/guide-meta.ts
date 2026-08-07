// lib/guide-meta.ts — the one definition of "which tool call leads".
//
// A single reply can carry several tool calls (a hotel search plus a yacht
// sidecar, or one search per pillar on a cross-atlas question). Three places
// independently decide which of them speaks for the reply, and they must agree,
// because between them they choose what the map flies to, which examples get
// cards, and what category the advisor's email is headed:
//
//   app/api/guide/route.ts   summarizeMeta   -> deepLink + chartRegion
//   components/ResultCards   leadOfferingType-> the card row's type
//   lib/handoff.ts           handoffCategory -> the advisor blurb + label
//
// All three had their own copy of the rule, and two of them tested
// results.length while the third tested count. They agreed only because every
// producer happens to set one from the other today.

import type { GuideToolMeta } from "./types";

/**
 * The tool call that speaks for a reply: the most recent one that actually
 * returned inventory, falling back to the most recent call of any kind so a
 * zero-result search can still carry its note and its type.
 *
 * Newest-first because the last search is the most refined read of what the
 * traveler asked for.
 */
export function leadTool(tools: GuideToolMeta[] | undefined): GuideToolMeta | null {
  const list = tools ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    if ((list[i]?.results?.length ?? 0) > 0) return list[i];
  }
  return list[list.length - 1] ?? null;
}

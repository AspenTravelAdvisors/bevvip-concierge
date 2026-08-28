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

/** A place a day can be spent in: the city/area plus the country the catalogue needs. */
export interface LeadPlace {
  place: string;
  country: string | null;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The specific place a reply is about, or null when it is about a region.
 *
 * This exists to decide whether the chat can offer "what is there to do in X",
 * and the null case is the important half. `search_offerings` takes both a
 * marquee `region` key (antarctica, galapagos, arctic) and a `place`, and a day
 * of tours is a question about a town, not about a polar region or an ocean —
 * "what is there to do in Antarctica" is a worse question than no question. So
 * only a named place or a returned city qualifies; a region-only search offers
 * nothing.
 *
 * Reads the lead tool, because that is already the definition of which search
 * speaks for a reply, and falls through to the first result's own city so a
 * search phrased by brand or region ("Aman in Japan") can still name Kyoto.
 */
export function leadPlace(tools: GuideToolMeta[] | undefined): LeadPlace | null {
  const lead = leadTool(tools);
  if (!lead) return null;

  const input = (lead.input || {}) as Record<string, unknown>;
  const country = text(input.country) || null;

  const named = text(input.place);
  if (named) return { place: named, country };

  // A returned city outranks `places[]`, which by its own schema holds
  // colloquial AREAS — "the Amalfi Coast", "the Cotswolds", "the Hamptons".
  // Those are the right input for a hotel search and the wrong subject for
  // this question twice over: a day is spent in a town rather than along a
  // coastline, and the phrasing ("a few days in Amalfi Coast") gives away that
  // a machine wrote the traveller's own sentence.
  const withCity = (lead.results || []).find((r) => text(r.city));
  if (withCity) {
    return { place: text(withCity.city), country: text(withCity.country) || country };
  }

  const places = Array.isArray(input.places) ? input.places : [];
  const area = text(places[0]);
  return area ? { place: area, country } : null;
}

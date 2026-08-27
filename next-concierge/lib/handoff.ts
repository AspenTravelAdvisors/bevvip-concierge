// lib/handoff.ts — everything the advisor hand-off needs to know, extracted
// from the transcript. This used to live inside GuideChat, which meant the
// hand-off could only ever be offered from inside a chat turn. It is now the
// business's primary conversion path, reachable from the header on a cold
// visit, so the parsing moved here and both entry points share it.

import { leadTool } from "./guide-meta";
import { getBucketList } from "./bucket-list";
import type { GuideMeta, GuideTurn, OfferingType } from "./types";

/**
 * The qualified brief, carried silently in a [[BRIEF: ...]] tag the Guide emits
 * once it has enough signal. This is the "how to follow up" an advisor reads
 * instead of the whole transcript.
 */
export interface Brief {
  destination?: string;
  when?: string;
  party?: string;
  budget?: string;
  style?: string;
  considering?: string;
}

/** Everything posted to /api/handoff, assembled once and shared by both CTAs. */
export interface AdvisorContext {
  category: string;
  brief: Brief;
  shortlist: string[];
  /**
   * Where the shortlist came from.
   *
   * "bucket" is a set of decisions the traveller made across sessions;
   * "results" is whatever the last search happened to return. An advisor reads
   * those two very differently — the first is "these are the ones", the second
   * is "this is what they were looking at" — so the difference is carried
   * rather than flattened, and both the dialog and the email say which it is.
   */
  shortlistSource: "bucket" | "results";
  /** How many items the list actually holds, when more were saved than sent. */
  shortlistTotal: number;
  deepLink: string | null;
  transcript: string;
}

/**
 * Strip control tags ([[CHART:..]], [[OPTIONS:..]], [[BRIEF:..]]) plus any
 * partial tag still arriving, so they never flash as raw text mid-stream.
 * The final clause is the important one: while a tag streams in character by
 * character, everything from the opening "[[" onward is suppressed until the
 * closing "]]" lands, instead of rendering "[[BRIE" for a frame or two.
 */
export function stripControlTags(s: string): string {
  return s
    .replace(/\[\[CHART:\s*[a-z ]+\]\]/gi, "")
    .replace(/\[\[OPTIONS:[^\]]*\]\]/gi, "")
    .replace(/\[\[BRIEF:[^\]]*\]\]/gi, "")
    // An unterminated tag: hide it (and any whitespace before it) until closed.
    .replace(/\n*\s*\[\[(?:(?!\]\]).)*$/s, "")
    .trim();
}

/** Parse the latest [[BRIEF: dest=.. | when=.. | ...]] tag out of one message. */
export function extractBrief(text: string): Brief | null {
  const m = text.match(/\[\[BRIEF:\s*([^\]]+)\]\]/i);
  if (!m) return null;
  const kv: Record<string, string> = {};
  for (const pair of m[1].split("|")) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    const k = pair.slice(0, i).trim().toLowerCase();
    const v = pair.slice(i + 1).trim();
    if (v) kv[k] = v;
  }
  const brief: Brief = {
    destination: kv.dest || kv.destination,
    when: kv.when,
    party: kv.party,
    budget: kv.budget,
    style: kv.style,
    considering: kv.considering,
  };
  return Object.values(brief).some(Boolean) ? brief : null;
}

/**
 * The most recent brief across the conversation. The Guide re-emits an updated
 * tag as it learns more, so the latest one wins.
 */
export function latestBrief(turns: GuideTurn[]): Brief {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role !== "assistant") continue;
    const b = extractBrief(turns[i].content);
    if (b) return b;
  }
  return {};
}

/** Has the Guide learned enough to be worth an advisor's time? */
export function hasBrief(turns: GuideTurn[]): boolean {
  return Object.values(latestBrief(turns)).some(Boolean);
}

/** The brief as short "Label: value" lines, to show the traveler what is sent. */
export function briefLines(brief: Brief): Array<[string, string]> {
  const labels: Array<[keyof Brief, string]> = [
    ["destination", "Where"],
    ["when", "When"],
    ["party", "Who"],
    ["budget", "Budget"],
    ["style", "Style"],
    ["considering", "Considering"],
  ];
  return labels
    .map(([k, label]) => [label, brief[k] ?? ""] as [string, string])
    .filter(([, v]) => v.trim() !== "");
}

/**
 * The top result names from a meta frame, carried to the advisor. Mirrors the
 * card collection order (latest tool first) without the per-brand card caps.
 */
export function shortlistNames(meta: GuideMeta | undefined): string[] {
  if (!meta) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const tool of [...(meta.tools ?? [])].reverse()) {
    for (const r of tool.results ?? []) {
      const name = typeof r?.name === "string" ? r.name.trim() : "";
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names.slice(0, 5);
}

/** The most recent shortlist anywhere in the conversation, for a cold CTA. */
export function latestShortlist(turns: GuideTurn[]): { names: string[]; meta?: GuideMeta } {
  for (let i = turns.length - 1; i >= 0; i--) {
    const names = shortlistNames(turns[i].meta);
    if (names.length) return { names, meta: turns[i].meta };
  }
  return { names: [] };
}

/**
 * A compact, plain-text rendering of the conversation for the hand-off email:
 * control tags stripped, each turn labelled, capped so the payload stays sane.
 */
export function transcriptText(turns: GuideTurn[]): string {
  const lines = turns
    .filter((t) => t.content && t.content.trim())
    .map((t) => `${t.role === "user" ? "Traveler" : "The Guide"}: ${stripControlTags(t.content)}`);
  let out = lines.join("\n\n");
  const CAP = 4000;
  if (out.length > CAP) out = "…(earlier messages trimmed)…\n\n" + out.slice(out.length - CAP);
  return out;
}

/**
 * Which pillar the hand-off should speak to, derived from the inventory that
 * surfaced. Antarctica is split out from generic expedition cruising because
 * the ship-vs-destination decision there warrants its own framing.
 */
export function handoffCategory(meta: GuideMeta | undefined): string {
  if (!meta) return "generic";
  const region = (meta.chartRegion || "").toLowerCase();
  const tool = leadTool(meta.tools);
  const type = (tool?.type || "").toLowerCase();
  // Ordinary Luxury Cruise sailings are sourced by an advisor rather than held
  // in live inventory, and that result is tagged type "cruise" so the rest of
  // the pipeline can handle it. Left unchecked it inherited the expedition
  // framing, so a Regent or Cunard enquiry — the highest-intent advisor-only
  // lead there is — reached the inbox headed "Expedition Cruise", under a blurb
  // about ice class and landing ratios.
  if (tool?.advisorOnly) return "luxurycruise";
  if (type === "hotel") return "hotel";
  if (type === "jet") return "jet";
  if (type === "yacht") return "yacht";
  if (type === "worldcruise") return "worldcruise";
  if (type === "train") return "train";
  if (type === "safari") return "safari";
  if (type === "villa") return "villa";
  if (type === "cruise") return region === "antarctica" ? "antarctica" : "expedition";
  return "generic";
}

/**
 * The supporting line under the (single, always-identical) CTA. The category
 * used to change the *button label* — six different verbs for one action, so
 * the most important control in the app was never twice the same. The variation
 * belongs here, in the explanation, where it adds specificity instead of
 * costing recognition.
 */
export const HANDOFF_BLURB: Record<string, string> = {
  hotel:
    "An Aspen specialist will confirm availability and the VIP amenities on each of these — upgrade, breakfast, resort credit — and come back with what's actually bookable.",
  expedition:
    "An Aspen specialist will check cabin availability and departure-by-departure pricing on these sailings, and flag which ones are close to selling out.",
  antarctica:
    "An Aspen specialist will compare these ships on what actually differs — ice class, landing ratios, cabin category and total cost with flights — and come back with a recommendation.",
  jet: "An Aspen specialist will confirm remaining seats and the full per-person cost on these departures.",
  yacht:
    "An Aspen specialist will check suite availability and pricing on these voyages, and what's included versus added.",
  worldcruise:
    "An Aspen specialist will price these voyages by cabin category, including the segments you can join partway if the full sailing is too long.",
  train:
    "An Aspen specialist will confirm cabin availability and departure dates on these journeys.",
  luxurycruise:
    "An Aspen specialist sources these sailings directly with the line: the right departure, suite category, and the Virtuoso amenities that come with booking through us.",
  villa:
    "An Aspen specialist will confirm availability and the all-in weekly rate on these villas, including staffing and any minimum stay.",
  generic:
    "An Aspen specialist will take what you've described and come back with specific, priced options.",
};

/**
 * How many saved items travel with a hand-off.
 *
 * The list itself holds up to BUCKET_LIST_MAX; an advisor's opening reply can
 * act on about ten. Beyond that the email stops being a brief, so the rest are
 * counted rather than listed — and the deep link and the traveller are both
 * still there to produce them.
 */
const HANDOFF_SAVED_LIMIT = 10;

/**
 * Which pillar a set of saved items speaks to.
 *
 * Only when they agree. A list of six hotels is a hotel enquiry; a list holding
 * two hotels, a sailing and a villa is trip planning, and calling it "Luxury
 * Hotels" because hotels happened to be the plurality would put the wrong
 * specialist on it and open the reply with the wrong blurb.
 */
function savedCategory(types: OfferingType[]): string | null {
  const unique = [...new Set(types)];
  if (unique.length !== 1) return null;
  const t = unique[0];
  if (t === "cruise") return "expedition";
  return t;
}

/**
 * Assemble everything /api/handoff needs.
 *
 * THE BUCKET LIST WINS. If the traveller has saved anything, that is the
 * shortlist — a curated set beats the residue of the last query, which is what
 * this used to send even when the traveller had spent a week choosing four
 * specific properties. The transcript's shortlist stays as the fallback for
 * anyone who hands off without saving, which is still most of them.
 */
export function buildAdvisorContext(turns: GuideTurn[], meta?: GuideMeta): AdvisorContext {
  const latest = meta ? { names: shortlistNames(meta), meta } : latestShortlist(turns);
  const saved = getBucketList();
  const fromResults = {
    shortlist: latest.names,
    shortlistSource: "results" as const,
    shortlistTotal: latest.names.length,
    category: handoffCategory(latest.meta),
  };
  const chosen = saved.length
    ? {
        shortlist: saved.slice(0, HANDOFF_SAVED_LIMIT).map((i) => i.title),
        shortlistSource: "bucket" as const,
        shortlistTotal: saved.length,
        /*
         * The saved items decide the category, falling back to the
         * conversation's only where they do not agree among themselves — the
         * names being sent and the framing they are sent under have to be
         * about the same thing.
         */
        category: savedCategory(saved.map((i) => i.type)) ?? handoffCategory(latest.meta),
      }
    : fromResults;
  return {
    ...chosen,
    brief: latestBrief(turns),
    deepLink: latest.meta?.deepLink ?? null,
    transcript: transcriptText(turns),
  };
}

// next-concierge/lib/guide-botid.ts — server half of BotID, in SHADOW MODE.
//
// WHAT THIS DOES TODAY: classifies the caller and reports the verdict. Nothing
// else. Every traveler is served exactly as before, including one this
// classifies as a bot. The point is to find out what enforcing WOULD do to real
// traffic before it does it to anyone.
//
// WHY SHADOW FIRST. On 19 September a proxy-pool flood drove /api/guide from
// ~25 turns a day to 1,767 and drained the Anthropic balance. Rate limits and
// the daily ceiling meter that; only knowing who is calling prevents it. But
// the cost of being wrong is lopsided here in a way it is not for most sites:
// this endpoint fronts a luxury travel agency where one conversation can be a
// five-figure booking, so wrongly turning away a real client costs far more
// than serving a bot. A classifier is worth enforcing only once its false
// positive rate on OUR traffic is known, and the only way to know is to watch
// it be right or wrong for a while without acting on it.
//
// READING THE RESULT. Every turn logs `bot` on its guide_turn line:
//
//   "bot":"human"     — classified human. What almost every real turn should say.
//   "bot":"bot"       — would have been refused had this been enforcing.
//   "bot":"verified"  — a declared agent (ChatGPT Operator and friends), with
//                       the name in `botName`. NOT abuse by default: this
//                       business runs an AI travel guide, and a real prospect
//                       researching through an agent is a lead, not a scraper.
//   "bot":"unknown"   — the check could not run. Never treated as either.
//
// The number that decides whether to enforce is the share of `"bot"` verdicts
// carrying a referrer and country consistent with real travelers. Compare it
// against the flood's own signature — `ref: guide.expeditionbucketlist.com`
// from twenty-odd countries at a few requests a second.
//
// WHEN ENFORCING: do NOT return 403 to the browser. Refuse to spend the model
// tokens, then hand the visitor to an advisor instead of an error. A
// misclassified client still reaches a person, a bot still gets nothing spent
// on it, and the failure mode of the whole feature stops being "lose the
// customer" and becomes "route the customer to a human" — which for this
// business is a defensible outcome on its own.

import { checkBotId } from "botid/server";

export type BotVerdict = "human" | "bot" | "verified" | "unknown";

export interface BotCheck {
  verdict: BotVerdict;
  /** Set only for a declared agent, e.g. "chatgpt-operator". */
  name?: string;
}

/**
 * Classify the caller. Never throws, never blocks, and in shadow mode the
 * caller is expected to ignore the answer except to log it.
 *
 * "unknown" on any failure — a classifier that is down must not be able to
 * change what a traveler sees, today or after this starts enforcing.
 */
export async function classifyCaller(): Promise<BotCheck> {
  try {
    const result = await checkBotId();

    // A bypassed check ran but was not asked to decide — local dev, a preview
    // deploy, an explicit bypass. Counting that as "human" would quietly pad
    // the shadow sample with turns nothing actually classified, and the whole
    // value of this exercise is the accuracy of that sample.
    if (result.bypassed) return { verdict: "unknown" };

    if (result.isVerifiedBot) {
      // Only one arm of checkBotId's return type carries the name; both carry
      // the flags. Narrow rather than cast, so a future SDK shape change is a
      // type error here instead of `undefined` in the logs.
      const name = "verifiedBotName" in result ? result.verifiedBotName : undefined;
      return { verdict: "verified", name: name || "unnamed" };
    }
    return { verdict: result.isBot ? "bot" : "human" };
  } catch {
    // Misconfiguration, a network blip, or running somewhere BotID is not
    // wired up (local dev, a self-hosted build). None of those are a reason to
    // treat a visitor as either human or bot.
    return { verdict: "unknown" };
  }
}

/**
 * Whether a verdict WOULD be refused once this starts enforcing. Nothing calls
 * this for control flow yet; it exists so the rule lives beside the comment
 * explaining it, rather than being invented at the call site later.
 *
 * "unknown" is served: failing open is the only safe default for a check that
 * cannot answer. "verified" is served too — see the note on agents above.
 */
export const wouldRefuse = (check: BotCheck): boolean => check.verdict === "bot";

/**
 * One shape for every offering the Guide returns — Deliverable 5.
 *
 * THE PROBLEM. `search_offerings` passes the five journey/voyage collections
 * through verbatim from their upstream atlas APIs, adding only a deepLink. Each
 * API answers "how long" and "when" in its own vocabulary:
 *
 *   hotels        duration: "5 nights"      dates:     "12–17 Mar 2027"
 *   cruises       nights:   7               startDate: "2027-03-12"
 *   world cruises days:     104             month:     "2027-03"
 *   trains        duration: "8 days"        dates:     "12 Mar 2027"
 *
 * So ResultCards re-derived it at render time, reaching past the declared type
 * with `result.nights as unknown` because `OfferingResult` doesn't have those
 * fields — its `[key: string]: unknown` index signature is what let the cast
 * compile. Every new collection meant another branch in a presentation
 * component, and nothing failed when one was missed: the card just quietly
 * dropped a line.
 *
 * THE FIX. Normalise once, where the results are assembled, and let the card
 * render rather than guess. The original fields are left untouched — this is
 * additive — so nothing that reads `r.nights` today breaks.
 *
 * Deliberately NOT a rewrite of the upstream shapes: we don't own those APIs,
 * and a translation layer we control is cheaper than a negotiation we don't.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface NormalizedOffering {
  /** ISO `YYYY-MM-DD` where the source gives a real departure date. */
  startsOn: string | null;
  /** `YYYY-MM` where only a month is known. */
  startsIn: string | null;
  /**
   * What the card prints for "when": "12 Mar 2027", "Mar 2027", or the
   * source's own free-text range ("12–17 Mar 2027") when it isn't parseable.
   */
  whenLabel: string | null;
  /** Nights, where the source counts in nights. */
  nights: number | null;
  /** Days, where the source counts in days. */
  days: number | null;
  /** What the card prints for "how long": "7 nights", "104 days", "5 nights". */
  durationLabel: string | null;
  /** Who runs it — brand for most, operator for cruise. */
  supplier: string | null;
}

/** Only used for `supplier`; the date/duration paths match the card's own
 *  looser checks exactly — see the notes at each. */
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Normalise one raw result.
 *
 * Field precedence is transcribed from the card helpers this replaces, so the
 * output is identical for every input they already handled — see
 * scripts/verify-offering-shape.mjs, which asserts that head to head over the
 * whole combination space rather than trusting the transcription.
 */
export function normalizeOffering(r: Record<string, unknown>): NormalizedOffering {
  // ── when ────────────────────────────────────────────────────────────────
  // `dates` wins over `startDate`: where a source gives both, `dates` is the
  // human range ("12–17 Mar") and `startDate` only its first day.
  //
  // `??` NOT a truthiness fallback, and the difference is not academic: an
  // EMPTY-STRING `dates` blocks `startDate` and falls through to `month`. That
  // is what the card did, so it is what this does. Using `||` here changed the
  // output of 28 cases in the parity harness — cards that would suddenly start
  // showing a date they had never shown. Preserved deliberately; if the
  // upstream empty string is itself a bug, it should be fixed at the source
  // rather than papered over in a formatter.
  const raw = r.dates ?? r.startDate;
  const month = r.month;

  let startsOn: string | null = null;
  let startsIn: string | null = null;
  let whenLabel: string | null = null;

  if (typeof raw === "string" && raw.trim()) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (iso) {
      const [, y, m, d] = iso;
      startsOn = raw;
      startsIn = `${y}-${m}`;
      const label = MONTHS[Number(m) - 1];
      whenLabel = label ? `${Number(d)} ${label} ${y}` : raw;
    } else {
      // Free text the source already formatted for a human. Kept verbatim —
      // reformatting a range we didn't parse is how "12–17 Mar" becomes "12".
      whenLabel = raw;
    }
  } else if (typeof month === "string") {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (m) {
      startsIn = month;
      const label = MONTHS[Number(m[2]) - 1];
      whenLabel = label ? `${label} ${m[1]}` : month;
    }
  }

  // ── how long ────────────────────────────────────────────────────────────
  // TRUTHINESS on the raw value, matching the card: a numeric `duration: 12`
  // printed "12", and `duration: 0` fell through to nights. Requiring a string
  // here (the obvious-looking tidy) changed 96 cases in the harness.
  const nights = num(r.nights);
  const days = num(r.days);
  const durationLabel = r.duration
    ? String(r.duration)
    : nights != null
      ? `${nights} nights`
      : days != null
        ? `${days} days`
        : null;

  return {
    startsOn,
    startsIn,
    whenLabel,
    nights,
    days,
    durationLabel,
    // cruise carries `operator`; everyone else carries `brand`.
    supplier: str(r.brand) ?? str(r.operator),
  };
}

/** Attach the normalised view without disturbing the source fields. */
export function withNormalized<T extends Record<string, unknown>>(r: T): T & {
  normalized: NormalizedOffering;
} {
  return { ...r, normalized: normalizeOffering(r) };
}

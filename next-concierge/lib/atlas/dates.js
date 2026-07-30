// lib/atlas/dates.js — the past-date cutoff for the server-side atlas backends.
//
// WHY THIS EXISTS
//
// The cutoff was live in two places and missing from a third. The retired
// Leaflet atlases each hand-rolled it (`isPastTrip()` in yacht / worldcruise /
// jet / train, an ISO string compare in cruise), and the React globe has it in
// lib/atlas/adapters/filter.ts as `isPast()`. But the in-process query backends
// behind lib/atlas/index.js — the ones The Guide and the /api routes actually
// call — never got one. So the globe looked clean while the concierge went on
// recommending sailings that had already left.
//
// This module is the single implementation for those backends. It deliberately
// mirrors adapters/filter.ts rather than inventing new semantics: the two
// surfaces answer the same question about the same inventory and must not
// disagree.
//
// THE FORMAT PROBLEM
//
// Six backends, four date shapes, because each one preserves whatever its
// upstream feed emits:
//
//   cruise       "2027-04-01"                    ISO, already sortable
//   jet          "6/16/2026"                     M/D/YYYY, zero-padding varies
//   train        "7/20/2026"                     M/D/YYYY (isoFromMdy handles it)
//   yacht        "25 Oct 2026 - 01 Nov 2026"     display range, start on the left
//   worldcruise  "25 Oct 2026 - 01 Nov 2026"     same, plus 3 empty " - " rows
//
// A naive `startDate < today` string compare is wrong on three of the four and
// silently so — "6/16/2026" < "2026-07-30" is true for every M/D/YYYY date ever
// written, which would empty the jet atlas rather than trim it. Hence
// normalizeStartDate(): everything becomes ISO first, and only then is compared.

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Today as `YYYY-MM-DD`, local-time.
 *
 * Local, not UTC, and on purpose. A traveler in Los Angeles asking at 6pm on
 * the 29th should not have the 29th's departures vanish because it is already
 * the 30th in UTC. This matches the Leaflet originals, which built their cutoff
 * from `new Date()` with `setHours(0,0,0,0)` — local midnight.
 */
function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Any of the four upstream shapes -> `YYYY-MM-DD`, or null if there is no
 * parseable date.
 *
 * Null is a real answer, not a failure: 34 jet journeys and worldcruise's three
 * empty " - " rows genuinely have no departure. Callers must treat null as
 * "not past" (see isPast) rather than dropping it.
 */
function normalizeStartDate(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // "2027-04-01" and "2027-04-01T00:00:00Z" — cruise.
  const isoM = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoM) return isoM[0];

  // "6/16/2026", "12/1/2026" — jet and train. Month first; these feeds are US.
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;

  // "25 Oct 2026 - 01 Nov 2026" — yacht and worldcruise. Only the left half of
  // the range is read: the cutoff is about departure, and a voyage that sailed
  // last week is past even though it does not return until next month.
  const dmy = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (dmy) {
    const mm = MONTHS[dmy[2].toLowerCase()];
    if (mm) return `${dmy[3]}-${mm}-${dmy[1].padStart(2, "0")}`;
  }

  return null;
}

/**
 * Has this record already departed?
 *
 * Semantics are copied from adapters/filter.ts `isPast()` so the globe and the
 * concierge never disagree about the same trip:
 *
 *   onDemand      never past. An on-demand rail journey has no fixed departure
 *                 to be behind — 85 of the 135 rail journeys are these, and
 *                 dropping them would gut the train atlas.
 *   no date       not past. Matches the originals' `!t.d` guard. The one
 *                 divergence there — cruise's `requiresStartDate`, which drops
 *                 dateless sailings because `null >= today` is false — is moot
 *                 here: every one of cruise's 3,542 rows has an ISO date.
 *   unparseable   not past, for the same reason. Better to show a trip whose
 *                 date we could not read than to silently delete inventory.
 *
 * `today` is injectable so tests and the verifier can pin it.
 */
function isPast(record, today = todayISO()) {
  if (!record) return false;
  if (record.onDemand) return false;
  const start = normalizeStartDate(record.startDate);
  if (!start) return false;
  return start < today;
}

/** The inverse, for use directly as an Array#filter predicate. */
function isCurrent(record, today = todayISO()) {
  return !isPast(record, today);
}

/**
 * Drop everything that has already departed.
 *
 * `today` resolves per call rather than at module load: these backends are
 * required once into a long-lived server process, so a cutoff captured at
 * import time would freeze on whatever day the process booted and go stale
 * without ever erroring.
 */
function dropPast(list, today = todayISO()) {
  const cutoff = today;
  return list.filter((r) => !isPast(r, cutoff));
}

module.exports = { todayISO, normalizeStartDate, isPast, isCurrent, dropPast };

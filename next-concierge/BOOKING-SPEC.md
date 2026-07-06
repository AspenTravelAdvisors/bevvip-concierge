# Booking Spec — strip → Guide handoff & shared trip state

Status: **Shipped end-to-end** (2026-07-05 capture; 2026-07-06 strip + deep
links). Live: `trip-state.ts`, tool schema + prompt extraction, meta echo into
shared trip state, brief when=/party= alignment, the **BookingStrip** (§2), and
`booking.js` in **deep mode** (default) building real TravelWits destination
searches, with a portal fallback when no dates are captured.

**Deep-link discovery (2026-07-06):** TravelWits deep links are NOT per-property.
They are a **destination + dates** search priced at a fixed set of preferred VIP
rate codes. The URL carries: `checkInDate` / `checkOutDate`, the ten
`rateCodes[n]` with `exactMatchRateCodesOnly=true`, `selectedCurrency=USD`,
`searchRadiuses[0]=50`, `searchMode=2`, and a search area — `sa[value]` (a
Google Place id) + `sa[label]` (human text). No occupancy params exist in the
URL (guests are set on the results page), so the strip still *captures* party
for the shortlist/brief but does not encode it in the link. Reference:
`aspentraveladvisors.travelwits.com/?...&sa[value]=ChIJOwg_06VPwokRYv534QaPC8g&sa[label]=New%20York%2C%20NY%2C%20USA`.
Consequence: a card's "Book VIP rate" searches the hotel's own city at VIP rates
for the dates (the property appears in results); we can't target one property.
`sa[value]` is included when the label is in the seeded place-id map (NYC today);
otherwise `sa[label]` alone drives the search. Exact geocoding for arbitrary
destinations = a later Google Places lookup or a growing place-id map.

Wording rule (decided 2026-07-05): every surface says **"Access code:"**, never
"Password:" — a password reads as a security barrier; an access code reads as a
membership privilege. Applied in the Guide prompt, `booking.js`, and both Hotel
Atlas copies. The access code still gates the portal, so it rides along as a note
on every booking affordance, deep or portal.

The goal: let hotel-only travelers self-serve a booking. Base Camp captures
**where / when / who** through a recognizable strip (or naturally in chat),
carries that state through the Guide's shortlist, and renders "Book VIP rate →"
CTAs that land on a live TravelWits rate page for the destination + dates. When
no dates are captured yet, the CTA falls back to the honest portal link ("Check
VIP rates" + access code) rather than promising a rate page it can't deliver.

---

## 1. Shared trip state — single source of truth

One object, owned by Base Camp, readable by every surface that renders a
booking CTA. Persisted beside the transcript so it survives atlas round-trips.

```ts
// lib/types.ts
export interface TripState {
  destination: string | null;  // free text as the traveler gave it
  checkIn: string | null;      // "YYYY-MM-DD"
  checkOut: string | null;     // "YYYY-MM-DD"
  adults: number;              // default 2
  childrenAges: number[];      // ages, not just a count — booking engines price by age
  source: "strip" | "guide";   // who captured it last
  updatedAt: string;           // ISO timestamp
}
```

- Storage: `sessionStorage["bevvip.trip"]` (same lifetime as
  `bevvip.guide.turns`; "Start over" clears both).
- Change broadcast: `window.dispatchEvent(new CustomEvent("bevvip:trip", { detail: trip }))`
  — same pattern as `bevvip:atlas-plot` / `bevvip:guide-session`.
- Writers: the BookingStrip (on submit) and GuideChat (when the meta frame
  echoes trip params the Guide extracted — see §3). Last write wins; chat can
  refine what the strip captured and vice versa.
- Readers: ResultCards (booking CTA), the handoff form (pre-fills the brief),
  and later the Hotel Atlas via a `?ci=&co=&ad=&ch=` suffix on its iframe src.

A tiny module owns read/write/subscribe so no component touches storage
directly: `lib/trip-state.ts` exporting `getTrip()`, `setTrip(patch, source)`,
`onTrip(cb)`.

## 2. BookingStrip component

`components/BookingStrip.tsx`, rendered by GuideChat **on the empty state
only**, between the greeting and the seed chips. Once a conversation exists the
strip folds into a one-line summary chip ("Mar 14–21 · 2 adults · 2 kids ✎")
above the composer — recognizable capture up front, no second search engine
competing with the transcript afterwards.

Fields (native controls, no date-picker dependency):

| Field | Control | Notes |
|---|---|---|
| Where | text input | placeholder "Where to? Caribbean, Japan, a hotel name…" |
| Dates | two `<input type="date">` | check-out min = check-in + 1 |
| Guests | adults stepper + children stepper | adding a child reveals an age select (0–17) |

Submit ("See VIP rates") does two things, in order:

1. `setTrip({...fields}, "strip")`
2. Composes a **plain natural-language ask** and calls the existing `send()`:

   > `VIP hotels in {destination}, check-in {checkIn} to check-out {checkOut},
   > for {adults} adults[ and {n} children (ages {a, b})]`

Plain language — not a hidden JSON payload — so the transcript stays honest,
the ask is editable/re-askable by the traveler, and no new API contract is
needed between strip and Guide. The Guide parses it like any other message
(§3 makes that extraction reliable).

Validation: only `destination` is required. Dates and guests are optional —
an empty-dates submit is just a discovery ask, and the strip must never block
a traveler who doesn't have dates yet (that's the advisory path working).

## 3. Tool schema + prompt changes (Phase 1, ship now)

`SEARCH_OFFERINGS_TOOL.input_schema.properties` gains four optional fields:

```js
checkIn:  { type: "string", description: "Hotel check-in date, YYYY-MM-DD. Only when the traveler states dates. Never invent." },
checkOut: { type: "string", description: "Hotel check-out date, YYYY-MM-DD. Only when the traveler states dates. Never invent." },
adults:   { type: "integer", description: "Adults in the party, when stated." },
childrenAges: { type: "array", items: { type: "integer" }, description: "Ages of children in the party, when stated. A bare count with no ages: use age 10 per child and note it." }
```

`lib/guide-prompt.js` additions:

- Extract dates/party whenever the traveler states them (including relative
  forms — "spring break week", "the week after Christmas" → resolve to real
  dates, current date is in the prompt context).
- These fields do **not** filter results yet; they qualify the shortlist and
  the brief. Keep recommending on fit. (When availability filtering arrives it
  slots in behind the same fields.)
- Feed the same values into the existing `[[BRIEF: … when=… party=… ]]` tag —
  field names already exist in the brief parser; no handoff route change.

`lib/search-offerings.js`: echo the captured fields back on the tool meta so
the client can persist them:

```js
// GuideToolMeta gains:
trip?: { checkIn?: string; checkOut?: string; adults?: number; childrenAges?: number[] }
```

GuideChat, on the meta frame: if `meta.trip` present →
`setTrip(meta.trip, "guide")`. This is how chat-first capture ("2 adults, kids
7 and 9, March 14–21") reaches the same state the strip writes.

## 4. The booking-link seam — `lib/atlas/booking.js`

**Every booking CTA in the app calls one function.** No component ever
concatenates a TravelWits URL.

```js
// lib/atlas/booking.js
// mode: "off" | "portal" | "deep" — from NEXT_PUBLIC_BOOKING_MODE (default "portal")
function bookingLink(hotel, trip) {
  // returns { url, label, external: true, note?: string } | null
}
```

- `off`: returns null → no CTA renders anywhere.
- `portal` (today): returns the generic `bookUrl` with
  `label: "Check VIP rates"` and `note: hotel.bookPassword ? "access code: " + bookPassword : undefined`
  — honest about what the link is; surfaced only on the card's expanded/detail
  view, never as the primary CTA.
- `deep` (Phase 2): builds the TravelWits per-property URL from the template
  below. Returns null (falling back to portal behavior) when the hotel has no
  TravelWits mapping or `trip` lacks dates — a "Book VIP rate" button must
  never point at a page that can't show a rate.

TravelWits unknowns, parked as named constants at the top of the module so the
integration is a fill-in-the-blanks change:

```js
const TW_URL_TEMPLATE = null; // e.g. "https://<portal>/hotel/{twId}?checkin={ci}&checkout={co}&adults={ad}&childAges={ages}"
// data/atlas/hotel/travelwits-ids.json — { [bevvipHotelId]: "<travelwits property id>" }
// Open questions for TravelWits: id scheme, child-age param format,
// whether deep-linked sessions still require bookPassword, rate-code param for VIP rates.
```

The id-mapping file is the long-lead item — start requesting the property-id
export from TravelWits now, before the API work begins.

## 5. Card CTA behavior (ResultCards, then Hotel Atlas)

ResultCards hotel cards read `getTrip()` + `bookingLink(hotel, trip)`:

- link returned with mode `deep` → primary CTA **"Book VIP rate →"**
  (external, new tab), subtitle "{checkIn}–{checkOut} · {party summary}".
- link returned with mode `portal` → secondary text link "Check VIP rates"
  + access-code note. Primary CTA stays "Open in Atlas" / "Ask The Guide".
- null → no booking UI at all.

Re-render on `bevvip:trip` events so CTAs light up the moment dates arrive —
including on cards from *earlier* turns in the transcript.

Hotel Atlas (later, Phase 2b): pass trip state on the iframe src
(`/maps/hotel/?ci=…&co=…&ad=…&ch=…`), atlas cards call the same
`/api/hotel`-side link builder. Not in scope for the strip release; the seam
makes it additive.

## 6. Phasing — the trust rule

**The rule: no up-front "book" affordance until the link behind it lands on a
rate page.** Today's `bookUrl` is `https://www.VipTravelAi.com` + password for
all 2,501 hotels; a traveler who fills in dates and hits a generic gated
homepage is lost at peak intent.

- **Phase 1 (now):** `trip-state.ts`, BookingStrip (labeled "See VIP rates" —
  it promises a shortlist, not a checkout), schema + prompt extraction, meta
  echo, brief enrichment, `booking.js` in `portal` mode. Everything except the
  deep link ships and starts paying off immediately in shortlist quality and
  advisor briefs.
- **Phase 2 (with TravelWits API):** fill `TW_URL_TEMPLATE`, add
  `travelwits-ids.json`, flip `NEXT_PUBLIC_BOOKING_MODE=deep`. The strip's
  submit and every existing card CTA upgrade in place; no component changes.
- **Never:** booking controls on the Living Atlas. It stays the reflection
  layer.

## 7. Touched files (Phase 1)

| File | Change |
|---|---|
| `lib/types.ts` | `TripState`; `GuideToolMeta.trip` |
| `lib/trip-state.ts` | new — get/set/subscribe over sessionStorage + event |
| `components/BookingStrip.tsx` | new — empty-state strip + folded summary chip |
| `components/GuideChat.tsx` | render strip; persist `meta.trip`; summary chip |
| `components/ResultCards.tsx` | booking CTA slot via `bookingLink()` |
| `lib/search-offerings.js` | schema fields; echo `trip` on meta |
| `lib/guide-prompt.js` | extraction rules; brief `when=`/`party=` alignment |
| `lib/atlas/booking.js` | new — the single link seam, `portal` mode |

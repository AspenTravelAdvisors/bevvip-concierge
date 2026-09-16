---
name: curated-jet-refresh
description: The monthly refresh for the two private-jet brands no API feeds us — National Geographic and Safrans du Monde. Use when restocking their departures, when the audit reports a landing-page card pointing at an empty filter, when a supplier announces a new season, or when asked to check whether the Nat Geo or Safrans trips are current. Covers editing the curated atlas data, rebuilding the feeds, fixing the landing pages, and raising the alert when the pages we do not deploy have fallen behind.
---

# Refreshing the curated jet brands

## What makes these two different

Every other collection in the atlas restocks itself. `sync:virtuoso` pulls the
Partner API, `merge:virtuoso-journeys` rebuilds the five atlases from it, and a
new season arrives without anyone deciding it should.

Two jet brands are outside that loop:

| Brand | Curated departures | Why it is curated |
|---|---|---|
| National Geographic | 9 | The Virtuoso tours feed carries 102 jet tours and not one is Nat Geo. Dates come from Nat Geo's own published calendar. |
| Safrans du Monde | 18 | A Paris maison with no Virtuoso relationship at all. Dates come from safransdumonde.com. |

`buildTourAtlas` in `scripts/merge-virtuoso-journeys.mjs` keeps them by a rule
rather than a brand list — **every base trip whose `u` is not a virtuoso.com
URL survives a rebuild**. That is what "bespoke" means in that file, and it is
exactly these 27 trips.

Keeping is not refreshing. Left alone these two only ever shrink: `dropPast()`
retires each departure as it sails and nothing adds the next season. The decay
is invisible on the globe (a smaller atlas looks like a normal atlas) and
invisible in The Guide (fewer results looks like a narrow query). It surfaces
first as a landing-page card linking to an empty filter — the one place a
traveller notices.

Run this monthly, in the first week.

---

## Step 0 — Orient

```bash
cd next-concierge && npm run audit:curated-jet
```

Read the three blocks it prints before touching anything:

- **RUNWAY** — bookable vs curated per brand, distinct itineraries, next and
  last departure, and months of runway. Under 6 months means the supplier has
  probably announced a season we have not picked up; under 3 means the page is
  about to start emptying in front of someone.
- **SAFRANS LANDING PAGE** — every card in the deck and how many atlas journeys
  its deep link actually resolves to. A `✗` is a dead card.
- **FINDINGS** — sorted worst first. `✗` blocking, `▲` a page we do not deploy
  has gone stale, `!` a warning, `·` a note.

`--json` gives the same thing machine-readable; `--strict` exits non-zero on the
blocking findings only.

---

## Step 1 — Get the supplier's real calendar

This is the manual half and there is no shortcut: both suppliers publish to a
web page and neither has an API.

- **National Geographic** — `nationalgeographic.com/expeditions/trip-types/private-jet/`,
  plus the per-itinerary pages and their terms pages, which carry the exact
  start and end dates.
- **Safrans du Monde** — `safransdumonde.com`, the expeditions and Collection
  Précieuse listings.

**Network note:** this repo's remote sessions run behind an egress policy that
denies both domains (`403` on CONNECT). `WebSearch` still works and is enough to
confirm that an itinerary exists and when it departs, but it will not give you a
day-by-day. When the itinerary detail is needed, ask the operator to paste the
page or drop the PDF into the session. **Never invent an itinerary** — a
fabricated day list ships to the globe as a drawn route and to The Guide as an
advisor's recommendation.

Write down, per departure: exact name, start date, end date, and the stops in
order. Compare against the RUNWAY block: anything published that is not in our
list is a gap; anything in our list that the supplier has dropped is a retirement.

---

## Step 2 — Edit the curated data

**Edit `data/atlas/jet/itinerary.base.json`. Nothing else.**

`data/atlas/jet/itinerary.json` and `public/maps/jet/itinerary.json` are both
*generated* — the merge rebuilds them from the base and overwrites whatever is
there. (`scripts/apply-safrans-dates.mjs` writes the generated pair directly;
that was a one-shot repair, not the pattern to copy.)

### The index rule, which matters more than anything else here

`jt_<arrayIndex>` **is** the id — see the WARNING in `lib/atlas/adapters/jet.ts`.
The merge emits the bespoke block first, in base order, so today the curated
trips own `jt_0`–`jt_26`: Nat Geo `jt_0`–`jt_8`, Safrans `jt_9`–`jt_26`. Every
shared deep link, and every row in `itinerary-fit.json`, is a position in that
array.

Therefore:

- **Append new departures at the very end of `base.TRIPS`.** That places them at
  the end of the bespoke block and shifts no existing curated id.
- **Never insert into the middle** of the Nat Geo or Safrans run. Adding one Nat
  Geo trip at `jt_5` repoints every Safrans link by one.
- **Retiring a departure: reuse the slot, do not delete it.** Overwrite it with
  the next departure of the same product, so a stale link lands on the closest
  live equivalent instead of on whatever slid into its index. This is the
  reasoning `apply-safrans-dates.mjs` documents for slot 132 and it still holds.

### Fields

```jsonc
{
  "d": "2/25/2027",          // departure, M/D/YYYY — NOT ISO, the jet feed is US-format
  "r": "3/19/2027",          // return
  "n": "Jewels of the Pacific Rim by Private Jet",
  "b": "natgeo",             // or "safrans" — must exist in BRANDS
  "route": "jewels-of-the-pacific-rim-by-private-jet",  // key into ROUTES
  "u": "https://www.expeditionbucketlist.com/...",      // MUST NOT contain virtuoso.com
  "days": 23,                // inclusive: same-day out and back is 1 day
  "itin": [ { "d": 1, "n": "Panama City", "date": "2027-02-25" } ]
}
```

- `u` is load-bearing. A virtuoso.com URL here makes the merge treat the trip as
  supplier-sourced and **drop it on the next rebuild.**
- `days` is inclusive and should be recomputed from the dates, not copied from
  marketing copy. The feed and the supplier disagreed on 9 of 11 Safrans
  journeys last time anyone checked, and `endFrom()` reads this.
- A new `route` slug needs a matching `ROUTES` entry — an ordered array of
  `{ n, r, ll: [lat, lng] }` stops. That array is what the globe draws. Reuse an
  existing slug when the itinerary is a repeat season of the same product; the
  Nat Geo *Around the World* departures all share one.
- `world: true` is derived for round-the-world titles, but an explicit value in
  the base wins. Set it deliberately or leave it out.

---

## Step 3 — Rebuild and verify

```bash
cd next-concierge
npm run merge:virtuoso-journeys -- --atlas jet
npm run audit:curated-jet
npm run verify -- adapters deeplinks route-order route-flight
```

`audit:curated-jet` needs nothing but Node. The `verify` checks compile
TypeScript, so run `npm install` first in a fresh session or they fail on a
missing `tsc` rather than on anything you changed.

The merge writes **both** copies of the feed. If the audit reports a parity
finding, the merge did not run or something hand-edited a generated file.

Two things the merge can do that look like success:

- **`REFUSING jet: N journeys would become M`** — the shrink guard
  (`MAX_ATLAS_SHRINK`) tripped and the atlas was **left untouched**. Do not reach
  for `--force` until you understand which trips vanished; a malformed `u` on an
  edited trip is the usual cause.
- A quiet rebuild that drops a trip you just added — check `u` for a virtuoso.com
  substring.

---

## Step 4 — Bring the landing pages back in line

### Safrans — `public/safrans-du-monde.html`

The card deck is hard-coded in the `JOURNEYS` array in the page's script tag.
Each card links to `?brand=safrans&q=<card.q>`, and that query is the only join
between the card and the journeys it claims to show. Nothing enforces it, which
is why the audit checks it.

For each `✗` card, decide: **restock** (add the supplier's new departure in Step
2 so the existing `q` resolves again) or **retire** (delete the card). For each
year-mismatch warning, fix the `year` label so it agrees with the departures the
link returns.

When adding a card, pick a `q` whose tokens appear in the trip's name, brand,
region, route slug or itinerary stops — `filterJourneys` requires *every*
non-stopword token to match, so `"wonders asia 2026"` fails the moment the 2026
departure retires. Prefer a `q` that survives a season change (`"wonders asia"`)
over one pinned to a year, unless the card is deliberately year-specific.

Re-run `npm run audit:curated-jet` until the deck is clean.

### National Geographic — not in this repo

The Nat Geo page is a separate Vercel app, `nge-private-jet.vercel.app`, iframed
into the EBL website by a code block that sizes itself over `postMessage`. This
repo cannot change it. What this repo can do is notice that the departures moved
— which is Step 5.

---

## Step 5 — Raise the alert on what we do not deploy

Two surfaces live outside this repository:

| Surface | Where | How it updates |
|---|---|---|
| Safrans page on EBL | expeditionbucketlist.com, pasted HTML | Re-paste `public/safrans-du-monde.html`, swapping the relative `/atlas/jet` links for `https://guide.expeditionbucketlist.com/atlas/jet` |
| Nat Geo page | nge-private-jet.vercel.app | Update and redeploy that app so its itinerary list matches the atlas |

The audit fingerprints each surface's departures (and, for Safrans, the page
HTML) and compares them against `data/atlas/shared/curated-jet-publish.json`.
When they diverge it emits a `▲ [publish]` finding naming the surface and what
changed.

**Surface those findings to the operator explicitly in your summary.** They are
the whole reason this runs monthly: the repo can be perfectly current while the
page a traveller actually reads is a season behind, and nothing else in the
verification suite can see that.

Once the pages have actually been republished:

```bash
npm run audit:curated-jet -- --record
```

That writes the new fingerprints so next month compares against reality. Record
*after* publishing, never before — a recorded fingerprint is a claim that the
live page matches it.

---

## Step 6 — Commit

```bash
git add next-concierge/data/atlas/jet/itinerary.base.json \
        next-concierge/data/atlas/jet/itinerary.json \
        next-concierge/public/maps/jet/itinerary.json \
        next-concierge/public/safrans-du-monde.html \
        next-concierge/data/atlas/shared/curated-jet-publish.json
```

Commit the generated feeds alongside the base — the app reads them at runtime
and `prebuild` regenerating them does not help a reviewer see what changed. Say
in the message which departures were added, retired, or reslotted.

---

## Why ADVISOR FIT is in this report

`itinerary-fit.json` is keyed by atlas item id, and the jet id is an array
position. When the merge re-emitted `TRIPS` with the curated block at the head,
every jet fit row drifted off its trip: 79 of 127 journeys were being described
by a row belonging to a different supplier — and because `resolveBrandId()`
trusts a row's `brandId` ahead of the record's own label, that selected the
wrong brand profile, overlay, relationship boost and advisor notes too.

`lib/atlas/supplier-fit.js` now binds a row by identity (`fitRowFor`) and drops
one it cannot show describes the record, so the count should read **0 bound to
the wrong supplier**. If a curated edit ever pushes it above zero, the resolver
has stopped holding and that is a blocking finding, not a note.

A large `without a row` count is expected and benign — ranking falls back to the
brand profile. Regenerating the jet fit data would sharpen it and is its own
task.

## Standing finding

**`verify:curated-jet` is not in `scripts/verify-all.mjs`.** It exits non-zero
today on the dead Tour de France card, and wiring a red check into the suite
only teaches people to ignore the suite. Add it to `CHECKS` once the deck is
clean and keep it there.

## Files

| Path | Role |
|---|---|
| `data/atlas/jet/itinerary.base.json` | **The only file you edit.** Curated trips, BRANDS, REGIONS, ROUTES. |
| `data/atlas/jet/itinerary.json` | Generated. Read by `lib/atlas/journeys.js` — The Guide. |
| `public/maps/jet/itinerary.json` | Generated. Fetched by `AtlasJet.tsx` — the globe. |
| `public/safrans-du-monde.html` | The Safrans landing page, card deck included. |
| `data/atlas/shared/curated-jet-publish.json` | What the out-of-repo surfaces were last published with. |
| `scripts/audit-curated-jet.mjs` | The report driving all of this. |
| `scripts/merge-virtuoso-journeys.mjs` | `buildTourAtlas` — the bespoke-preservation rule. |
| `lib/atlas/dates.js` | `dropPast()` / `isPast()` — why a departed trip disappears. |
| `lib/atlas/journeys.js` | The query layer; `filterJourneys` is what a card's `q` hits. |

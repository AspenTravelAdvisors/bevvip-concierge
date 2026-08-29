# BeVvip — Supplier Architecture (what was actually built)

**Written:** 2026-08-28
**Supersedes:** `BeVvip_API_Integration_Strategy.md` (May 2026), which planned a
TravelWits integration against a codebase that no longer exists. That document
is kept as history because its central argument survived intact and is the load-
bearing rule here; everything it says about files and endpoints is obsolete.
**Protocol reference:** `Virtuoso_API_Reference.md` — auth, traps, endpoints.
**Engineering log:** `next-concierge/STATE.md`.

---

## 1. The rule the whole architecture is built on

> The language model never sees, invents, or displays a rate. It produces
> *intent* and *prose*. The backend produces *facts*.

The May document argued this before there was anything to enforce it with. It is
now enforced structurally rather than by discipline: **there is no rate data in
this system at all.** Not in the feeds, not in the atlas files, not in the
markup, not in the Guide's tool results. A price in an answer about a BeVvip
property is invented, and `/llms.txt` says so to any model reading the site.

Rates are quoted by a human advisor, or reached through the TravelWits portal
via a deep link that carries no price of its own.

---

## 2. Division of authority

**Virtuoso owns what a property or journey IS** — name, place, coordinates,
category, amenities, photography, room types, the year-stamped VIP benefits, and
the live supplier promotions.

**We own what Virtuoso has no opinion about** — which properties are curated
into which collection, ranking, the marquee region the map filters on, booking
links, advisor curation, and the answer copy.

Where the two collide, the resolution is an **overlay ledger**, never an edit to
the feed, so it survives a re-import:

| ledger | fixes |
|---|---|
| `data/atlas/hotel/program-overrides.json` | programme membership, where the feed stores the import channel instead |
| `data/atlas/hotel/country-overrides.json` | one country spelled two ways; values that are not countries |
| `data/atlas/shared/port-overrides.json` | ports geocoded to a namesake on another continent |
| `data/atlas/hotel/hotel-aliases.json` | identity across renames |

Every hotel overlay is applied through **one** function,
`lib/atlas/hotel-overlays.js`, read by the API, the map builder, the entity
pages and the verifier. That is deliberate: the same decision applied in three
of four places is this repository's most-repeated bug.

---

## 3. The pipeline

```
Virtuoso Partner API  →  raw feeds  →  merge + overlays  →  atlas files  →  build
   /v2/hotels             (NDJSON        (curation           (committed,     (pages,
   /v2/promotions          cached,        layered on          reviewable      artifacts)
   /v2/cruises             resumable)     supplier truth)     diffs)
   /v2/tours
```

**The data is committed, not fetched at request time.** Every supplier change
lands as a reviewable diff, because these files carry heavy hand-curation and a
supplier quietly dropping records is invisible without one.

`.github/workflows/virtuoso-sync.yml` runs the chain nightly at 09:00 UTC. Each
crawl is `continue-on-error` so a bad night for sailings cannot discard a good
hotel refresh, and the NDJSON cache carries between runs so a night that cannot
finish resumes rather than restarts.

### What it produces

| collection | records | source |
|---|---|---|
| hotels | 2,240 | `/v2/hotels` + curation (2,237 addressable; 3 portfolio listings) |
| expedition cruises | 3,662 | `/v2/cruises` |
| world cruises | 303 | `/v2/cruises` |
| yacht voyages | 467 | `/v2/cruises` |
| safaris | 274 | `/v2/tours` |
| rail | 130 | `/v2/tours` |
| private jet | 124 | `/v2/tours` + 27 bespoke kept deliberately |
| villas | 3,902 | Villas of Distinction, a static feed outside this pipeline |

### The guards between an unattended crawl and production

Nobody is watching at 3am, so four things must pass:

1. **Merge coverage** — refuses a feed under 90% detail coverage, and refuses
   again if any atlas would lose more than a quarter of its journeys.
2. **Shrink delta** — per-feed limits (10% default, 30% promotions because
   campaigns expire in batches, 25% journey atlases because departures sail).
   One feed over its limit blocks the whole commit, including feeds that
   refreshed perfectly: a crawl that fails publishes nothing new, a crawl that
   succeeds with half a catalogue publishes a deletion.
3. **Freshness** — judged on when a feed was last *checked*, not last *changed*,
   so a quiet fortnight at the supplier reads as healthy and a week of failing
   syncs does not.
4. **`verify:seo`** — the published answer copy is made of queries against the
   feed this job replaces, so a retired programme breaks a sentence without
   touching a line of code. It re-resolves every fact token and refuses a run
   that would publish an empty claim.

---

## 4. The query layer

`lib/atlas/index.js` dispatches seven collections in-process — no network, no
external deploys. Villas are served separately by `lib/villas.js` because their
contract is different (party size, bedrooms, nightly ceiling, not
region/month/brand).

**A collection is not shipped until it is registered here.** Safari shipped with
pins, a colour, a page and a menu entry and *without* a backend, so every safari
question in the Guide fell through to a hotel search and returned lodges where
an itinerary belonged — no error, no empty result, and nothing that looked wrong
from any of the seven places it was correctly wired. The registration list is
the checkable one.

---

## 5. The surfaces

| surface | what it is | crawlable |
|---|---|---|
| `/` | The Guide over a populated globe | shell only |
| `/atlas/<type>` | eight interactive maps | shell only |
| `/hotels/<country>/<property>` | 2,237 property pages, `Hotel` JSON-LD | yes |
| `/journeys/<collection>/<slug>` | 1,991 itinerary pages, `TouristTrip` JSON-LD | yes |
| `/villas` + `/atlas/villa/...` | 3,902 villa pages, `VacationRental` JSON-LD | yes |
| `/answers/<slug>` | 26 question pages, `FAQPage` + `Article` | yes |
| `/llms.txt` | what is first-hand here, and that we hold no rates | yes |

**A journey page is an ITINERARY, not a departure.** 3,662 sailings collapse to
902 pages because "Exploring Galápagos" runs 235 times; a page per departure
would be 235 near-duplicates.

**Answer copy states queries, not numbers.** `{{hotels:program=Marriott STARS}}`
and `{{journeys:collection=safari&country=Botswana}}` resolve at render from the
shipped data, so a sentence cannot outlive the number in it — the drift that had
already put "103 Marriott STARS properties" into indexed copy when the feed held
59.

---

## 6. Where the Guide fits

The Guide calls `search_offerings` — one channel per call, eight channels — and
answers only from what comes back. It holds no inventory of its own and cannot
reach the API. Its prompt names each pillar's live inventory explicitly so it
knows what it is allowed to claim, and routes to an advisor to close.

The seam the May document wanted is the one that exists: the model chooses
*which* facts to surface and how to frame them; it never authors a fact.

---

## 7. What is deliberately absent

- **Rates and availability.** See §1.
- **`aggregateRating` in markup.** The feed carries Virtuoso *advisor* review
  figures for 1,599 properties. They are collected by the supplier, not by us,
  and "% who recommend" is not a rating scale. Shown to readers in prose with
  the source named; kept out of the JSON-LD.
- **A country for a villa.** The villa feed's `destination` mixes countries, US
  states, Mexican resort towns and Canadian provinces, so `addressCountry` is
  omitted rather than guessed.
- **`geo` for the 236 villas on a locality centroid.** The page says the
  location is approximate; the markup does not claim otherwise.

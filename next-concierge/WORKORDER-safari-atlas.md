# Work Order — The Safari Atlas (the eighth collection, and the first that joins a stay to a journey)

**Goal:** Ship `/atlas/safari` from Virtuoso `/v2/tours` + the camps already in
`/v2/hotels`, and fix the listing defects that stand in front of it.

**Owner:** Cowork / Claude Code
**Repo:** `bevvip-concierge/next-concierge`
**Created:** 2026-08-27
**Blocked on:** Phase 0 is done. Phases 1–2 need `api.virtuoso.com` on the
session's network egress allowlist — the credentials are in place but every call
is refused by the proxy before it leaves the container.

Every number below is reproducible: `node scripts/audit-listings.mjs`.

---

## Why safari, and not one of the other things in the catalogue

We read **226 of the 13,348 tours** in `/v2/tours` — 1.7%. The sync fetches the
whole catalogue in one 8-second call and keeps what a `travelStyles: "Rail"`
facet or a private-jet name match selects. Everything else is discarded unread.
So "what can we add" is really "what is in the 98%", and safari is the answer
for a reason that is structural rather than editorial:

**Every atlas we have is half a trip.** The hotel and villa atlases plot places
to stay and draw no routes. The jet, rail, yacht and cruise atlases draw routes
and plot no stays — a jet journey's "stop" is a city, not a bed. A safari is the
one product where those are the same object: you fly into an airstrip, you sleep
at the camp, the camp *is* the waypoint, and the itinerary is a sequence of
camps. It is the first collection where our two feeds describe the same journey
from both ends, and the only one where a traveller browsing the map is looking
at the actual thing they will book.

Nothing else in the catalogue has that shape. Culinary, wellness, and cultural
tours are route-only and would be an eighth variation on the jet atlas.

### The inventory already in hand, before a single new API call

| | count | source |
| --- | --- | --- |
| African safari camps, geocoded, with Virtuoso perks | **30** | `luxury-hotels.json`, `propertyType: "Lodge, Ranch, Camp"` in a safari country |
| Lodge/ranch/camp properties worldwide | 68 | same field, all countries |
| Journeys reaching a safari country **inside the jet/rail slice** | 22 | `virtuoso-tours.json` |
| Journeys tagged `destinationRegions: "Africa"` in that slice | 31 | same |

The 30 camps are not a long tail. They are Singita ×5, Londolozi, MalaMala,
Royal Malewane, Tswalu, Jack's Camp, Mahali Mzuri, Ulusaba, Belmond's two
Okavango camps, One&Only ×2, Xigera, Loisaba. That is the blue-chip safari list
almost exactly, and every one of them already carries a coordinate, a
photograph, a room count and a year-stamped perks block.

The 22 tours are the tell for the other 98%. That slice was **never looking for
Africa** — it selected on "Rail" and on the words "private jet" — and it still
surfaced *East Africa by Private Air*, *Kenya and Uganda Safari by Private Air*,
*Southern Africa by Private Air*, and four Rovos Rail departures sold by
**andBeyond**, a safari operator that has no business being in a rail feed
except that it is a safari operator that also sells a train. A&K, andBeyond and
TCS are all already in our BRANDS tables.

### ⛔ What this work order does NOT propose

- **No ocean or river cruise expansion.** Both are out of scope by instruction,
  and the `/v2/cruises` selection stays exactly as it is.
- **No new map engine.** `buildTourAtlas()` in `merge-virtuoso-journeys.mjs` is
  already generic over `{atlas, kind, baseRel, outRel, publicRel}`, and
  `AtlasCollection` is generic over an `AtlasFilterDescriptor`. Safari is a
  config file and a 60-line component, not a new surface.
- **No sea routing, no landmask.** Safari legs are overland and light-aircraft.
  `geodesicLine` + `unrollLine` — jet's `routeFor`, verbatim — is the whole
  geometry. Legs are short enough that a great circle is near-straight, which
  is also what a Cessna over the Mara actually flies.

---

## Phase 0 — Fix what the safari atlas would inherit — **DONE**

These are four defects in code we control. Two of them are load-bearing for
Phase 3; all four are worth fixing whether or not safari ships.

**All four are fixed.** `npm run verify:listings` gates the two that are fully
landed; 272 records of CSS damage and 3 duplicate rows are fixed at source but
still sit in the stored feed, because only a Virtuoso crawl can repair them —
the audit prints them under "awaiting re-sync" and never gates them.

One correction to what this file originally said: **there were 3 duplicates,
not 24.** See 0.3.

### 0.1 · `Lodge / Safari` is 57% not-safari — and it is the label we sell

`deriveCategory()` in `scripts/merge-virtuoso-hotels.mjs` has two doors into the
category:

```js
if (type === 'Lodge, Ranch, Camp') return 'Lodge / Safari';   // 68 properties
…
if (exp.has('Ecotourism'))          return 'Lodge / Safari';   // +94 properties
```

The second door is the supplier saying *this property has a sustainability
story*, which is not the same claim at all. It puts **Ca' Sagredo Hotel** — a
palazzo on the Grand Canal — and **1 Hotel Nashville** into the safari bucket,
along with 12 Italian, 8 French and 4 Portuguese properties. 94 of 166.

This is not cosmetic. `data/answers/hotels.js` ships an SEO page,
`best-safari-lodges-with-vip-perks`, whose body says *"the 61 safari and
wilderness properties in our atlas"* and whose footer links to
`/atlas/hotel` labelled **"All 61 safari & wilderness lodges on the atlas map"**.
Three things are wrong with that one line: the count is stale (the category now
holds 166), more than half of what it counts is not a lodge, and the link
carries **no filter** — it opens the full 2,240-hotel atlas and leaves the
reader to find them.

**Fixed.** Split the category. `Lodge, Ranch, Camp` keeps `Lodge / Safari`;
Ecotourism-without-a-lodge-type falls through to the category its other
signals earn (most land in `Resort / Leisure`), and `Ecotourism` stays a *tag*,
which is what it always was.

Then repoint the answers page. The filter it needs already exists — `category`
is a declared facet on the hotel descriptor (`lib/atlas/adapters/hotel.ts:54`),
so `/atlas/hotel?category=Lodge+%2F+Safari` works today and nobody has ever
linked it. Derive the count from the data rather than typing it, so the page
cannot go stale a second time.

### 0.2 · One itinerary stop in ten is a stylesheet

**251 of 2,623** per-stop descriptions in `virtuoso-tours.json`, and 18 tour
descriptions, read like this:

```
p {margin:0px 0px 0px 2px;} ul {margin-top:2px;margin-bottom:2px;} .Normal {font-family:Verdana;…
```

The feed's own `_meta` advertises these as the reason to prefer the API:
*"Day-by-day stops carry the operator's own coordinates and per-stop prose."*

The `text()` helper — duplicated in `sync-virtuoso-tours.mjs`,
`sync-virtuoso-cruises.mjs` and `sync-virtuoso-hotels.mjs` — strips **tags** but
not the **contents** of elements whose contents were never prose. Suppliers
paste itinerary days out of Word, which brings its stylesheet inline, so
`<style>p {margin:0px}</style>` survives tag-stripping as literal text.

**Fixed.** `lib/virtuoso/text.mjs` now drops `<style>`, `<script>` and their
contents before stripping tags, and all four copies of the helper import it.
`prose()` refuses to publish a stylesheet as a description at all. Safari itineraries come from the same endpoint and would arrive with the
same 10% of their prose replaced by CSS.

```js
const text = html => String(html ?? '')
  .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')   // ← the missing line
  .replace(/<br\s*\/?>/gi, ' ')
  …
```

### 0.3 · 3 journeys are listed twice — and 39 that look identical are not

**This is the finding the first pass got wrong, and the error mattered.**

Grouping on the title says there are 24 duplicates. There are 3. *Australia by
Private Jet* appears three times because A&K sells a 2026, a 2027 and a 2028
departure of it; *India by Private Jet* likewise; *Southern Africa by Private
Air* the same. Each carries its own `travelDates` window, each is separately
bookable, and `whenLabelFor()` already prints that window on the card — so a
traveller looking at three of them is looking at three real choices and can tell
them apart. Collapsing on name would have deleted 21 rows of live inventory and
quietly retired next year's departures on every sync.

A duplicate has to match on operator, title, length **and departure window**.
Three groups meet that bar: two records of *Chasing the Aurora* both departing
8 Mar 2027, two of the Belmond Cornwall service over one season, and two of the
Canadian Rockies circle tour where one carries 13 itinerary stops and the other
11. The tiebreak is stop count, then the lower id, so a rebuild is deterministic
and a shared link keeps resolving to the same journey.

`dedupe()` in `sync-virtuoso-tours.mjs`. Verified against the shipped feed:
226 → 223, all 39 genuine departures survive, idempotent, order-independent.
The audit reports both numbers side by side, so a future selector change that
starts eating departures shows up as a drop rather than silently.

### 0.4 · The home page overstates the collection by 142

`lib/atlas-config.ts` hand-keeps a `count` per collection and
`collectionsHeadline()` sums them into the first sentence anyone reads. Six of
the seven are exact. `hotel` says **2,382**; `luxury-hotels.json` ships
**2,240**. The headline therefore claims 10,965 vetted stays and journeys over
a dataset of 10,823.

**Fixed.** Corrected to 2,240 and gated by `npm run verify:listings`. The same
pass caught four more stale counts in the `data/answers/` copy (2,501 hotels,
3,542 sailings) and a fifth defect nobody had looked for — see 0.6. A hand-kept number is a
reasonable choice here (the counts are editorial, not raw feed rows); a
hand-kept number nobody checks is not.

### 0.5 · Adjacent, lower priority: 167 hotels are dark

167 records (7.5%) carry `source: "local"` and no matched Virtuoso record —
no photograph, no experiences, no room detail, no perks text. On the map they
are a pin with a name standing next to 2,073 that are a property. **30 of them
are one substring away** from a Virtuoso record the matcher already has in
hand: `Four Seasons Hotel Cairo` → `Four Seasons Hotel Cairo at Nile Plaza`,
`Dorado Beach` → `Dorado Beach, a Ritz-Carlton Reserve`, `Hotel de Rome` →
`Hotel de Rome, Berlin`. A substring pass corroborated by city would recover
most of them; a few pairs are false (`Hotel Bristol` → `Grand Hotel Bristol Spa
Resort`) and need the city check to reject.

### 0.6 · The map a visitor loads can silently disagree with the feed — **found while verifying 0.1**

Recategorising the 94 properties moved `data/atlas/hotel/luxury-hotels.json` to
72 lodges. Resolving the new answers-page link through the real adapter returned
**166** — because the browser does not read that file. It fetches
`public/maps/hotel/hotel-points.json`, built from it by `npm run
build:hotel-points` in `prebuild`. The server-side count was right, the map a
visitor actually loads still filtered the old categories, and the Venetian
palazzo the whole fix was about was still in the safari list.

Prebuild would have caught it on deploy. Nothing caught it in the working tree,
which is where it is still a one-line fix. The audit now compares the two copies
category by category and gates on any disagreement — verified by restoring the
stale copy and watching `--strict` go red.

---

## Phase 1 — Learn what is actually in the catalogue — **BLOCKED ON EGRESS**

Credentials are in place and load correctly. `api.virtuoso.com` is **not on this
environment's network allowlist**, so every call returns
`403 Host not in allowlist` from the egress proxy before it reaches Virtuoso —
which means the credentials themselves are still unverified. Add the host to the
environment's egress settings, or run the sync somewhere that can reach it.
Everything below is unchanged and still the first thing to do.

**Do not write the selector before running this.** The `travelStyles`
vocabulary visible in our slice is six values (`Rail`, `Private`, `Group`,
`Escorted`, `Independent`, `Locally Hosted`) — and that is a jet/rail-biased
sample, not the facet catalogue. `lib/virtuoso/client.mjs` already exposes the
call that answers it properly:

```js
const v = createClient();
await v.filters('/v2/tours');                    // the whole facet catalogue
await v.filters('/v2/tours', 'Travel Style');    // one category
```

What to establish, and write into this file before Phase 2:

1. Is there a **`Safari` / `Wildlife` travel style**? If yes, the selector is a
   facet like rail's and the atlas is honest by construction.
2. How many tours carry `destinationRegions: "Africa"`? That is the ceiling.
3. What does `tourSubTypes` hold across the full catalogue? Our slice shows
   pipe-joined `travelStyles`, but that may be an artifact of the slice.
4. Confirm the **13,348** total is current.

**Expected outcome:** 300–800 selectable safari itineraries. If Phase 1 returns
fewer than ~120 after de-duplication, stop and re-scope to Phase 3b (the camps
layer alone, as a view on the hotel atlas) rather than shipping a thin eighth
collection next to 3,662 expedition sailings.

---

## Phase 2 — Selection and sync

Add a third `kind` to `scripts/sync-virtuoso-tours.mjs`, beside `jet` and `rail`.
A tour may carry more than one kind — *Kenya and Uganda Safari by Private Air* is
legitimately both `jet` and `safari`, and the existing `kinds[]` array already
supports that, so it needs no new machinery.

```js
/*
 * What counts as a safari.
 *
 * Two signals, and the region is required for both. Africa is the only place
 * "safari" is unambiguous — a "shark safari" off Isla Mujeres and a "photo
 * safari" in Alaska are the word borrowed, and letting the name alone select
 * would file both under a collection about game drives.
 */
const SAFARI_REGION = r => (r.destinationRegions ?? []).includes('Africa');
const SAFARI_NAME = /\b(safari|game (?:drive|reserve|park)|big five|gorilla trek|bush camp|tented camp|okavango|serengeti|masai mara|maasai mara|kruger|sabi sand|ngorongoro|luangwa|chobe|kalahari)\b/i;
const SAFARI_OPERATOR = /\b(andBeyond|Singita|Wilderness|Micato|Great Plains|Ker & Downey|Roar Africa|African Travel|Extraordinary Journeys|Natural Selection|Asilia|Elewana|Governors)\b/i;
```

Selection rule, in priority order — and keep the *narrow* one until Phase 1
says otherwise:

1. A `Safari`/`Wildlife` travel style, if Phase 1 found one. Facets win.
2. Otherwise: `SAFARI_REGION(row) && (SAFARI_NAME.test(row.name) || SAFARI_OPERATOR.test(row.company))`.

Then run the crawl. At ~800ms per sequential detail call (bearer tokens are
single-use — see `Master Documents/Virtuoso_API_Reference.md`), **500 tours is
about 7 minutes**. Cheap.

```
node scripts/sync-virtuoso-tours.mjs
```

**Validate before merging.** Print the by-country and by-operator breakdown and
read it. A safari selector that returns Marrakech riads and Cairo Nile cruises
has picked up "Africa" rather than "safari", and the fix is the name pattern,
not a downstream filter.

---

## Phase 3 — The atlas itself

Every piece of this already exists for jet and rail. Listed in dependency order.

| # | File | Work |
| --- | --- | --- |
| 1 | `lib/types.ts` | add `"safari"` to `OfferingType` |
| 2 | `data/atlas/safari/itinerary.base.json` | **new** — `BRANDS`, `REGIONS`; `ROUTES: {}`, `TRIPS: []` |
| 3 | `scripts/merge-virtuoso-journeys.mjs` | one line: `if (wanted('safari')) buildTourAtlas({ atlas: 'safari', kind: 'safari', baseRel: 'data/atlas/safari/itinerary.base.json', outRel: 'data/atlas/safari/itinerary.json', publicRel: 'public/maps/safari/itinerary.json' })` |
| 4 | `lib/atlas/adapters/safari.ts` | **new**, ~25 lines — copy `jet.ts`, set `collection: "safari"`, `idPrefix: "sf_"`, `idStrategy: "field"` |
| 5 | `components/AtlasSafari.tsx` | **new**, ~60 lines — copy `AtlasJet.tsx`; reuse its `routeFor` unchanged |
| 6 | `app/atlas/[type]/page.tsx` | one entry in `NATIVE_COLLECTIONS` |
| 7 | `lib/atlas-config.ts` | one `ATLASES` entry |
| 8 | `public/maps/safari/logos/` | operator marks, same convention as `/maps/jet/logos` |

### 7 · The registry entry

```ts
safari: {
  type: "safari",
  label: "Safari atlas",
  nav: "Safari Journeys",
  nounPlural: "safari journeys",
  tagline: "Camp to camp across Africa, drawn between the airstrips",
  base: "/atlas/safari",
  sampleRegions: ["EASTAFRICA", "SOUTHERNAFRICA", "OKAVANGO", "GREATMIGRATION"],
  color: "#c8813f",                 // ochre — unclaimed; nearest is jet's #dfe5f2
  count: 0,                         // set from the merge report, then verified
  order: 8,
  intent: "land",
},
```

`intent: "land"` puts it under **By Land** beside Rail Journeys, which is where
a traveller looks for it. It is not `stay` even though the waypoints are camps —
the product being chosen is the itinerary.

### 2 · Regions

The eight regions a safari traveller actually distinguishes between. `coord` is
`[lat, lng]`, matching every other atlas's `REGIONS`:

| key | name | ab | coord |
| --- | --- | --- | --- |
| `EASTAFRICA` | Kenya & Tanzania | E. Africa | `[-2, 36]` |
| `GREATMIGRATION` | Serengeti & the Mara | Migration | `[-2.3, 34.9]` |
| `SOUTHERNAFRICA` | South Africa & the Cape | S. Africa | `[-27, 25]` |
| `OKAVANGO` | Botswana & the Delta | Okavango | `[-19.5, 23]` |
| `ZAMBEZI` | Zambia, Zimbabwe & the Falls | Zambezi | `[-17.9, 25.8]` |
| `NAMIBIA` | Namibia & the Skeleton Coast | Namibia | `[-22, 16]` |
| `GORILLA` | Rwanda & Uganda | Gorilla | `[-1.4, 29.6]` |
| `INDIANOCEAN` | Zanzibar & the Indian Ocean | Indian Ocean | `[-6.2, 39.4]` |

`INDIANOCEAN` earns its place because the beach extension is half the product —
a fortnight in the Mara ends in Zanzibar often enough that a traveller filtering
it out is making a real choice.

`buildTourAtlas` assigns each stop its region by nearest anchor
(`regionOf`), with `inheritedRegion` letting the base override geometry. Two
places will need an explicit override for the same reason Ulaanbaatar did:
**Victoria Falls** sits between `ZAMBEZI` and `SOUTHERNAFRICA`, and **Arusha**
between `EASTAFRICA` and `GREATMIGRATION`. Both belong to the first of each pair.

### 5 · Geometry — reuse jet's, and resist improving it

Safari legs are light-aircraft airstrip hops (Wilson → Mara, Maun → the Delta)
and road transfers. `geodesicLine` over a 200km leg is visually straight, which
is honest. Do **not** reach for the sea router's `arcPts` bezier: its bulge
follows leg direction, so an out-and-back Nairobi → Mara → Nairobi would draw a
lens instead of a path — the exact bug the comment at the top of `AtlasJet.tsx`
records having already been fixed once.

### The thing that makes this atlas different from the other seven

Once the routes draw, add the **camps as a persistent underlay**: the 30
geocoded `Lodge, Ranch, Camp` properties from `luxury-hotels.json`, plotted
beneath the journey lines and clickable through to the hotel dossier that
already exists (`components/HotelDossier.tsx`).

That join is the argument for the collection. A traveller looking at *Southern
Africa by Private Air* sees the route, and sees that three of its nights are at
Singita Sabi Sand — a property we hold perks on, with 40 photographs and a
year-stamped benefits block. No other atlas can do that, because no other
collection's waypoints are places we also sell.

Match camps to itinerary stops on coordinate proximity (~25km), not name:
`Singita - Singita Sabi Sand` in the hotel feed and `Sabi Sand` in a tour
itinerary will never string-match, and they are 4km apart.

---

## Definition of done

- [ ] `node scripts/audit-listings.mjs --strict` passes (all ▸ findings at zero)
- [ ] Phase 1 facet findings written into this file
- [ ] `npm run verify` green — `verify:atlas-regions` and `verify:route-order` cover the new atlas automatically once it is in `ATLASES`
- [ ] `/atlas/safari` renders, filters by region, and traces a route
- [ ] Camps underlay resolves to the hotel dossier
- [ ] `collectionsHeadline()` counts the new collection and matches what ships
- [ ] `data/answers/hotels.js` safari page links to a *filtered* atlas with a derived count

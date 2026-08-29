# Work Order — The Safari Atlas (the eighth collection, and the first that joins a stay to a journey)

**Goal:** Ship `/atlas/safari` from Virtuoso `/v2/tours` + the camps already in
`/v2/hotels`, and fix the listing defects that stand in front of it.

**Owner:** Cowork / Claude Code
**Repo:** `bevvip-concierge/next-concierge`
**Created:** 2026-08-27
**Status: SHIPPED, 2026-08-28.** The egress block below was resolved and every
phase ran. The atlas holds **274 safari journeys** across 20 operators and 12
region tags; `/atlas/safari` is live, `public/maps/safari/camps.json` is rebuilt
nightly, and 250 itinerary pages serve at `/journeys/safari`.

**The one thing shipping did not include, and it took a day to notice:** the
collection had no query backend. `lib/atlas/index.js` registered six, so
`queryAtlas("safari")` threw, `safari` was not in the `search_offerings` tool
enum, and every safari question in The Guide fell through to
`searchHotels` — a lodge shortlist where an itinerary belonged, with no error
anywhere. `lib/atlas/safaris.js` closes it. See STATE.md, "Safari was on the map
and outside the product". The lesson is in the shape of the miss: a collection
that ships in eight places and is registered in seven looks complete from every
direction except the one nobody checks.

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

## Phase 1 — Learn what is actually in the catalogue — **DONE**

> Historical note, kept because the block was real and may recur: this phase sat
> blocked because `api.virtuoso.com` was not on the session's network egress
> allowlist, so every call returned `403 Host not in allowlist` from the proxy
> before it reached Virtuoso — which meant the credentials could not be verified
> either. If a future session sees that 403, this is what it is. The host was
> allowlisted, the crawl ran, and the outcome is below.

**Outcome:** the selection landed at **274 journeys**, against the 300–800 this
phase predicted and comfortably above the ~120 floor that would have triggered a
re-scope to Phase 3b. The region taxonomy the selector produced is the sixteen
tags in `data/atlas/safari/itinerary.json`'s `REGIONS`, of which twelve carry
journeys today — `ANTARCTIC`, `HIGHARCTIC`, `CHURCHILL` and `PATAGONIA` are
declared and unused, which `lib/atlas/safaris.js` maps anyway so the first
journey filed under one is not a silent zero.

Everything below is the original brief, kept as written.

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

## Phase 4 — What shipped after the first pass, and what it found

Phase 3 landed the collection; browsing it turned up four defects and one
missing axis. All five are fixed.

### 4.1 · The routes were drawn on the wrong continent

`routeFor()` in `AtlasSafari.tsx` read the feed's `ll` — `[lat, lng]`, the
convention every atlas's `ROUTES` and `REGIONS` use — and handed it straight to
Mapbox, which reads `[lng, lat]`. The Namibia circuit, `[-22.57, 17.08]`, drew
as latitude 17 / longitude −22: a triangle in the Atlantic off Cape Verde.
Every one of the 269 journeys was wrong the same way.

It now draws `o.path`, which `journey.ts` has already run through
`fromLatLngPair()`, in itinerary order — the same source `AtlasJet` uses.

**Nothing in the suite could have caught this**, which is the more useful part
of the finding. `verify:atlas-regions` checks the DATA, and the data was
correct; `verify:atlas-ui` drove a real browser and asserted a route was
painted, layers existed and the camera got finite numbers — all true of a route
in the wrong ocean. `verify:atlas-ui` now compares the drawn route's bounding
box against the bounding box of the stops the same click emitted. The two
sources are derived independently (stops from the adapter, route from the
collection's own `routeFor`), so a transposition on either side pulls them
apart. Verified by reintroducing the bug: that one assertion goes red and the
other five stay green.

### 4.2 · Safari and rail were the two colours nobody could tell apart

Ochre `#c9812f` sat **18.0 CIELAB ΔE** from rail's copper `#e08d5f` — the
closest pair in `ATLASES`, against a next-closest of 22.3 (hotel/yacht) — and
the two collections sit together under *By Land*, adjacent in the legend, drawn
as lines on the same dark globe. The warm band was full: rail 22°, safari 30°,
yacht 43°, hotel 50°.

Safari is now jacaranda `#b57edc`, 45.1 ΔE from its nearest neighbour, at L* 62.
`AtlasShell`'s overlay table also kept its own hand-copied literal per
collection; it now reads `ATLASES[type].color`, so the globe legend and the
atlas accent cannot disagree again.

### 4.3 · The safari atlas had no route verb

`ROUTE_VERB` in `atlas-config.ts` had five collections. Safari was not one of
them, so `routeVerbLong()` returned null and the card never rendered the control
that traces and frames a journey — on the only collection whose routes had just
been fixed. It is `Track` — not `Fly`, because the legs are light aircraft
*and* Land Cruisers, and naming one describes half the journey.

### 4.4 · The camps, joined — the thing this collection exists for

`scripts/build-safari-camps.mjs` joins the `Lodge / Safari` properties in the
hotel atlas to safari itinerary stops within **25km**, and ships the result as
`public/maps/safari/camps.json` (48 KB, against 992 KB for the whole hotel
atlas). **22 camps sit on 199 of the 269 journeys.**

- Matched on coordinate, never on name: the hotel feed says
  `Singita - Singita Grumeti` and the tour feed says `Singita Grumeti Reserves`,
  4km apart and unmatchable by any string metric that does not also pair things
  that are not the same camp.
- Its own file, not a field on the itinerary: the two inputs are rebuilt by two
  independent syncs, and a derived field both of them own goes stale on
  whichever runs second. `npm run verify:safari-camps` gates it.
- The dossier says *"our camps along this route"* and never *"you sleep here"* —
  four of our Sabi Sand lodges are within 25km of the single stop
  `Sabi Sand Game Reserve`, and the feed does not name which one the operator
  booked.

The count in the old adapter comment — **166 safari lodges** — was the pre-fix
figure, from when `deriveCategory()` was still filing Ecotourism hotels
(a palazzo on the Grand Canal among them) as lodges. The category has held
**72** since 0.1, of which **32** are in countries these journeys visit. Both
numbers are now derived by the build; nothing types either.

### 4.5 · Wildlife — the axis a safari traveller actually arrives with

Region, brand, month and length are the four axes every journey atlas shares,
and not one of them is *what will I see*. `lib/atlas/wildlife.ts` reads the
supplier's own prose and tags each journey with the animals it names.

- **147 of 269** safari journeys carry at least one tag, across 30 options.
  `?wildlife=Gorilla` returns 27 — including *Bisate & all its Beauty*, which
  has no gorilla in its title and is entirely about them.
- Reused, unchanged, by the expedition cruise atlas: **682 of 3,662** sailings,
  where the wildlife *is* the product. Declaring the facet is the whole opt-in;
  rail and jet declare nothing and pay nothing.
- It refuses to infer from geography. The Serengeti obviously has lions, and
  tagging it for them would be inventing a claim the operator did not make.
- Two bugs found while building it, both now fixed at the source:
  - English names many animals after other animals. Run naively over the
    expedition feed it produced **Lion 111** (88 sea lions, 23 made of stone —
    Delos's Terrace of the Lions, the Sphinx's "body of a lion") and
    **Elephant 40**, every one of them *"Weddell and elephant seals"*. Compound
    names are now rewritten to the animal they are actually about *before*
    matching — "sea lions" → seal — so the sighting is kept and filed correctly
    rather than suppressed.
  - `facetOptions` in `AtlasFilterRail` counted only `raw[0]` of a plural
    attribute. Correct while the only plural axis was hotels' hidden `region=`;
    with a visible plural axis the menu and the filter disagreed about the same
    record — a count of 3 opening a list of 11.

### 4.6 · Operators seeded ahead of the crawl

`merge-virtuoso-journeys.mjs` **drops** any tour whose company matches no key in
the atlas's `BRANDS` table (`unmatchedBrand`), so a missing entry is not a
missing logo — it is a missing journey, selected and downloaded and thrown away.

Natural Habitat was already there (4 journeys). **Tauck**, **Giltedge Africa**
and **Remote Lands** are now seeded in `itinerary.base.json` and named in
`SAFARI_OPERATOR`, so the first crawl that reaches `api.virtuoso.com` brings
them in branded. None appears in the stored feed today because that feed is the
pre-egress slice, which only ever looked for `Rail` and private-jet names —
their absence is an artefact of what was fetched, not of what Virtuoso sells.
Remote Lands already carries 24 journeys in the jet atlas, where its brand key
has existed all along.

### 4.7 · Three copies of one build step, and the one that broke

`verify-adapters`, `verify-deeplinks` and `verify-hotels` each carried their own
copy of the tsc-output rewrite, each with a comment telling the reader to keep
it in step with the other two, and each listing the importable `lib/atlas`
modules **by hand** — a list on which `geo` was the only name. Adding
`wildlife.ts` broke two of the three with a bare `ERR_MODULE_NOT_FOUND` naming a
package called `"@/lib"`. They now share `scripts/lib/adapters-build.mjs`, whose
rule is the one that was always true: `rootDir` is `lib/atlas`, so every
compiled module sits one directory above `adapters/`. Nothing needs listing.

---

## Phase 5 — What qualifies, reconsidered

The question that prompted this: *Natural Habitat sells 21 journeys on Virtuoso
and this atlas holds 4.*

### 5.1 · The old rule, and why the count was 4

`isSafari()` was three tests, **all** of which had to pass:

1. a country in a list of thirteen African ones, **and**
2. a `Wildlife & Nature` experience or a safari word in the name, **and**
3. an operator we sell.

Test 1 is the whole answer. Nat Hab's four survivors are the three Botswana
itineraries and the Kenya migration; the Alaska grizzly camp, the Churchill
polar bears, the Galápagos, Yellowstone in winter and the Indian tiger parks
were every one of them excluded for being in the wrong hemisphere. They are the
same product, from the same house, for the same traveller. White Desert's
Antarctic camps never had a chance either.

**Test 1 is gone.** Its job — keeping out the things that merely use the word —
now falls to the other two, which is where it belonged:

- **The journey is about wildlife.** `isWildlifeJourney()` in
  `lib/atlas/wildlife-terms.js`, the same vocabulary the atlas filter tags with:
  the supplier's own `Wildlife & Nature` classification, or a product name that
  says what the trip is, or prose naming **at least two different animals**.
  Two, not one, is the line between "mentions" and "is about".
- **A house we sell it from.** The quality bar the original rule already leaned
  on, extended with the worldwide wildlife specialists — Natural Habitat, White
  Desert, Lindblad/National Geographic, Frontiers North, Churchill Wild,
  Natural World Safaris, Bushtracks — and with three houses already in this feed
  selling wildlife journeys it was refusing.

Both directions of the gate are visible in the shipped feed. Refused: *Tiger
Express, Eastern & Oriental Express* (a Belmond train named after a tiger), and
*Classic Rocky Mountain Rail Circle Tour*, which advertises "wildlife viewing of
Grizzly bears, moose, elk and more" and is a scenic train that passes animals.
Admitted: *In Search of the Royal Bengal Tiger*, *Wildlife Kingdoms of Brazil*,
*Wildlife & Natural Wonders: The Americas*, and — the one that makes the point
best — andBeyond's *Rovos Rail: Pretoria-Durban*, whose own description opens
"This safari between Pretoria and Durban … includes game drives" and visits a
Big Five conservancy. It stays a rail journey too; a tour carries as many kinds
as it earns.

**269 → 274 without a crawl.** The selector lives in
`lib/virtuoso/safari-selector.mjs` and has two callers: the sync applies it at
crawl time, and the merge applies it to the feed already on disk, so a widened
definition reaches inventory we already hold. The merge's use is **additive** —
it can admit a stored tour, never reject one — because the crawl reads a field
the feed does not keep (see 5.2). The number a real crawl returns will be much
larger; the stored 505 were never selected with anything outside Africa in mind.

### 5.2 · The selection signal was thrown away after use

`isSafari()` has always tested `experiences` for `Wildlife & Nature` — the
supplier's own classification, and the single strongest signal in the feed — and
the stored record has never kept the field. Of the 281 tours the crawl filed as
safari, only ~178 can be re-derived from disk. Nobody auditing the collection
offline could tell which 103 were which, and no widened rule could be tested
against them.

`sync-virtuoso-tours.mjs` now stores it. Until a crawl runs, the merge's
`kinds` fallback is load-bearing; after one, it is belt and braces.

### 5.3 · Regions, because a journey with no region is invisible

The base carried six anchors, all African. `regionOf()` leaves a stop further
than its reach from every anchor untagged, so an Alaska journey would have drawn
on the map with no region at all and been unreachable by the region filter. Ten
non-African anchors are added — Alaska, the Rockies, Churchill, the High Arctic,
Antarctica, Galápagos, Amazonia, Patagonia, the Subcontinent, Borneo — placed on
the wildlife rather than the airport.

That immediately produced the failure `MAX_REGION_KM`'s own comment warns about.
At a flat 2,500km, **Boston** was tagged `CHURCHILL` (2,427km, and nearer to
nothing else) and Portland was tagged `ROCKIES` at 953km — two gateway cities on
a round-the-world wildlife jet, and a traveller filtering for Churchill polar
bears would have been shown a journey that never goes there. Six anchors tiling
Africa can afford 2,500km because the gaps between them are also game country;
one anchor on a continent cannot.

So **a region now declares its own reach**. `maxKm` is optional and defaults to
the old 2,500, so nothing that predates it moves; the ten new anchors carry
800–2,000km each. How far an anchor's authority extends is a property of the
region, not of the atlas.

### 5.4 · The audit was checking seven of eight counts

`SHIPPED` in `audit-listings.mjs` — the table behind the check that caught the
home page overstating the collection by 142 hotels — had seven entries. Safari,
the newest collection and the only one whose count was actively moving, was not
one of them, and a missing row is silent in both directions: the audit reported
"0 of 7" and passed while the headline drifted. It is eight now, and the
headline claims 11,102 against a dataset of 11,102.

### 5.5 · The atlas no longer promises Africa

`label` is "Safari & wildlife atlas" and the tagline is "Where the wildlife is —
the migration and the Delta, the ice and the rainforest". The nav label stays
**Safari**, because that is the word a traveller arrives with.

---

## Definition of done

- [x] `node scripts/audit-listings.mjs --strict` passes (all ▸ findings at zero)
- [ ] Phase 1 facet findings written into this file — still blocked on egress
- [x] `npm run verify` green for everything this touches — `verify:adapters`,
      `verify:deeplinks`, `verify:hotels`, `verify:atlas-regions`,
      `verify:route-order`, `verify:listings`, `verify:safari-camps` and
      `verify:atlas-ui` all pass. (`verify:route-flight` fails on a hop with no
      geometry — confirmed failing on a clean checkout of `main` too, and
      untouched by this work.)
- [x] `/atlas/safari` renders, filters by region, and traces a route — proved in
      a real browser by `ATLAS_UI_TYPES=safari npm run verify:atlas-ui`
- [x] Camps resolve to the hotel dossier, from the journey file
- [x] `collectionsHeadline()` counts the new collection and matches what ships
      (10,828 claimed, 10,828 held)
- [x] `data/answers/hotels.js` safari page links to a *filtered* atlas with a
      derived count, and the atlas links back

# Base Camp — STATE

Running record of what is live in next-concierge (deployed at bevvip-concierge.vercel.app,
Vercel Root Directory = `next-concierge`). Update this file when an offering type,
data source, or major surface ships.

## UX pass — SHIPPED 2026-07-27

Full rationale in `UX-AUDIT.md`; that file is the record of *why*, this is the
record of *what*. Waves 1–4 of the audit shipped; item 9's target fix (one map)
and item 16 (result-shape normalization) did not — see "Deliberately not done".

**Load-bearing changes, in the order they matter:**

1. **The advisor path is no longer gated behind a search.** The hand-off form
   was extracted from GuideChat into `components/AdvisorRequest.tsx` — one
   dialog, opened from anywhere via `openAdvisor({ source, context })`. It is in
   the header on every page, in the chat session bar, and on every atlas route.
   One label everywhere ("Send this to an advisor" / "Talk to an advisor" cold);
   the six category-specific button labels became `HANDOFF_BLURB` supporting
   copy in `lib/handoff.ts`. The form shows the traveler the brief being sent.
2. **`lib/atlas-config.ts` is now the canonical collection list.** `COLLECTIONS`
   (ordered, colored, counted) feeds the header menu, the map legend and the
   home blurb, which previously disagreed — four collections named in the blurb,
   seven in the nav, and however many had finished loading in the legend.
3. **Nav rebuilt.** `NavTabs.tsx` + `GuideTab.tsx` deleted → `SiteNav.tsx`:
   The Guide · Explore ▾ · Answers · How this works · **Talk to an advisor**.
   (The old "The Guide" tab swallowed clicks on `/` to open the tour.)
4. **The tour no longer auto-opens.** Opt-in from "How this works"; 7 slides → 4.
5. **Booking tells the truth.** `bookingLink()` returns `label: "Search VIP
   rates"` (was "Book VIP rate"), plus `stay` and `needsDates`. When no real
   dates are captured, ResultCards asks for them inline instead of linking to a
   silently-defaulted tomorrow-night search.
6. **Persistence moved to localStorage.** `lib/conversation-store.ts` +
   `lib/trip-state.ts`; conversations older than 45 min are offered back via a
   resume prompt rather than silently restored. Start over clears both.
7. **`lib/analytics.ts`** — Vercel Analytics + the lead funnel:
   `ask_sent → results_returned → advisor_cta_clicked → advisor_request_sent`,
   with `booking_clicked` as the parallel self-serve path. Nothing was measured
   before this.
8. **`components/AtlasFrame.tsx`** wraps all seven collection routes (both the
   iframed Leaflet maps and the server-rendered villa browser) in one consistent
   bar: breadcrumb, count, an "ask about this" box, advisor CTA.

**Deliberately not done:**

- **One map (audit item 9, target).** Base Camp still has three map products:
  the Mapbox globe (`AtlasShell`), six iframed Leaflet apps under
  `public/maps/*`, and `VillaAtlas`. AtlasFrame makes the *frame* consistent;
  it does not unify the maps. This is a port and needs its own project. No
  traffic yet = no redirect risk when it happens.
- **Result-shape normalization (item 16).** `ResultCards.cardDate` /
  `cardDuration` still juggle `dates | startDate | month | nights | days`
  per collection. Fixing it properly means touching `lib/search-offerings.js`
  across seven datasets with no test coverage; not worth the risk in a UX pass.

**Verification status:** `npm run check` (new — fast tsc over the UI layer,
`tsconfig.check.json`) passes clean. A full `npm run build` was NOT run — it
takes many minutes because `resolveJsonModule` + `allowJs` makes tsc infer
literal types for `villas-of-distinction.json` (7.3 MB) and
`itinerary-fit.json` (7.1 MB). **Run `npm run build` locally before deploying.**

## Atlas unification — Deliverable 0 SHIPPED 2026-07-29

Work order: `WORKORDER-atlas-unification.md`. D0 only; D1–D5 not started.

**`lib/atlas/geo.ts` is now the only place a coordinate order is decided.**
Six upstream feeds disagree about `[lat,lng]` vs `[lng,lat]` (the table in the
work order). The conversions in `AtlasShell` were already correct, but the
convention lived only in comments — so the next person to add a feed had
nothing but prose to check against. `geo.ts` exports a branded
`LngLat = readonly [number, number] & { [brand]: true }`, which only that module
can mint, plus one parser per input shape:

- `fromLatLngPair` — jet/train `ll`, `REGIONS[*].coord`, `PORTS[name]`, villa pins
- `fromLngLatPair` — GeoJSON, `/api/hotel/regions` centers, `PIN_NUDGE`, `REGION_FALLBACK`
- `fromNamed` — hotels `{lat,lng}`, villas `{lat,lon}` (`lng` wins if both)
- `isFinitePair`, `offset`, `withLng`, `unrollLine` (unrolling is unused until D1c)

A bare `[number, number]` no longer type-checks where a `LngLat` is expected,
so the order is un-mixable rather than merely documented. Migrated call sites:
`regionsFromData`, `fetchOverlay`, `loadRegions`, `regionCenter`,
`pointForResult`, `fetchRouteLines`, `fetchHotelPoints` (both the points-file
path and the paged-API fallback), `plotResults`, and `VillaAtlas`'s pin decode.
`REGION_FALLBACK` changed shape from `[lng,lat,zoom]` to `{at: LngLat, zoom}` —
a 3-tuple can't be a pair. The Mapbox shim's `flyTo`/`LngLatBounds.extend`
signatures were widened to `readonly [number, number]`.

**Pure refactor — no visual change intended.** Verified by replaying every
conversion the old inline code did against the same conversion through
`geo.ts`, over the real datasets: **71,053 coordinates, 0 mismatches** (79
region pins, 2,501 hotel pins, 58,818 route-leg points, 3,902 villa pins by
both pair and named accessor, 22 authored constants, 1,829 spiral offsets).

### Two findings for Deliverable 1 — do not lose these

1. **`fetchRouteLines`'s cruise branch parses a file shape that does not
   exist.** It expects `{ [slug]: [{n, ll:[lat,lng]}] }`; the real
   `public/maps/cruise/data/itinerary-routes.json` is
   `{ _meta, routes: { id: [{d, s, p: [[portName, lat, lng], …]}] } }`. The
   branch throws, is caught, and returns `[]`. Invisible today only because
   `ROUTES_ENABLED = false`. D1c replaces the function, so fix it there.
2. **14,498 cruise route ports carry null coordinates** (~20% of that file).
   The old inline guards used `Number.isFinite(Number(x))`, and `Number(null)`
   is `0` — so nulls passed and would plot at `[0, 0]`, in the Gulf of Guinea,
   looking like a legitimate pin. `isFinitePair` is deliberately stricter and
   rejects `null` / `undefined` / `""` / booleans. Keep that guard on the
   build-time router, and expect the coverage report to list these.

## Atlas unification — Deliverable 1 SHIPPED 2026-07-29

**Sea routing moved from per-visitor runtime A* to a build-time precompute.**

`lib/atlas/sea-router.mjs` is the ~11 KB of routing that was duplicated inside
the cruise, yacht and worldcruise Leaflet atlases, extracted near-verbatim as
plain ESM (no DOM, no Leaflet, injected mask buffer). `buildOcean`, `aStarSea`,
`rdp`, `chaikin`, `arcPts` (k = 0.16, untouched) and `unroll` all came across
line-for-line; internals stay in `[lat, lng]` so they stay comparable with the
original, and conversion to `[lng, lat]` happens once at the public boundary.
Leaflet's `reanchorRoutes` / `bump` were not ported — Mapbox handles world-copy
panning itself.

`scripts/build-sea-routes.mjs` (chained into `prebuild` after
`build:hotel-points`) routes every leg once and emits one file per collection:

| file | raw | gzipped | legs |
| --- | --- | --- | --- |
| `public/maps/shared/sea-routes-cruise.json` | 1,403 KB | 207 KB | 3,963 |
| `public/maps/shared/sea-routes-worldcruise.json` | 969 KB | 188 KB | 3,017 |
| `public/maps/shared/sea-routes-yacht.json` | 282 KB | 46 KB | 1,045 |

Split per collection rather than the single `sea-routes.json` the work order
named, because `AtlasShell` already fetches and paints per overlay key — so
`/atlas/yacht` pulls 46 KB instead of 441. Canonical copies in
`data/atlas/shared/`, byte-identical (`diff -q` in the build).

45,011 raw legs collapse to 8,025 unique ones (5.6x) on the router's own
2-decimal leg key; each surviving leg carries `tripIds` so a single voyage can
still be picked out. Output is simplified with a final `rdp` at 0.01 deg —
about 0.6 px at `ROUTE_ZOOM = 5.5`, so invisible — which drops 265,324 points
to 90,627 and roughly halves the transfer.

**Two changes to the algorithm, not just the port.** Both were chosen
deliberately over shipping a faithful copy:

1. **Antimeridian search.** `col()` normalizes both endpoints into `[0, W)`, so
   a Tokyo -> Honolulu leg looked like it spanned the whole grid; the A* box got
   drawn the long way across Eurasia, found nothing, and fell back to an arc
   over land. `aStarSea` now shifts the western endpoint one turn east when a
   leg spans more than half the globe. `isLandCell` / `oceanAt` already wrapped
   their column reads, so the fix is four lines.
2. **Cell budget is now a parameter.** 1.4M cells was the right ceiling for a
   visitor's main thread; the build passes 12M so the longest legs get a box big
   enough to succeed. Default stays 1.4M for any browser caller.

Together these took arc-fallbacks 301 -> 208 and land crossings 358 -> 278.

**The remaining 278 land crossings (3.5%) are a mask limitation, not a routing
bug.** Tagged `crossesLand` in the output and listed by the build's coverage
report. 60% are legs under 100 km — coastal hops between adjacent ports, below
the mask's 0.1 deg (~11 km) resolution, and sub-pixel at globe zoom. The long
ones are almost all **river itineraries** the ocean mask cannot represent
(Manaus -2.4,-60.0; Santarem -2.4,-54.7; Iquitos -1.6,-74.6) plus a few
**landlocked origin cities in the source data** (Calgary 51.1,-114.1 ->
Greenland). Fixing these needs a finer mask or a river network, not better A*.

**Rendering.** `ROUTES_ENABLED = true`. `fetchRouteLines` now fetches the
precomputed file for cruise / yacht / worldcruise; villa still returns `[]`
(stays, not routes). Jet and rail keep runtime geometry — small stop lists, no
land avoidance needed — but now get `unrollLine` **and** `arcPts`, neither of
which they had: their routes were straight polylines that read as wire, and a
trans-Pacific jet leg swept the wrong way round the world. `paintRoutesForKey`
and the `ROUTE_ZOOM = 5.5` gate are unchanged.

`scripts/verify-sea-routes.mjs` (`npm run verify:sea-routes`) checks the six
reference legs from the work order — Gibraltar, Central America, the
antimeridian, the Mediterranean, the Drake Passage, and a >60N leg — asserting
no interior segment crosses land, no longitude step exceeds 180 deg, and the
detour stays under 4x great-circle. 6/6 pass. Note it asserts on *interior*
segments: a route starts and ends at a port, and at 0.1 deg a port is a land
cell, so the first and last segments always "hit land" by construction.

### Still open from D1

- **The three served landmask copies stay for now.** `public/maps/{cruise,
  yacht,worldcruise}/data/landmask.bin` are still fetched by those Leaflet
  atlases, which are live until D3 retires them. The canonical copy the build
  reads is `data/atlas/shared/landmask.bin`. Delete the served three in D3, not
  before — the work order's "no landmask fetched by any browser" is a D3
  condition, and the globe already fetches none.
- The work order's expectation that Alexandria -> Barcelona is "a clean arc" is
  wrong: the straight line clips southern Sardinia near Cagliari, and
  `legGeometry` tests the straight line (not the bezier) when deciding whether
  to route. A* is correct there.

## Atlas unification — Deliverable 3 SHIPPED 2026-07-29 (cleanup cancelled)

All five collections are native. The deletion step (removing
`public/maps/{train,jet,yacht,worldcruise,cruise}/`, the vendored Leaflet, the
three `landmask.bin` copies and `AtlasView.tsx`) was CANCELLED by decision on
2026-07-30 — nothing is being deleted. `?hero=1` still renders the iframe, and
the marketing landers depend on it.

Retiring the five Leaflet atlases onto the globe. **Nothing deleted yet.**

**Inventory first.** `D3-FILTER-INVENTORY.md` records every filter predicate and
deep-link param, read out of the five `index.html` files rather than inferred.
Findings that would each have caused a silent wrong-results bug:

- The param sets collapse into two families (journeys: train+jet; voyages:
  yacht+worldcruise+cruise), identical within each — but **cruise is an outlier
  inside its own family**: it filters on `operator` not brand, its region is a
  scalar `s.region` not the `t.g` array, and it cuts off past sailings with an
  ISO string compare instead of `isPastTrip()`.
- **Three month models**: `t.mks` array (train), `t.mk` scalar (jet),
  `t.monthKey` scalar (voyages) — and journeys give `onDemand` trips a free pass
  the voyages have no equivalent for.
- **The `*role` vocabularies differ and must not be merged**: journeys accept
  `any|start|end|stop|visit`, yacht/worldcruise accept `call|disembark|embark`,
  cruise accepts those plus `any`.
- **Five different search stop-lists.** Each atlas strips its own domain words,
  and cruise alone does not strip "luxury". `country=` is not a filter — it is
  folded into the search terms alongside `q=`.
- No app code emits `exRegions`, `locationrole` or `portrole`; only the atlases'
  own Share buttons do. They must still parse, but there is no internal link
  surface to migrate and no obligation to rebuild the three-state region pill.

**All five data layers are ported and verified. The UI is not built yet, and
nothing under `public/maps/` has been deleted.**

`lib/atlas/adapters/` — `types`, `search`, `filter` (one predicate for all
five), `journey` (train + jet), `voyage` (yacht + worldcruise), `cruise`
(standalone), plus a config file per collection. Every per-collection
difference lives in `AtlasFilterDescriptor`, so `matchesOffering` stays
single-branch and one filter rail can serve all five.

The families earned their split. train/jet and yacht/worldcruise share code;
**cruise does not, and shouldn't be forced to** — columnar `{schema, rows}`
source, operator instead of brand, a scalar region that is REWRITTEN from the
sailing title by `correctedRegionName()`, an ISO-string past cutoff that drops
dateless rows, and a port set built only from geocoded stops (712 of its 3,542
sailings have routes with no geocoded ports at all, so their port filter can
never match — that is original behaviour).

worldcruise, by contrast, is genuinely config only: diffed against yacht, every
predicate and helper is byte-identical apart from the `wc_` prefix and one
comment word. If a future refresh makes it need real code, the two feeds have
diverged and that is worth investigating rather than patching.

**The load-time normalisation pass is part of the port.** Each atlas runs
`TRIPS.forEach((t,i) => …)` before any filtering: it assigns `guideId`,
populates `t.cities` from `ROUTES` (which feed the search haystack), back-fills
`t.g` from the route, and COMPUTES the month keys. It is a no-op on train's
current data but load-bearing for jet — 107 of 141 trips get their month from
it, 39 get their regions, 65 resolve their route by slugged title rather than
`t.route`. The two atlases also differ on the region rule (`regionDerivation`).

**jet's `ids=` deep links are positionally unstable.** The jet feed has no `id`
field at all, so the atlas assigns `guideId = 'jt_' + arrayIndex`. `jt_7` means
"the eighth trip in the file" — reorder or insert upstream and every previously
shared jet link resolves to a different journey. Reproduced as-is
(`idStrategy: "index"`) because changing it breaks links already in the wild,
but **this is a data problem worth fixing at the source** before jet links are
advertised further.

**Verified, not asserted.** `npm run verify:adapters` compiles the real adapter
code to ESM and runs it head-to-head with the original predicate transcribed
from each `index.html`/`loader.js`, over random filter states drawn from real
dataset values: **10,742,000 predicate comparisons across all five collections
and both date pinnings, 0 mismatches.**

Two harness lessons, both learned the hard way and both encoded in the script:

1. The first version fed *raw* JSON to both sides and passed cleanly — because
   both were equally wrong. Apply the atlas's normalisation to the original
   side or the comparison is vacuous.
2. Past-dated trips are rejected by both implementations before any other
   filter runs, so disagreements on them are invisible. That masked a real bug:
   33 jet trips name their stops but ship no route geometry, and the adapter was
   dropping those stops for want of a coordinate — silently breaking
   `location=` for them. Every one is past-dated today. `AtlasStop.at` is now
   nullable so named-but-unlocated stops survive, and the harness runs every
   collection twice, against today AND an early epoch.

**Deep-link parsing is done too** — `lib/atlas/adapters/params.ts`, verified by
`npm run verify:deeplinks` (**291 assertions, 0 failures** across all five).
The parsing is fussier than the param list suggests, and none of this was
guessed:

- `brand=` falls back to `operator=` and back again — the atlases accept either
  — and both are matched FUZZILY (exact on key or display name, then substring
  in both directions).
- `region=` goes through a **per-collection alias table** first ("scotland" →
  BRITAIN). All five tables differ; train has 38 entries, cruise has none. Every
  alias is asserted to resolve.
- Unknown region keys in `regions=` are **dropped**, not passed through — a
  typo would otherwise filter everything out.
- `exRegions=` skips any key already in `regions=`.
- Journeys fold role `stop` → `visit` and reject anything else; voyages pass the
  role through verbatim.
- **`location=` matches fuzzily; `port=` matches EXACTLY.** `port=NICE, FRANCE`
  does not resolve and never did. Preserved deliberately so shared links land
  where they land today.

**`components/AtlasFilterRail.tsx` — one rail for all five.** No
`if (collection === …)` anywhere in it: which controls appear, what the stop
control is called, and which role vocabulary its dropdown offers all come from
the descriptor. Visual pattern follows `/atlas/villa` (`.villa-filters`), the
only Mapbox-native filter UI the app already had.

Three decisions worth knowing:

- **Region exclusion has no control, by choice.** `exRegions=` still parses and
  still filters, so old Share links behave exactly as before — there is simply
  no UI to author a new one. Nothing internal ever emitted it.
- **The stop control is a type-ahead, not a dropdown.** cruise has 1,622
  distinct ports and worldcruise 971; a `<select>` that size is unusable. The
  Leaflet atlases reached the same conclusion — their only static filter markup
  is `#portSearch` / `#locationSearch`. A `<datalist>` gives type-ahead over the
  full list, and the filter only engages on an exact option match so half-typed
  text never empties the map.
- **State stays multi-value even though the controls are single-value.** A link
  carrying `regions=MED,CARIB` filters on both; the control shows "Several (2)"
  and leaves the set alone until the traveller actually changes it. Narrowing
  state to what a `<select>` can express would silently drop half the meaning of
  links already in circulation.

**`/atlas/train` is now native — the first collection off its iframe.**

`app/atlas/[type]/page.tsx` keeps a `NATIVE_COLLECTIONS` map; anything not in it
still renders the Leaflet iframe. So the five move one at a time and each gets
reviewed on its own, instead of one switch changing all of them at once.

- `components/AtlasCollection.tsx` — globe + rail + cards, generic over the
  descriptor. Plots through the existing `bevvip:atlas-plot` event (the same
  contract The Guide uses), so **no change to AtlasShell was needed**.
- `components/AtlasTrain.tsx` — fetches and adapts the one feed. Deliberately
  thin: the other four should each be a file this size. If one isn't, the
  descriptor is missing an axis; don't special-case the shared component.
- **The URL is the single source of truth for filter state.** Every change
  rewrites the query string, so browser Share produces links in the same shape
  the old Share buttons did, and back/forward work without a second store.
- `?hero=1` still renders the iframe even for migrated collections — the
  marketing landers want a bare ambient map, not a filter rail.

Pin cap is 60, mirroring `plotResults`' existing per-tool cap; the rail's count
tells the truth about how many matched. Cards cap at 120 with a "narrow the
filters" note.

### ALL FIVE COLLECTIONS ARE NATIVE (2026-07-29)

`/atlas/{train,jet,yacht,worldcruise,cruise}` all render the Mapbox globe.
`NATIVE_COLLECTIONS` is full; no route renders an iframe any more except
`?hero=1`, which the marketing landers still want bare.

**cruise — the outlier, ported last.** Three source files rather than one
(columnar `sailings.json` + `atlas-meta.json` + `data/itinerary-routes.json`),
hence a three-argument adapter. Deliverable 1's precompute covers 2,829 of
3,542 sailings — the gap is exactly the 712 whose route ports are all
un-geocoded, so nothing is missing, there is simply nothing to draw.

Two things the pre-port feature check caught:

- **cruise's accent `#5aa9e6` MATCHES `OVERLAYS`.** I had predicted it would
  differ, as yacht (`#caa44e` vs `#e0b84a`) and worldcruise (`#3fc1b0` vs
  `#45d6c2`) do. It does not — so the `OVERLAYS` drift is those two only, and
  that is what needs reconciling, not all five.
- **Logos were about to break silently.** The card looked marks up by
  `o.brand`, which is **null for cruise** — its marks are keyed by operator
  name. Every cruise logo would have fallen through to coloured initials with
  no error. The lookup now follows `descriptor.brandField`. The 10 operator
  values in `sailings.json` match the 10 `OPERATORS` keys exactly.

**Ship filter:** sourced from the sailings dataset's own `ship` column, which is
what `WORKORDER-expedition-ship-data.md` Deliverable 4 asks for — "a true
per-sailing filter … sourced from the sailings, not from `ships.json`". The port
satisfies it by construction, since `AtlasFilterRail` derives ship options from
the offerings. `ships.json` stays enrichment-only, as that work order intends.

**Verification at this point:** `tsc` clean, adapter parity 0 mismatches across
all five collections and both date pinnings, 291 deep-link assertions passing.

### What remains in D3

Nothing has been DELETED yet. That is the last step and it is deliberately
separate:

1. Delete `public/maps/{train,jet,yacht,worldcruise,cruise}/` and their vendored
   Leaflet — **including the three duplicated `landmask.bin` copies**, which
   only those atlases fetch. That finally closes D1's "still open" item.
2. Delete `components/AtlasView.tsx` and the iframe path in
   `app/atlas/[type]/page.tsx` — but `?hero=1` still uses it, so decide whether
   the landers get a bare native map instead.
3. Reconcile `OVERLAYS` colours for yacht and worldcruise (above).
4. Feature-inventory leftovers: branded progressive loader, explicit "back" out
   of a traced route, richer pickers (supplier list with logos, month grid).

### Satellite routes were dark because of SCENE LIGHTING, not colour (2026-07-29)

Three rounds of colour tuning were all treating the wrong cause. The side-by-side
made it obvious: identical routes render **exactly right on Dark and muted on
Satellite**. If the hex were wrong it would be wrong on both.

`addLayer` already carried the answer, for circles only:

> "On Standard-family styles circle layers are lit by the scene lighting model,
> so under a dusk/night light preset our pins darken. Force full emissive
> strength…"

Satellite is `standard-satellite` with `light: "dusk"`. **Dark is `dark-v11`, a
CLASSIC style with no lighting model** — which is exactly why it looked correct.
The emissive fix had been applied to circles and never to lines.

`addLayer` now sets `line-emissive-strength` and `text-emissive-strength`
alongside `circle-emissive-strength`, so every layer holds its own colour on
every basemap (a no-op on classic styles). Consequences:

- **The lightening is gone.** Teal is teal and platinum is platinum on both
  basemaps, which is what was asked for. Satellite differs only in keeping a
  dark halo, because photoreal terrain is busy where a flat basemap is not.
- **The blurred glow layer is gone**, as requested — it was compensation for a
  problem that no longer exists.

**Lesson: when a colour is right on one basemap and wrong on another, the
variable is the STYLE, not the colour.** Mapbox Standard-family styles light
your layers; classic styles do not.

### Circumnavigations flatten themselves (2026-07-29)

Jets were forced flat as a blanket fix for a problem only round-the-world
itineraries have. Jet is back on the **globe**; instead, tracing a route whose
longitude span exceeds 180° switches the map to mercator, because half of such a
route is always on the far side of a globe.

Measured from the geometry, NOT from a data flag — `voyage.ts` sets
`world: false` on every sailing (only journeys carry the flag), so a flag-based
rule would have missed world cruises entirely. Coverage:

| collection | flatten on trace |
| --- | --- |
| worldcruise | 119 of 250 |
| yacht | 3 of 368 |
| jet | the 21 flagged round-the-world tours |

A Mediterranean voyage keeps its globe.

### Satellite contrast is two problems; worldcruise ported (2026-07-29)

**Lightening the line only ever solved half of it.** Measured contrast ratios
against the two satellite backdrops:

| line | vs dark ocean | vs sunlit terrain |
| --- | --- | --- |
| gold `#caa44e` | 6.9:1 | 1.7:1 |
| lightened 0.34 | 9.4:1 | 2.3:1 |
| lightened 0.50 | 11.3:1 | 2.7:1 |

Over **ocean** the line is already high-contrast, and a heavy dark casing just
eats into it. Over **terrain** no amount of lightening helps — light-on-light
tops out below 3:1 — and the dark halo is the only thing that works. Chasing
one number was always going to fail on the other backdrop.

So: a genuinely bright, wide line (5.2px, lightened 0.5) carrying the ocean,
with a *modest* dark halo (line + 2.4 at 0.72) carrying the land — rather than a
thin line inside a heavy black cord. **This is tuned from measured ratios, not
from looking at it; confirm visually.**

**`/atlas/worldcruise` is native.** Four of five. The prediction held — it is
config: `voyage.ts` unchanged, and this file differs from AtlasYacht only in
paths, accent, and having no bundled logos.

- Deliverable 1's precompute covers **all 250 voyages** (3,017 legs — the
  densest of the three sea files). No live A*, no land mask in the browser.
- Accent **`#3fc1b0`**, the atlas's own. **Second collection whose real accent
  differs from `OVERLAYS`** (which says `#45d6c2`), after yacht
  (`#caa44e` vs `#e0b84a`). Assume the same for cruise; read the atlas, not
  `OVERLAYS`.
- No bundled logo assets — `BrandLogo` falls straight through to the favicon
  services and coloured initials for all 13 lines.

### The cobweb and the unreadable gold were ONE bug (2026-07-29)

Reported as two things — "what are all these lines?" and "gold isn't
readable" — and they had a single cause: **the ambient all-routes layer.**

`ROUTES_ENABLED` plus the `ROUTE_ZOOM = 5.5` gate means that zooming past 5.5
on a collection page loaded and painted **every** leg in the collection. For
yacht that is 1,045 legs, **210 of which cross the visible western-Med box**.
Each carries an `r_<key>_shadow` line: `#000010`, 4px, opacity **0.22**.

Alpha stacks. `1 − 0.78ⁿ`:

| overlapping shadows | effective alpha |
| --- | --- |
| 5 | 0.71 |
| 10 | 0.92 |
| 20 | 0.99 |

So the shipping lanes converging on the Riviera painted themselves to
**near-opaque black**, which is both the cobweb AND the thing burying the
traced route. The gold was being drawn correctly and then covered.

**Fix:** `AtlasShell` takes `ambientRoutes` (default true). The home globe keeps
its faint web — that texture is the "living atlas". Collection pages pass false:
there the interaction is ONE traced route, and drawing all of them underneath
buries the thing you selected.

**Second, smaller fix, same area.** The satellite casing was a fixed 10px under
a 3.4px line, leaving 3.3px of black each side — the route read as a black cord
with a coloured core even without the ambient layer. Casing is now `line + 3`
(a 1.5px halo each side) and the satellite line widens to 4.6px.

**Worth generalising:** a per-feature opacity that looks right for one line is
not a per-layer opacity. Anywhere many features share a corridor, check the
stacked alpha, not the swatch.

### Satellite legibility + yacht ported (2026-07-29)

**Route colours on satellite were the wrong fix in the wrong place.** Jets had
been forced onto Dark because platinum vanished on photoreal terrain — that
avoided the basemap instead of solving the contrast. Now the palette does the
work: on satellite the line is **lightened toward white** (keeping the brand
hue, gaining luminance) and laid over a **near-black casing at 10px / 0.95**.
The casing is doing most of the lifting; a line alone cannot win against a
photograph. Applies to every collection, so rail is brighter on satellite too.
Jets are back on **satellite**, still flat — long-haul arcs distort on a globe.

**`/atlas/yacht` is native** (`components/AtlasYacht.tsx`), the first of the
voyages family. Feature-checked against the inventory BEFORE porting:

- **Geometry comes from Deliverable 1's precompute**, not a live router. The
  Leaflet atlas runs land-avoiding A* on hover behind a 765 KB mask;
  `sea-routes-yacht.json` already holds exactly that — 1,045 deduplicated legs
  covering 368 of 374 voyages. `lib/atlas/adapters/sea-geometry.ts` indexes it
  by trip id (legs are shared across voyages, so the file stores each once and
  tags it with every trip that uses it). The six voyages with no precomputed
  geometry fall back to straight port-to-port legs.
- **Accent `#caa44e`** — the yacht atlas's own `--accent`, which differs from
  AtlasShell's `OVERLAYS` entry (`#e0b84a`). The atlas's own value wins; that is
  the colour the collection is recognised by.
- Opens on **satellite**: ocean is a calm dark backdrop, so sea routes never had
  the contrast problem that bright terrain gave rail and jet.

### Mobile follow-ups + "Around the World" (2026-07-29)

**Apply did nothing — a real bug, now fixed.** The sheet committed with
`onStateChange(draft)` then `onQueryChange(draftQuery)`. Each of those writes
the WHOLE query string from its own argument plus the currently-committed other
half, so the second call rebuilt the URL using the **pre-Apply** state and threw
the draft away. There is now a single `onCommit(state, query)` that writes once.
Desktop Reset had the same latent bug and uses it too.

**The map was eating the page scroll.** Mapbox swallows vertical drags, so at
62vh plus a ~64px fixed bar the only scrollable strip was a few pixels of
leftover gap — hence "very thin". Two changes: the mobile map is 44vh (still
enough to read a route), and there is now an explicit `.atlas-scrollcue`
between map and cards — a ≥48px band showing the result count, `touch-action:
pan-y`, guaranteed grabbable regardless of layout. Card bottom padding went to
96px so the last card clears the bar.

**"Around the World" is a region option, not a separate button.** The Leaflet
journeys atlases had a dedicated `worldBtn`; putting it in the region control is
better placed — round-the-world itineraries cross every region, and "where does
this go" is where a traveller looks. It sits above the alphabetical list with a
live count (jet: 21 of 141; rail: 75 of 135).

Implementation note worth keeping: `world` is a field on `AtlasFilterState`,
**not** a synthetic entry in `offering.regions`. Folding it into regions would
have changed region facet counts and broken the adapter parity harness, which
compares against atlases that have no such region. `world` is optional, so the
harness's state objects leave it undefined and all 10.7M comparisons still pass.

### Mobile, Share, jet colours (2026-07-29)

**Mobile: pill → drawer → "Apply · N".** Built now rather than after four more
ports, because it is shared infrastructure every collection inherits.

The commit step is the whole point. On a phone the map IS the screen, so
applying per keystroke redraws it under your thumb while you are still
deciding, and the count you are aiming for keeps moving. The sheet edits a
draft; Apply carries the **draft's** count, so the button says what you will
get, not what you have. Desktop keeps applying immediately — there the map and
controls are visible together and a commit step would just be friction.

Also: tapping a card scrolls the map back into view (on a phone the cards are
below the fold, so tracing a route you can't see reads as nothing happening —
desktop deliberately does not jump); 16px controls in the sheet stop iOS Safari
zooming the viewport on focus; `env(safe-area-inset-bottom)` clears the home
indicator; single-column results with bottom padding so the last card isn't
trapped under the fixed bar.

**Share carries the view, not just the filters.** An advisor sending a client a
link means "look at THIS, like THIS", so `toSearchParams` now also emits
`style=`, `flat=1`, `@lng,lat,zoom` and `trip=` (the pinned journey) alongside
every filter. Opening one restores basemap, projection, camera and pinned route.
Copies to clipboard; falls back to the URL bar where the clipboard is blocked.

**Route colours come from the collection, not from rail.** Every traced route
and stop dot was painted copper because the palette hardcoded rail's accent —
so a jet route looked like a railway. They now take the collection's own
`--accent`: platinum `#dfe5f2` for jets, copper `#e08d5f` for rail.

**Jets: three separate fixes.** They rendered through `fr_conn`, the faint
ferry-hop connector (dashed 2/9) meant for a transfer *inside* another journey
— hence "too sparse". There is now a `primary` leg mode with casing, glow and a
solid line. `arcPts` gained a resolution parameter: the default 26 points per
leg renders a Tokyo → LA arc as visible straight chords, so jet passes 0.01 for
~101. And jets open **flat + Dark**, because long-haul arcs distort badly on a
globe and platinum on satellite terrain is nearly invisible.

**The idle spin now yields to a traced route.** `paintFocusRoute` calls
`stopSpin()`; the rotation was fighting `fitBounds`, which is why clicking a
card only zoomed after you stopped the globe by hand.

### D3-FEATURE-INVENTORY.md — the checklist that should have existed first

`D3-FILTER-INVENTORY.md` was written before porting, and the filter layer went
across cleanly: 10.7M parity comparisons, no surprises. **Nothing equivalent was
written for the features**, and rail shipped missing its track geometry, stop
markers, route pinning, brand logos and day-by-day itinerary — each found by the
user, one at a time, after deploy. A parity harness over predicates cannot catch
a missing logo.

`D3-FEATURE-INVENTORY.md` is now that checklist, per surface (map / cards /
chrome), with status per feature. **Fill it in from the atlas's own index.html
BEFORE porting the next collection.**

Recovered in this pass:

- **Brand logos**, with the original's fallback chain — bundled
  `logos/<domain>.png` → Google favicon → DuckDuckGo icon → coloured initials
  from `BRANDS[k].color`. `components/BrandLogo.tsx`. It also reproduces the
  `naturalWidth < 8` check: both icon services answer unknown domains with a
  1px placeholder rather than a 404, so a "successful" tiny image is a miss and
  must fall through, or the card shows a blank square.
- **Numbered stop dots with hover labels** ("3. Day 4 · Inverness"), from
  `.stopdot` + `stopDaySummary`. `AtlasStop` gained `day`, populated in all
  three adapters.
- **Day-by-day itinerary** on the card, from `itineraryRanges()` — consecutive
  same-name days collapse into "Days 6-8 · Edinburgh", and only NEIGHBOURS
  merge, so a trip returning to a city later correctly gets two rows.
  `AtlasOffering.itinerary` carries it for all five collections.
- **Route path as text** ("A → B → C"), vessel · duration · stop count, the
  three date cases (range + departures count / on-demand window / nothing
  scheduled), the round-the-world edge, and the **Ask The Guide** action.

**Route colours are now basemap-aware.** The Leaflet atlas only ever ran over a
dark tile layer, so its copper `#e08d5f` had plenty of contrast. The globe opens
on SATELLITE — bright tan desert, green forest — where the same copper
disappears. Satellite gets a hotter line (`#ffd9a0`) and a heavier dark casing;
the dark styles keep the original values exactly.

Still open, listed in the inventory: `world=1` has no UI entry point, no
explicit Share button (the URL is the share link — arguably better, but it is a
removed affordance), region-pin dimming while tracing, and the data-credit line.

### Region pins filter; jet ported (2026-07-29)

**A region pin now filters to that region.** It previously opened a popup
linking to `?region=KEY` — which is the camera *focus* param, not a filter, so
clicking a pin "opened everything". `AtlasShell` takes an optional
`onRegionSelect`; when a collection page supplies it the pin filters in place
(and clicking the pin of the region you are already in clears it, so the map is
a filter control rather than a one-way trip). Home leaves it undefined and keeps
the popup and link. The handler is read through a ref because the map effect is
keyed on `[token]` and never re-runs.

**Clicking a card always moves the camera**, including for the one rail trip
with no drawable geometry — the route event carries `fitPoints` so the globe
frames its stops rather than doing nothing.

**`/atlas/jet` is native** (`components/AtlasJet.tsx`). Same thin shape as rail;
the only thing it knows that rail doesn't is its own geometry. **Jets arc,
trains don't** — an aircraft really does fly the arc, so jet uses `arcPts`
(k = 0.16) over unrolled stops, and draws with the dashed connector rather than
track symbology, because a flight is not a railway. Unrolling first matters for
the same reason it does at sea: arcing a raw Tokyo → Los Angeles pair sweeps
west across Asia instead of east across the Pacific.

### Route persistence, brightness, and `?ids=` links (fixed 2026-07-29)

Three faults found in one review pass, all from porting the *drawing* without
porting the *interaction model*:

**1. Click must PIN, not just draw.** The Leaflet atlas has `routeLocked` +
`pinnedTrip`: hover previews, click locks, leaving a card restores the pinned
route, and clicking the same card again releases it. The first port cleared on
every mouseleave, so a clicked route vanished the moment the pointer moved —
exactly the reported symptom. Now mirrored, including the original's 170ms
hover debounce so dragging across the grid doesn't thrash the map. Pinned cards
carry `data-pinned` for a visible affordance.

**2. Routes read much darker than the original.** The inline stroke colours are
faithful; the brightness came from CSS the colours don't reveal —
`path.rrail { animation: routeGlow }`, a pulsing
`drop-shadow(0 0 5px rgba(255,190,140,.85))`. Mapbox has no drop-shadow, so an
`fr_glow` layer (warm `#ffbe8c`, width 9, `line-blur: 6`) sits between casing
and rail as the filter does. **Lesson: when porting a look, read the CSS, not
just the draw call.**

**3. A traced route survives a basemap switch.** `setStyle` wipes every source
and layer; the last traced legs are held in a ref and repainted from
`style.load`.

**4. `/atlas/train?ids=15694760` showed the whole globe.** A deep link that
resolves to exactly one trip now pins, traces and frames it — what
`highlightDeepLinkIds()` did in the original. Following a link to a specific
journey and being shown the entire world is the bug.

**Also removed: the `bevvip:atlas-plot` dispatch from collection pages.**
Reusing The Guide's plot path looked economical and was wrong three ways — it
drops a "N plotted / Reset" badge belonging to the chat, frames the camera on a
generic pin rather than the journey, and `plotResults` writes sessionStorage
under `bevvip:atlas:last-plot`, **which the home globe replays on boot**. So
browsing a collection would have poisoned the home page with 60 rail journeys.
Collections now show ambient region pins plus one traced route, as the Leaflet
atlases did.

### Why hover did nothing at all — the scope guard (fixed 2026-07-29)

`AtlasShell`'s event-listener effect began `if (!allInventory) return;`.
`allInventory` is only true for `scope="all"` — the home globe — so on
`/atlas/train` the effect returned immediately and **neither the
`bevvip:atlas-route` listener nor the `bevvip:atlas-plot` listener was ever
registered.** Card hover dispatched correctly and nothing was listening.

That guard also explains the earlier "no routes" report: the filtered subset was
never plotted either, so the globe only ever showed ambient region pins.

The guard is gone. It is safe to widen because the events have exactly two
dispatchers — The Guide on the home page, and `AtlasCollection` on a collection
route — and those never mount together.

**Diagnostic worth reusing:** dispatch a synthetic `mouseover` on `.atlas-card`
and listen for `bevvip:atlas-route`. It fired with 3 legs / 183 points while the
map did nothing, which isolated the fault to the receiving side in one step.
Note React implements `onMouseEnter` via delegated `mouseover`/`mouseout`, so a
raw `mouseenter` event will not reach the handler.

Known limitation: switching basemap wipes the focus-route source and layers, so
a traced route disappears until the next hover, which re-creates them.

### Rail routes follow TRACKS, not arcs — corrected 2026-07-29

**`public/maps/train/data/rail-routes.json` exists and the first port missed
it entirely.** 269 leg polylines, 47,070 points across all trips, covering 134
of the 135 rail journeys. It is a shared leg pool keyed on an unordered station
pair (`"lat,lng|lat,lng"`), with each trip referencing legs plus a `rev` flag
for the direction it travels them, so trips sharing track share bytes.

The first attempt assumed the itinerary stop list was all the geometry there
was and ran `arcPts` over it — drawing the Glasgow → Fort William leg as a
bezier over Loch Lomond instead of the West Highland Line. Rail is now excluded
from the ambient arc path in `fetchRouteLines` outright; a rail route can only
come from real geometry.

**Legs carry a mode and it matters:** `rail` (211), `road` (57), `arc` (1).
The original draws rail with railway symbology and renders road/ferry/transfer
legs as an honest dashed connector rather than pretending they are track. Both
are reproduced in the focused-route layer:

| layer | colour | width | note |
| --- | --- | --- | --- |
| `fr_casing` | `#140b06` @ 0.5 | 7 | dark casing |
| `fr_rail` | `#e08d5f` @ 0.98 | 3.4 | copper rail |
| `fr_ties` | `#241007` @ 0.92 | 3.4 | sleeper hatching, dash 2.5/7 |
| `fr_conn` | `#f2d9c4` @ 0.6 | 2 | non-rail leg, dash 2/9 |

**Routes trace ONE trip at a time, on hover or click** — `drawRoute(trip)` with
a pinned trip is what the Leaflet atlas did, and an ambient layer of all 135
routes is not a substitute for it. `AtlasShell` gained a `bevvip:atlas-route`
listener (sibling of the existing `bevvip:atlas-plot` contract) and collection
cards dispatch it on hover/focus/click; click also fits the camera to the route.
Offerings with no shipped geometry fall back to straight legs between located
stops — honest, rather than an invented curve.

`routesAlways` stays on `AtlasShell` for the collections where an ambient layer
IS right (jet arcs, precomputed sea routes), but rail does not use it.

**Other first-review fixes (2026-07-29): globe too small.**

- `ROUTE_ZOOM = 5.5` is right for the home globe — seven collections' routes at
  world zoom is a ball of wool — but wrong for a collection page, where the
  routes ARE the content and nothing ever crosses that zoom. `AtlasShell` takes
  a `routesAlways` prop that collapses the gate to 0 and kicks `loadRoutes()` at
  boot instead of waiting for a zoom event that never comes. Home is untouched.
- Route lines now interpolate on zoom: 2.4px / 0.95 opacity at world zoom
  easing to the original 1.6 / 0.82 at `ROUTE_ZOOM`. Rail and jet itineraries
  are SHORT — Scotland, Switzerland, the Rockies — so a whole journey is a few
  pixels wide at globe zoom and the old hairline dash was invisible. Above
  `ROUTE_ZOOM` the values are identical to before, so the home globe is
  pixel-unchanged.
- The globe now takes `min(72vh, 760px)` on collection routes (58vh on
  phones). The default `.atlas-map` min-height of 380px reads as a banner, not
  a map. Cards are demoted to a denser band beneath, and the filter rail is
  sticky so filters stay reachable while scrolling results.

This is the inverse of `/atlas/villa`, deliberately: there the map is a locator
for a card-first browse; here the map is the browse.

**Next:** review `/atlas/train` against `/maps/train/index.html`, then repeat
for jet → yacht → worldcruise → cruise. Only once a collection is native can
its `public/maps/<type>/` directory go — and only when all five are native can
`components/AtlasView.tsx`, the vendored Leaflet, and the three served
`landmask.bin` copies be deleted.
3. Only then delete `public/maps/<type>/` and its vendored Leaflet, plus
   `components/AtlasView.tsx` and the iframe path — and at that point the three
   served `landmask.bin` copies can finally go too (see D1's "still open").

## Hotel atlas — `?ids=` deep link spun forever (fixed 2026-07-29)

**Symptom.** `/atlas/hotel?ids=h_01034` flew to the right property and then
orbited without ever settling. Clicking the same hotel from the atlas worked
perfectly. Nothing to do with Google 3D being broken — it never was.

**Cause: two competing camera flights.** A single deep-linked id issues both

1. `fitToResults()` → `flyToFeatures(…, {minRange:3400, tilt:60})`, and
2. `highlightDeepLinkIds()` → `openDetail()` → `flyTo({range:2600, tilt:67,
   orbit:true})`

Flight 2 arms its cinematic orbit on a one-shot `gmp-animationend`. But that
event also fires when flight 1 is *interrupted* — which flight 2 does
immediately. So `flyCameraAround` starts while flight 2's `flyCameraTo` is
still animating, and (per the existing note by `stopIdleSpin`) the orbit
re-sets the camera every frame. The two fight and the view never settles.
Clicking a pin issues only flight 2, so the event fires cleanly at the end.

**Fix, two layers.**

- `fitToResults()` returns early when a single deep-linked id is about to be
  opened, letting the detail cinematic own the camera. That removes the second
  flight entirely.
- `flyTo()`'s orbit arming now checks it is still the current flight (`seq ===
  flySeq`) and that at least 80% of its own duration has elapsed; an early
  event belongs to a superseded flight, so it re-arms and keeps waiting. This
  makes any future double-flight path safe, not just this one.

Relevant to Deliverable 2, which is specifically about `?ids=` / `?hotel=`
flying straight to a property at detail range — that path now works.

## INCIDENT 2026-07-29 — Mapbox Standard styles stopped loading

**Symptom.** The home globe showed "Map unavailable" on every full page load.
Not caused by the D0 or D1 work, though it surfaced during D1 verification.

**Diagnosis.** On the live page, a `new mapboxgl.Map()` built from scratch with
no app code hangs identically, while on the same page and token:

| style | family | `style.load` |
| --- | --- | --- |
| `dark-v11` | classic | fires |
| `satellite-streets-v12` | classic | fires |
| `standard` (Dusk) | Standard | never fires |
| `standard-satellite` (Satellite, boot style) | Standard | never fires |

Not a GL version issue — 3.7.0, 3.9.0 and 3.15.0 all hang. Not a missing
resource: the style JSON (74 KB), all three source TileJSONs, the sprite, the
glyphs and the 32 `.glb` models every returned 200 in under 100ms. GL emitted
no `error` event; it simply never completed. Mapbox status page showed all
systems operational. Root cause is therefore outside the app — either something
account-scoped on Standard styles (quota / entitlement / billing) or a style
schema change GL cannot finish. **If the globe is ever "unavailable" again,
check the Mapbox account first, and re-run the probe above before suspecting
app code.**

**Mitigation shipped.** `AtlasShell` now arms a style watchdog
(`STYLE_FALLBACK_MS = 4000`) at map construction and on every `setStyle`,
disarmed by `style.load`. If a basemap doesn't finish, the globe drops to
`dark-v11` (`STYLE_FALLBACK_KEY`) instead of sitting for 12s and replacing
itself with the handoff panel. Failed styles go into a per-session
`failedStyles` set, because `plotResults` flips to Satellite on every plot and
would otherwise re-stall each time. `map_style_fallback` added to
`lib/analytics.ts` — the globe failing silently was previously unmeasured.

The 12s `loadTimeout` → `setMapFailed` path remains as the last resort, for a
total Mapbox failure rather than one bad basemap family.

**Resolved the same day, on Mapbox's side.** Standard-Satellite began loading
again roughly two hours later with no change from us; the globe opens on
Satellite as designed and the watchdog does not fire. No account action was
taken, so treat this as vendor-side and transient. The watchdog stays — it cost
nothing and the next silent basemap failure degrades instead of blanking.

**Lesson for the next session.** During this incident the hotel atlas *appeared*
to be broken too, and it was not. Readings taken through an automated/CDP-driven
Chrome tab were unreliable — a clean-room `Map3DElement` test run inside a
`srcdoc` iframe reported zero tile requests, but a `srcdoc` iframe has an opaque
null origin and the Google key is referrer-restricted, so that test was invalid
by construction. **Confirm any "the map is broken" finding in a normal browser
window before diagnosing further.**

## Atlas unification — Deliverables 2, 4, 5 SHIPPED 2026-07-30

The work order (`WORKORDER-atlas-unification.md`) is complete: D0–D5.
**Nothing was deleted.** The five Leaflet atlases, `AtlasView.tsx`, the `?hero=1`
iframe path and `public/maps/*` all remain — the D3 cleanup step was cancelled
by decision, not forgotten. `public/maps/hotel/` in particular is now
load-bearing rather than legacy: it IS the Google 3D property view.

**D2 — hotels: browse on Mapbox, inspect in Google 3D.** `components/AtlasHotel.tsx`
+ `lib/atlas/adapters/hotel.ts`. Hotels are the first collection whose filter
grammar genuinely differs from the five journey/voyage atlases, so the shared
layer grew descriptor flags rather than branches: `facets`, `searchMode`,
`idsHighlightOnly`, `extraIdParams`, `supportsMonthFilter` / `supportsStopFilter`
/ `supportsBrandFilter`. Five divergences, each of which would have shipped
silently — full table in `D3-FEATURE-INVENTORY.md`. The sharpest:

- the visible Region axis is a **curated country→macro-region table**, not the
  feed's 604-value `region` nor its 7-value `marqueeRegion` (604 pins vs 10)
- the UI axis labelled "Brand / Program" is the **`program`** param; `brand` is
  a separate deep-link-only axis (`program=Virtuoso` → 1,970; `brand=Virtuoso` → 0)
- `ids=` **highlights, it does not filter** — a shared property is meant to be
  seen among its neighbours
- `q` is a raw **substring**, not tokenised, and `country` is a FACET here while
  it is a SEARCH TERM in the other five
- **no hotel carries `marqueeRegion: "caribbean"`** — the country alias is the
  only thing making `region=caribbean` return anything (92 vs 0)

`hotel_3d_opened` added to `lib/analytics.ts` (source: `card` | `popup`) — the
photoreal view was previously unmeasured.

**D4 — Explore is intent-shaped.** `IntentKey` + `INTENTS` + `collectionsByIntent()`
in `lib/atlas-config.ts`; `SiteNav` renders groups. Seven collections became
three choices: Places to stay (hotel, villa) · Voyages by sea (cruise,
worldcruise, yacht) · Journeys by rail and air (train, jet). Derived from
`COLLECTIONS`, so a new atlas cannot go missing from the menu —
`scripts/verify-intents.mjs` asserts exactly that, which is the failure a
grouped menu has and a flat one does not.

**D5 — one result shape.** `lib/offering-shape.ts`. `search_offerings` passed the
five journey/voyage collections through verbatim from their upstream APIs, each
answering "when" and "how long" differently, so `ResultCards` re-derived it with
`result.nights as unknown` (only compiling because `OfferingResult` has an index
signature). Now normalised once at the seam. **Two transcription bugs caught by
the harness, both non-obvious:**

- `dates ?? startDate` is NOT a truthiness fallback — an empty-string `dates`
  BLOCKS `startDate` and falls to `month`. Using `||` changed 28 cases.
- `if (result.duration)` IS truthiness on the raw value — numeric `duration: 12`
  printed `"12"`, `duration: 0` fell through. Requiring a string changed 96.

The card keeps its local derivations as a FALLBACK because `GuideMeta` replays
from `sessionStorage`; a plot stored pre-D5 would otherwise lose every date.

**Home globe: ambient routes are OFF by default** (`ambientRoutes` now defaults
false). Every call site already passed `false`; only the default kept the
cobweb alive. Routes are on demand — hover, click, or a collection page. Plotted
Guide results are pins only: tracing them was tried and reverted, because on a
dense coast a handful of voyages buries the pins. D1's precomputed sea routes are
NOT wasted — the collection pages draw every leg from them.

**Fixed alongside:** the home globe could come to rest with no fit and no idle
spin (the boot chain had no terminal `else`, hit most reliably coming BACK from
an atlas — this was "the map is frozen"); a plot restored during boot could
`setStyle` while the first style load was in flight, wedging `restyling` so every
later paint was skipped; hotel pins were drawn from zoom 2.45 but only clickable
from 4, a dead band where a tap silently did nothing.

**Verification** — `npm run verify` runs all of it:
`check` · `verify:adapters` (~10.7M comparisons) · `verify:deeplinks` (291) ·
`verify:hotels` (1.75M) · `verify:offering-shape` (651) · `verify:intents` ·
`verify:sea-routes`.

## Product facts that have been got wrong in code (2026-07-30)

Recorded because both were wrong in shipped copy, not just in someone's head.

**A hotel yacht is a CRUISE, not a charter.** Ritz-Carlton Yacht Collection,
Four Seasons Yachts, Aman at Sea, Orient Express Sailing Yachts — ultra-luxury
hotels at sea, sold **by the cabin**, exactly like an expedition cruise or a
world cruise. The Explore blurb said "charters" and the map badge said
"N charters"; both described the wrong product at the wrong price. Now
"hotel yachts" and "N sailings".

**Everything can be privatized, with enough lead time.** Any itinerary — hotel
yacht, Expedition Cruise, world cruise, private jet, rail — can be taken as a
full charter; any property — hotel, resort, villa — as a full buyout. This is a
distinctive capability and a real revenue path, so a traveller asking about the
whole ship, the whole train, the whole hotel, or about a wedding / reunion /
milestone / corporate group must never be answered with individual cabins or
room nights alone. Encoded in `lib/guide-prompt.js`. Neither pricing nor a
specific lead time is ever quoted by The Guide; the advisor sets both.

## Offering types (7)

| Type | Surface | Data | Fulfillment |
| --- | --- | --- | --- |
| hotel | /atlas/hotel (iframe over public/maps/hotel) | data/atlas/hotel | TravelWits VIP booking + advisor |
| cruise | /atlas/cruise (iframe) | data/atlas/cruise | advisor |
| jet | /atlas/jet (iframe) | data/atlas/jet | advisor |
| yacht | /atlas/yacht (iframe) | data/atlas/yacht | advisor |
| worldcruise | /atlas/worldcruise (iframe) | data/atlas/world | advisor |
| train | /atlas/train (iframe) | data/atlas/train | advisor |
| villa | /atlas/villa (server-rendered, no iframe) | data/villas-of-distinction.json | advisor only |

## Villa offering type — LIVE (added 2026-07-15)

- Source: Villas of Distinction (WTH) scrape, schema `living_atlas.villas_of_distinction.v1`,
  `generated_at_utc: 2026-07-15T15:19:14Z`, 3,902 villas.
- Data file: `data/villas-of-distinction.json` (7.0 MB). SERVER-ONLY: it is required
  statically by `lib/villas.js` and must never be imported by a `"use client"` file.
- Architecture: villa is the first atlas served exclusively through a paginated
  search API (`/api/villas/search`, perPage cap 50, default 24; `?view=pins` compact
  map feed ~118 KB for the full set). No client request downloads the dataset.
  Do NOT copy the client-side full-dataset pattern from the other atlases here.
- Surfaces: `/atlas/villa` (Mapbox clustered map + paginated cards, SSR initial page),
  `/atlas/villa/[destination]/[slug]` detail (114 featured villas prebuilt via
  generateStaticParams, the rest on-demand ISR, revalidate 86400).
- Guide: `type: "villa"` in search_offerings (fields sleeps / bedrooms / priceMax),
  advisor-handled rules in guide-prompt.js. CTA is always advisor request; villas
  never enter the TravelWits pipeline or the Hotel Atlas.
- Pricing rule (revised 2026-08-19): the displayed nightly rate is the supplier's
  own published price — `pricing.price_low` when present, falling back to
  `rate_from_usd`. `price_string: "Call for Pricing"` overrides both and renders
  as price-on-request regardless of the rate behind it. Never $0, and never a
  rate for a villa the supplier prices on request.
  - Why: `rate_from_usd` is a base rate, not the published one. They diverge in
    798 records by a median 6% / p90 37%, always with the published price higher
    (Zanzibar Beachfront One-Bedroom: base $1,700, supplier page $2,258), and 425
    records pair "Call for Pricing" with a positive rate. 789 villas now show the
    corrected rate; 425 moved to price-on-request.
  - `nightlyFromUsd` is both the displayed number and the number `priceMax`
    filters on — keep those the same value. Facet `callForPricing` is now 636
    (was 211), so a budget cap legitimately excludes more; the Guide's channel
    note reports the real count.
  - `baseRateUsd` keeps the agency-side rate server-side. Never client-facing.
- Capacity: `capacity.available_bedrooms` is normalized to `bedroomOptions`
  (ascending, de-duplicated) and `bedroomsMax`. 698 villas rent a menu of counts
  (Àni Thailand: 6–10); cards show the range, the detail page names every option.
  The bedrooms filter compares `bedroomsMax`, not `bedrooms` — they disagree in 45
  records (28 rent more rooms than the size field, 17 fewer), which used to both
  hide and falsely surface villas.
- Availability: `availability.true_availability` is normalized to
  `liveAvailability` (713 false / 3,187 true / 2 null) and deliberately NOT
  rendered or shipped to a client. The feed does not document what it means, and
  it is the only field that would read as an availability claim. Confirm the
  semantics with WTH before surfacing it. `availability.min_night_stay` is null
  in all 3,902 records.
- Geo: `geo.precision === "villa"` (3,666) renders as solid pins; centroid/locality
  precision renders smaller and hollow, and clustering keeps stacked centroids readable.
  The same fact reaches cards as `exactLocation`: the 236 centroid villas carry an
  "approx. location" marker on the card and a sentence on the detail page.
- Client projection: `searchVillas` results go through `toClientVilla`, the one
  place that decides what a browser may see. It strips `supplierDeepLink` (which
  had been shipping inside every card payload and the atlas's SSR HTML despite
  the guardrail), `baseRateUsd`, `liveAvailability`, `geoPrecision`, `bedroomsMax`
  and the unused taxonomy slugs. `getVillaById` / `getVillaBySlug` still return the
  full record for server-side callers — the detail page's internal supplier
  reference is rendered from there.
- Supplier overlay: `villas-of-distinction` added to
  `data/atlas/shared/advisor-overlay.json` (the copy lib/atlas/supplier-fit.js reads)
  and the `data/advisor-overlay.json` sibling. `commissionPct` intentionally null:
  confirm the current WTH agent commission before ranking or quoting on it.
  stayone / lvh / lacure now carry `appliesTo: ["villa"]`; only VOD has Atlas
  inventory today.

### Refresh procedure

1. Re-run the VOD scrape (produces `living_atlas.villas_of_distinction.v1` JSON).
2. Replace `data/villas-of-distinction.json` with the new file.
3. `npm run dev`, spot-check `GET /api/villas/search?region=Caribbean&sleeps=10`
   and `/atlas/villa` (map pins + pagination + no $0 anywhere). Confirm the API
   response carries no `supplierDeepLink` / `baseRateUsd` / `liveAvailability`,
   and that a villa whose `price_string` is "Call for Pricing" shows no rate even
   when `rate_from_usd` is positive.
4. Deploy. CDN cache on the search API is s-maxage=86400, so stale results age out
   within a day of the deploy.

## Answers surface (AEO question pages) — LIVE (added 2026-07-21)

- Surfaces: `/answers` (index, ItemList JSON-LD) + `/answers/[slug]` — 24 fully
  static question pages (SSG, `dynamicParams = false`) targeting AI answer-engine
  queries. Each page: question as H1, direct-answer lead, data tables, FAQ block,
  FAQPage + BreadcrumbList JSON-LD, canonical URL, related links into the atlases.
- Content lives in `data/answers/{expedition,hotels,villas,journeys}.js`;
  registry + JSON-LD builders in `lib/answers.js`. Counts cited in copy
  (sailings per region, hotel/brand counts, villa queries) are snapshots
  computed from the atlas datasets on the `updated` date in each module —
  when atlas data refreshes, re-run the counts and bump `updated`.
- `data/atlas/cruise/ships.json` (`living_atlas.expedition_ships.v1`): per-ship
  expedition facts (guests, expedition-team size, ice class, kayak/camp/sub/heli
  flags) compiled July 2026 from operator materials; powers the guide-ratio,
  smallest-ships and adventure-options pages. Figures are typical/approximate —
  re-verify before quoting in bookings.
- SEO plumbing: `app/robots.js` (allows all + explicit AI crawlers — GPTBot,
  ClaudeBot, PerplexityBot, etc.; disallows `/api/`), `app/sitemap.js`
  (147 URLs: core + 7 atlases + 24 answers + 114 featured villa details),
  `metadataBase` = https://basecamp.aspentraveladvisors.com in `app/layout.tsx`.
  "Answers" tab added to NavTabs.
- DOMAIN PREREQ: `basecamp.aspentraveladvisors.com` must be attached to the
  Vercel project (Settings → Domains + DNS CNAME) — canonical URLs, sitemap and
  JSON-LD already point at it. Until then the pages serve fine on
  bevvip-concierge.vercel.app but canonicals reference the custom domain.
  Also verify Vercel Security settings aren't challenging AI crawler bots.

## Entity fact datasets (added 2026-07-21)

- `data/atlas/cruise/ships.json` (expedition, 29 ships), `data/atlas/world/ships.json`
  (51 world-cruise ships), `data/atlas/yacht/ships.json` (7 hotel-brand yachts),
  `data/atlas/jet/plane.json` (10 jet programs — itinerary data has no aircraft
  field, so keyed on BRANDS slugs), `data/atlas/train/train.json` (11 named trains).
- Entity names/brand keys match the corresponding itinerary.json spelling exactly
  (including ® in Cunard/Princess names) so future entity pages can join on them;
  validated zero orphans both directions at creation. Figures are operator-published
  values compiled 2026-07-21 — approximate, re-verify before quoting in bookings.

## Rogue port coordinates — audit, ledger, gate (2026-08-12)

The recurring failure was one stop per voyage geocoded to a namesake on another
continent, drawing a spike across the map: "West Point, United Kingdom" in the
Thames on a Cape Horn voyage, "Antarctic Peninsula" in the Kerguelens,
"Christmas Island" in the Indian Ocean on a Hawaii–Tahiti crossing. Three parts
now:

- **`scripts/audit-port-locations.mjs`** (`npm run audit:ports`) — six checks
  over a normalised `{collection, id, title, stops[]}` shape: hygiene, detour,
  pace, **stranded** (far from BOTH neighbours, scaled to the journey's own
  typical leg), **landlocked** (no sea access per the router's land mask, on a
  voyage whose other stops have it), **disagreement** (two feeds mapping one
  name >500km apart). The last three are new; a plain "longest leg" test was
  tried and dropped — it flags every ocean crossing. Jets stay exempt: their
  itineraries are lists, not paths.
- **`data/atlas/shared/port-overrides.json`** — the corrections ledger, each
  entry carrying `was` (a guard: an entry only fires within 0.25 deg of the
  coordinate it was written against, else it reports itself stale), the fixed
  `ll`, the evidence and the source. Plus `confirmed`: flagged-but-correct stops
  (Amazon and Great Lakes calls, charter-flight segments, ambiguous names) which
  is what lets `--strict` gate a build.
- **`scripts/fix-port-locations.mjs`** (`npm run fix:ports`) — applies the
  ledger to both copies of every feed, idempotently, and runs at the head of
  `prebuild`. This is the part that was missing: the feeds are refreshed
  wholesale, so a coordinate edited in place comes back wrong on the next
  harvest. `ll: null` ships a stop with no coordinate when its true location
  cannot be recovered; `scope: "occurrence"` handles one name meaning two real
  places — on the PORTS-map feeds by splitting the fitting occurrences onto a
  new name ("Miyako (Miyakojima), Japan"), on the expedition feed per stop.

42 corrections applied across world / yacht / expedition (~250 stops); sea
routes rebuilt. `npm run verify:ports` is in `verify` and passes at 0 suspects.
Two judgment calls left alone and recorded in `confirmed`: Northeast Greenland
National Park sits at the park centroid, 300km inland on the ice cap, and
"Cape Peron" may be the Shark Bay one rather than the Rockingham one.

## Trip length filter on the atlas rail (2026-08-21)

The rail could say *where* and *when* but not *how long*. "I have nine days" is
the constraint most travellers actually arrive with, and the only way to browse
by it was to sort by duration and scroll — which on a 3,542-sailing collection
capped at 120 cards means the middle of the range is unreachable.

`AtlasFilterRail` now carries a **Days [min] – [max]** group, on every
collection whose offerings have a length (all five journey/voyage atlases;
hotels opt out via `supportsDurationFilter: false`, because a stay's length is
the traveller's choice and not a property of the hotel).

- **Two picker wheels, not a menu of buckets.** The collections disagree too
  much for one set of buckets — rail runs 2–19 days, jet 4–29, yacht 3–19,
  cruise 3–96, world cruises 50–245 — and a "15+ days" bucket is the wrong tool
  for someone with exactly nine free days. On desktop a closed control
  ("LENGTH · 10–14 days") drops a popover holding a Min and a Max wheel; in the
  phone drawer the wheels are inline, because a popover inside a scrolling
  sheet is a clipping problem with no good answer. Scroll-snap does the
  physics, so the feel is native on touch; the pick commits when the wheel
  SETTLES, not per scroll event. Each wheel is one tab stop with arrow-key
  support, and only offers lengths that EXIST in the collection, each row
  carrying how many trips are that long (the counting rule the region and brand
  menus already use).
- **An impossible window cannot be expressed.** Max starts at the chosen Min
  and Min stops at the chosen Max. Offering everything and dragging the other
  end along when they cross was tried and is worse: spinning Max down from Any
  passes THROUGH the short lengths, so each row it crossed pulled Min down with
  it — three presses of Down silently rewrote a 7-day Min to 3.
- **The unit is whatever the card prints.** `durationDays()` counts nights for
  cruise and days for the journeys, which is what the card beside the filter
  says; normalising one family into the other's unit would make the filter
  disagree with the number the traveller is reading.
- **`minDays=` / `maxDays=` are new deep-link params**, inclusive, and either
  end stands alone. A junk, zero or negative bound leaves that end OPEN rather
  than filtering everything out, and unset bounds are never serialised — so
  every link already in circulation means exactly what it meant. An offering
  whose length is unknown drops out once a bound is set (today that is none of
  them: all 3,955 current offerings across the five collections have a length).
- Sort by duration (`duration-asc` / `duration-desc`) was already there and is
  unchanged; the filter narrows, the sort orders.

Verified: `verify:adapters` gains a trip-length property section (bounds are
inclusive, either end alone, the collection's own range keeps every dated trip,
an inverted window keeps nothing, no bound changes nothing) on top of its
unchanged 8.8M-comparison parity run; `verify:deeplinks` gains round-trip and
bad-input assertions (627 → 687); `verify:hotels` asserts the bounds are inert
there.

## Photoreal 3D is an engine, not a destination (2026-08-23)

The Google Photorealistic 3D hotel view stopped being a place you go and became
a way the map draws. Three things were wrong with where D2 left it, and only the
first was visible:

1. **It was a page, not a view.** `/atlas/hotel?hotel=<id>` fell through to the
   iframe at `public/maps/hotel/index.html`, and the card's action opened it in
   a NEW TAB — so the single most persuasive thing the app does cost the
   traveller their filters, their camera and their place in the list. The work
   order called photoreal irreplaceable and then put it three clicks and a tab
   away.
2. **Nothing could link to it by name.** `ATLASES` is keyed by `OfferingType`,
   and 3D is not a type — it is a view OF one. With no slot for that in the
   registry, the Explore menu could never mention it, and it survived only as a
   query param.
3. **The property view had no way to ask.** Its own intro tour promises "Send
   any hotel to The Guide for a tailored shortlist"; the panel offered a rate
   search and a mailto. The hotel pin popups and the Guide's own recommendation
   popups had no ask either, and the one that existed (the collection card) sent
   the title and a URL — so The Guide had to re-derive the city, country,
   program and category it had just been shown.

**The engine.** `components/Atlas3DLayer.tsx` mounts `Map3DElement` inside
`AtlasShell`'s own box, over the Mapbox canvas, which stays MOUNTED and hidden
(`.atlas-map.photoreal .atlas-canvas { visibility: hidden }`) — rebuilding a GL
map costs a style load, a source refetch and every layer the shell adds, while
hiding it makes the return instant. `lib/atlas/google3d.ts` holds the loader
(key from the untouched `/api/hotel/config`), the ported camera constants
(`DETAIL_RANGE` 2600 / `DETAIL_TILT` 67 and the log-eased tilt ceiling), and the
zoom⇄range conversion that carries the camera across the switch. Two things to
know about that conversion: `VERTICAL_FOV_DEG = 45` is EMPIRICAL — Google does
not document the 3D camera's field of view — and the wide end is deliberately
clamped, because a whole-planet Mapbox view converts to a camera ~130,000 km out.

The orbit race fixed on 2026-07-29 is ported with it: `gmp-animationend` also
fires when a flight is INTERRUPTED, so the orbit is armed only when its own
sequence still owns the camera and 80% of its duration has elapsed.

**The engine is NOT a basemap.** `engine` is its own axis (`?engine=3d`), not a
sixth entry in `SHARE_STYLES`. Folding it in would have made "the basemap I
like" and "the renderer I want" one setting — so a trip through 3D would forget
the traveller's basemap — and every path that reasons about satellite imagery
(auto-daylight, the plot-reveal flip, the style watchdog) would have had to
learn about an entry with no Mapbox style URL. It is CONTROLLED by the page,
because the page owns the deep-link parse, the Share link and the card actions.

**Failure is per-engine.** No key or no tiles → `mapEngineChosen(type, "photoreal",
false)`, fall back to Mapbox, say so in a dismissible notice. And because the two
engines fail independently, the Mapbox "Map unavailable" panel now OFFERS the
photoreal engine: hiding a working renderer because the broken one owns the
toolbar would be the same mistake one level down.

**What else moved.** `?hotel=` opens the native shell with the engine on and the
property selected (`?legacy=1` still reaches the standalone page, and `?hero=1`
still renders it for the marketing landers). `components/HotelDossier.tsx` ports
the property file — description, ratings, address, program, VIP benefits, rate
link, access code — beside either engine, so the engine did not arrive without
its substance. `AtlasConfig.views` gives a collection a second view, and Explore
lists it.

**The Guide is now mounted on atlas pages** (`components/AtlasGuideDock.tsx`),
so an ask is answered beside the map instead of navigating to the home page.
`lib/atlas/ask.ts` is the one door: `registerGuideHost()` (called by GuideChat
itself, so the home globe counts too) decides delivery-in-place vs. the `?ask=`
fallback, and the question carries the property's own facts. Asks now exist on
the card, the hotel pin popup, the Guide's recommendation popups, the dossier,
and the standalone panel (which posts `ATLAS_ASK` up to `AtlasView`).

**One bug this shipped and then fixed, found by driving a browser:** the first
ask on an atlas page arrived while `GuideChat` was still unmounted, so nothing
was listening and the question vanished into an opening, empty sheet. The dock
buffers a question that arrives before the chat exists and replays it once
mounted — child effects run before parent effects, so the chat is subscribed by
then.

**Verified.** `verify:photoreal` (new, in `npm run verify`) proves the camera
round-trip is lossless over the 176 unclamped combinations and clamps the other
40, that the tilt easing matches the original's shape exactly, that every
category colour still equals `CAT_COLORS` read out of the standalone atlas, that
the ask carries place/category/program, and that `?hotel=` cannot quietly route
back to the iframe. Browser-driven: the dossier, the in-place ask, the deep
link, the legacy escape hatch, and the no-key fallback.

**Not verified here, and worth doing once with a key:** the photoreal render
itself. This sandbox's network policy denies `api.mapbox.com` and
`www.google.com`, so neither engine can paint a tile in it.

### Two follow-ups from live use (2026-08-23)

Both reported from production the same day, both invisible in review because the
symptom is "the map just sits there".

**A search or filter did not move the photoreal camera.** Every re-framing on a
collection page — a rail filter, the search field, "Search this area", a deep
link — travels as one `bevvip:atlas-route` event, and `applyRoute` consumed it
for Mapbox only. So in 3D the pins updated underneath a camera that never went
to them, and the hidden Mapbox map was the thing being flown. `applyRouteTo3D`
now runs on the same event, deliberately AHEAD of the `routeReadyRef` gate:
that gate waits for Mapbox's style.load, and the photoreal engine can be on
screen while Mapbox is still loading or has failed outright. Plotted Guide
shortlists frame it too, from inside `plotResults`.

**`?engine=3d` opened on Mapbox.** The arriving-engine effect latched
`arrivedEngine` on its first run — but `parsed` is null until the collection's
feed resolves, so that first run had nothing to read and consumed the one chance
to act. Both the Explore menu's "In photoreal 3D" entry and `?hotel=` were
inert. It now waits for the parse before latching.

Verified behaviourally, not just by inspection: `verify:atlas-handoff` gained a
photoreal scenario (extracting the real `applyRouteTo3D`, so it cannot drift)
proving a framing reaches the 3D camera before Mapbox is ready, carries the
right points, works from route geometry, and that a HOVER preview still does
not move it. Driven in a browser against a stubbed Google Maps API — the real
`Atlas3DLayer` against a fake `Map3DElement` recording every `flyCameraTo` —
`?engine=3d` mounts the engine with 1,200 markers and no clicking, typing
"Aspen" flies to 39.20/-106.88, a region filter flies to the Caribbean, and
`?hotel=h_01034` lands on the Burj Al Arab at range 2600 m, tilt 67°.

### Opening a card now inspects the building (2026-08-23)

The photoreal arrival was the standalone atlas's `DETAIL_RANGE` — 2,600 m —
which frames a property in its setting: the block, the beach, the ridge behind
it. That is the right camera for a map you are still browsing and the wrong one
for the moment the traveller opens a card, which is a request to look at the
BUILDING. At 2.6 km the photogrammetry mesh is a shape, and a shape is exactly
what Mapbox's extruded footprints already give for free — the whole argument for
this engine only starts paying at inspection distance.

So the arrival has its own constant. `INSPECT_RANGE = 450` (in
`lib/atlas/google3d.ts`) is what `Atlas3DLayer.focus()` flies to, and the orbit
inherits it, so an open property turns at 450 m rather than circling a block.
`DETAIL_RANGE` is untouched and still means what it always did: where the detail
camera begins, and the reference point for the Mapbox ⇄ photoreal handoff.

450 m is set against the mesh, not by taste: Google's tiles hold real detail to
roughly 150–300 m, so this leaves headroom while still containing a large
resort's grounds at `DETAIL_TILT`. Tilt deliberately stays 67° — `maxTiltForRange`
caps everything below 4,200 m at that angle and the debounced tilt sync in
`Atlas3DLayer` would flatten anything steeper within 160 ms, so a steeper
inspection tilt is not a tuning choice, it is a fight.

**Verified.** `verify:photoreal` gained three checks: the inspection range sits
well inside detail range, stays in the band where the mesh still reads as a
building, and survives `tiltForRange` at full tilt (a range low enough to trip
the easing would have flattened the fly-in on arrival). `npm run check` clean.
The render itself still cannot be seen here — this sandbox's network policy
denies `www.google.com`, so no tile paints in it.

### The property opens in the card on a phone (2026-08-23)

The dossier was a bottom sheet at every width. On a phone that meant it covered
62% of a map band already clamped to 240–400px, so opening the details left
about 150px of building: the photoreal engine's whole argument, reduced to a
strip, at exactly the moment the traveller asked to look at the property.

It now has two homes, and the viewport picks (`inlineDetail` in
AtlasCollection). Beside the map on desktop, unchanged — a 340px panel costs
nothing there. **Inside the open card on phones**, where the page's own order
already wanted it: the filter rail is a fixed bottom bar down there, so the card
list sits directly under the map with nothing in between. Building above,
details in the card beneath.

Rendered in ONE of the two at a time, never both. `HotelDossier` fetches the
property record on mount, so a second copy hidden by CSS is a second request per
property. `lib/use-is-mobile.ts` is the shared 680px hook that decides (extracted
from AtlasFilterRail, which had the same query inline).

**The map band goes sticky while a property is open.** Without it the premise
fails: the inline dossier runs several screens, so the building would scroll away
at the first paragraph. This is not the pinned map THE PAGE SCROLLS removed —
that was a fixed band plus a nested card scroller, permanently. This is `sticky`,
scoped to an open property, and it releases the moment the card closes. The open
card clears it via `scroll-margin-top` keyed to `--atlas-map-h`, so the band's
height and the card's landing offset cannot drift apart.

**The card's button now says what the press will add.** "Property details & 3D"
from the Mapbox globe; just "Details" once the photoreal engine is already
drawing the building (promising 3D to someone looking at it is not an offer);
"Hide details" on the open card — and it closes, which is why `cardAction` gained
`close` alongside `select`. `label`/`title` may now be functions of
`{ engine, open }` (`CardActionState`).

**Pins behave like cards**, at no cost: both engines' pins already land in
`togglePin` (AtlasShell's popup action and the photoreal marker's `onSelect`),
so a pin tap expands that property's card and scrolls it under the same band.

**Verified** in a browser at 390×844 against a stubbed Google Maps 3D API (this
sandbox denies www.google.com and api.mapbox.com), 21 checks: the dossier mounts
in the card and not in a sheet, the band pins to the top of the viewport and is
still there 900px into the details, the open card lands directly beneath it, the
labels change with the engine, a pin tap behaves like a card tap, and desktop is
untouched. `npm run verify` clean. One thing the drive found that is worth
knowing: **the scroll container on these pages is `body`, not the viewport**
(`body { height: 100%; overflow-x: hidden }` makes it one), so anything measuring
or driving page scroll has to go through `document.body`.

**Known gap, deliberately left:** a pin for a property outside the first 120
rendered cards has no card to expand, so it keeps the sheet — which is also where
a `?hotel=` deep link lands, since that selects without filtering the list. The
fix, if wanted, is to carry the pinned offering into the rendered slice.

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

- **The three served landmask copies stay — permanently, as it turns out.**
  `public/maps/{cruise,yacht,worldcruise}/data/landmask.bin` (765KB each) are
  fetched by those Leaflet atlases. This note used to end "delete the served
  three in D3"; **do not.** D3 shipped keeping the standalone pages as two
  deliberate escape hatches, which supersedes that plan: `?legacy=1` is the
  documented fallback if the Maps key or the tiles are unavailable, and
  `?hero=1` — the ambient embeds the marketing landers use — renders the iframe
  even for migrated collections, because the landers want a bare map rather
  than a filter rail. Both paths are in `app/atlas/[type]/page.tsx`. Deleting
  the copies would blank the sea routes on every marketing lander, silently.
  The canonical copy the build reads is `data/atlas/shared/landmask.bin`; the
  duplication is the price of the escape hatch and is worth it.
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
  `/atlas/villa/[destination]/[slug]` detail (all 3,902 built at deploy via
  generateStaticParams, `dynamicParams = false`).
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

### Selecting a property and opening its file are two acts (2026-08-23)

They were one. Clicking a card set `pinnedId`, and the dossier read the pin — so
"show me where this is" and "tell me everything about this" were the same
gesture. Browsing a list of 120 hotels fired the property file 120 times, and on
a phone each one buried the map the tap had just flown.

`AtlasCollection` now holds `detailId` beside `pinnedId`, always either null or
equal to it. **Selecting** flies the camera to the property, highlights its pin
and traces it. **Disclosing** happens on exactly three paths, all of them an
explicit request for the file:

  - the card's details button (`togglePin(o, { detail: true })`),
  - a map pin's own "Property details & 3D" — which is why the shell's photoreal
    wiring gained `onOpenDetail` beside `onSelect`; a tap on the pin itself is
    the light gesture, the button on its popup is not,
  - a `?hotel=` deep link, because somebody sent that link and it used to open a
    page whose whole content was this file.

Changing the selection closes the panel; closing the panel ("Hide details", the
✕) does NOT clear the selection — the camera is already there and closing a file
is not the same as being done looking. `CardActionState.open` now means
disclosed, not selected, and the card action api's `select` became `openDetail`.

**The sticky band follows selection, not disclosure.** A pin tap and a card tap
both bring the selected card up under the band, where its details button is;
whether the file came with it only changes the card's height. Gated on
`inlineCapable` (a phone, on a collection that HAS a panel), so nothing about the
six route atlases changes.

**Verified** in a browser at 390×844, 30 checks: a card tap opens no panel at
either width, selects, holds the band and does not switch engines; the details
button opens the file in the card; a card tap once in 3D flies the building in at
range 450 and still opens nothing; a pin tap matches a card tap while a pin's own
button discloses; Hide details keeps the selection and a second card tap gives
the screen back. `npm run verify` clean.

The gap below is unchanged and now narrower: only the pin-popup button and
`?hotel=` can disclose a property with no card on screen.

### The move between properties is a flight, not a cut (2026-08-23)

Two things were making a hotel-to-hotel move read as a jump cut.

**The duration was flat.** 1,800 ms, inherited from the standalone atlas, where
almost every flight was a single descent from a wide framing onto one hotel —
and 1.8s is a fine descent. The common move here is different: at 450 m over one
building, clicking the next card makes the camera TRAVEL. `flightDuration` in
lib/atlas/google3d.ts now times it from the live camera position, linear in the
LOG of the great-circle distance, because that is how the move reads rather than
how far it is: across town ~2.6s, the next valley ~3.6s, across the country
~4.5s, the far side of the world 5.2s (`FLIGHT_MS_NEAR` / `FLIGHT_MS_FAR`).
Measured live rather than from the previous selection, so a second click
mid-flight measures from wherever the camera has got to and stays proportionate.

**And there were two flights, not one.** Selecting a hotel emits
`bevvip:atlas-route` and THEN flies the engine to the building, in that order.
`applyRouteTo3D` was framing the single point first — so the camera teleported
onto the property at 3.4 km in 2s, and the arrival flight then had nowhere to
come from. It also meant the new distance-timed arrival measured zero distance
every time and always took the shortest flight there is, which is how this was
found: the stub recorded `[{ms:2000},{ms:2600}]` for a 17,802 km move.

`RouteDetail.selecting` marks a framing that belongs to something being
selected, and the photoreal engine stands down for those. The page says which it
is rather than the shell inferring it from `selectedId`, because the route is
dispatched in the same tick the selection state is set — the ref still holds the
PREVIOUS selection when the handler runs, so every comparison against it misses
(the first fix attempt did exactly that and changed nothing). Framings with no
`selecting` — a rail filter, a search, "Search this area", a plotted Guide
shortlist — are unchanged and still flown here.

**Verified.** `verify:photoreal` gains seven checks on the curve (standing still
is the short end, further is never quicker at any distance, an unknown camera
takes the long descent rather than NaN, and the Aspen→Dubai distance itself).
`verify:atlas-handoff` gains three on the stand-down, and its `PLACE` fixture is
now honestly named: it is a RESULTS framing, and `PICK` is the selection one —
the old fixture claimed to be a hotel selection while carrying no `selecting`,
which would have quietly asserted the opposite of what ships. Driven in a
browser against the stubbed engine: one flight per selection, 3,648 ms for a
40 km hop and 5,200 ms for 17,802 km. `npm run verify` clean.

## The route flight — a journey too wide to frame (2026-08-25)

Since the collection atlases became a square-ish map band on phones
(`--atlas-map-h: clamp(240px, 46dvh, 400px)` against ~350px of width), the
private jet round-the-world itineraries — and the world cruises, which are
worse — could not be got onto the screen at all. That was reported as a framing
bug. It is not one; it is arithmetic:

- **Mercator's floor is minZoom.** At 0.6 the whole world is 512·2^0.6 ≈ 776px
  wide, so a ~350px band shows less than half a planet and the route runs off
  both edges. Lowering minZoom does not rescue it — the world is 512px at zoom
  0 and Mapbox has nothing below that. **No phone can show a circumnavigation
  flat, at any zoom.**
- **A globe shows at most a hemisphere**, and the outer ~30° of it is edge-on:
  about 110° usable, which is what `SPAN_FLAT_LNG` has always encoded.

So there is no camera position that answers "show me this whole route", and
every previous fix was a better-aimed version of an impossible shot.

**Two changes, and the first is the smaller one.**

**1. The flatten gate is now measured in pixels.** `flattenIfCircumnavigation`
dropped a wide route to mercator whenever the globe could not frame it, without
ever asking whether the flat map could. `canFrameFlat()` asks: it computes the
zoom mercator would need for the span in the box we actually have, insets and
all, and compares it to `getMinZoom()`. A desktop map is wider than 776px and
still flattens a world route, as it should. The phone band keeps the globe,
because a coherent hemisphere with the route continuing round the limb beats a
strip that severs it at both frame edges. Being pixels rather than a breakpoint,
this also covers a short fullscreen window and the map beside an open Guide
panel.

**2. Wide routes are flown, not framed.** `▶ Fly the route` — on every card with
two located stops, and in the map's own control stack (fullscreen has no cards,
and fullscreen is where a reel gets filmed). The flight is one beat repeated:

    land on the call · name it · hold · hop to the next

**Deliberately not automatic.** A card tap is browsing: it traces and frames as
well as the viewport allows, and you keep the camera. The flight takes the
camera for as long as the itinerary needs, and taking someone's map away is not
something to do because they were reading a list. It is also the reason a
reduced-motion visitor is fine: nothing flies unless it is asked to.

**Distance is paid for with ALTITUDE, not speed.** The first version of this
(same day, replaced) flew the whole itinerary as one continuous pass at one
altitude and paid for the distance by moving faster. It was too fast to watch,
and it could not have been fixed by slowing down: at an altitude close enough to
recognise a city, a Pacific crossing is 9,000km of empty water, and any speed
that crosses it in reel time makes the cities unreadable.

So each leg now rises out of one call, crosses at a height that frames the whole
leg, and descends into the next — the arc a flight actually makes, and the one
thing that lets the empty middle go past quickly while the ends stay legible. A
leg's duration follows how far it CLIMBS, not how far it travels: a hop down the
Riviera takes about a second and a half, a Pacific crossing climbs nearly four
zoom levels and takes three and a half. Pitch rides the same hump — hard (58°)
at the calls, flattened (22°) at cruise, where the job is context and a tilted
world map is a smeared one.

**The dwell is the point.** The map holds still at each call, the name comes up,
and there is time to read it. That is what the flight exists to deliver, so it
is the one budget that never gets scaled: when an itinerary will not fit inside
the ceiling, what gives is the number of LANDINGS, not the pace and not the
reading time. Scaling the legs instead was tried and is wrong in exactly the way
this rewrite is about — measured on the shipped itineraries, a 13-call world
tour was crossing the Pacific at 1.26 frame-widths a second while a 9-call one
managed 0.75, so the routes that most needed to be readable were the ones being
rushed. It now sheds calls until it fits, down to a floor of 8; the route is
still drawn and still flown over in full, and each label's number ("7. Day 19 ·
Marrakesh") keeps the traveller's place in the whole itinerary.

**North stays up.** No rotation to face along each leg. That is the seat-back
idiom and it costs more than it pays: every basemap label arrives at a different
angle, and a viewer who looked away has to re-find north before they can read
where they are. The tilt and the climb carry the motion.

**Measured on the shipped jet atlas** (348×340 phone band, 40 routes): median
26.8s, longest 39.3s (10-call round-the-world), shortest 13.5s (4-call
regional), peak pace 1.07 frame-widths/sec across all of them. The dials, in
descending order of effect: `FLY_DWELL_MS` (1400), `FLY_LEG_BASE_MS` (1500) and
`FLY_LEG_PER_ZOOM_MS` (420), `FLY_STOP_ZOOM` (4.6, which sets how far every leg
has to climb), `FLY_TOTAL_MS` (40000 ceiling).

**Details that are load-bearing:**

- **It flies `lastFocusLegs`**, the chain `paintFocusRoute` stored — ordered,
  oriented and unrolled into one longitude frame by `lib/atlas/route-frame.ts`.
  Raw legs would cross the Pacific four times.
- **The camera lands ON the call**, not on the nearest sample to it: each leg's
  point list has its two ends replaced by the stops themselves. A resampled
  route is ~1° between samples on a world tour, which at reading altitude is a
  city visibly off centre.
- **Altitude rides the raw clock, position an eased one.** The climb has to be
  under way before the camera has gone anywhere, or the first moments of a long
  leg are spent crossing ground at city zoom — the too-fast this shape exists to
  fix, in miniature.
- **Calls are matched forward along the route**, never by nearest sample
  globally: an out-and-back itinerary calls at the same port twice, and a global
  search gives both calls the same moment.
- **An interruption returns nothing to the camera.** Any hand on the globe ends
  the flight through the existing `haltSpin` path, and the teardown puts back
  only what was borrowed — the dimmed route, the trail, the label, the lit call.
  Not the position, not the pitch: a camera that answers a drag by easing
  somewhere else is the map arguing with you, and the teardown also runs one
  tick after the landing's own ease is issued, where a second camera command
  would cancel the first. Levelling belongs to the landing.
- **The flight lives inside `wireHandlers()`** with the rest of the route
  drawing, so the things above it that must stand down — the idle spin, the view
  reporter, the effect cleanup — reach it through `focusRouteRef`, and share its
  state through `flyingRef`.

**Verified.** `scripts/verify-route-flight.mjs` (in `npm run verify`) slices the
real framing-and-flight block out of `AtlasShell.tsx`, compiles it and runs it
against a fake map and a fake clock, in the idiom of `verify-ambient-tour.mjs`:
41 checks that it flies the itinerary forwards and lands exactly on each call,
holds still there long enough to read the name, climbs out between calls,
reads every call from the same height, names them in order once, gives back
everything it borrowed on an interruption at any point, thins a 34-port world
cruise rather than running to two minutes while still flying over every port,
and flattens on a desktop box while keeping the globe on a phone one.

The pace check is the one that matters and it is expressed the way the
complaint was: not degrees per second, which is meaningless without an altitude,
but **frame-widths per second** — capped at 1.15 peak, 0.55 mean. Four real bugs
came out of this harness: the whip-pan cruise, a trail that stopped short of the
final call, a teardown that cancelled its own landing, and the budget scaling
that quietly re-rushed the longest itineraries.

Not seen live: this sandbox's network policy blocks `api.mapbox.com`, so the
flight has been driven only against the stub — the pitch and the dwell want an
eye on a real phone.

## The route flight, corrected on three counts (2026-08-25)

Reported after the first day on it, and all three were real.

**1. Browsing a route could look straight down at a pole.** `fitBounds` centres
on the bounding box, so an Antarctic expedition (box centre ~65°S) or a
Northern Europe voyage put the camera there — which on a sphere is the top or
bottom of the world seen from directly above, itinerary wrapped round the
outside, every basemap label converging on the middle. It shows most of the
route and reads as nothing.

`framingLat()` is the guard, and it has two rules. A whole-globe framing (below
zoom 2, where you are looking at a sphere rather than a map) is read from within
40° of the equator. Anything wider than regional keeps the pole out of frame
entirely. Below that, nothing moves: an Alaskan cruise at zoom 5 and a Riviera
one at zoom 7 are untouched, which is the point — the correction only engages
where the frame is actually wide enough for a pole to appear in it. When it does
engage the camera is placed explicitly rather than by `fitBounds`: same centre
longitude, latitude pulled equator-ward, and the zoom eased out by however much
of the route that pushes off the top, so the correction never loses part of it.

The first version of this guard computed the frame's vertical extent in
mercator and did nothing at the latitudes it was written for. Mercator stretches
latitude toward the poles, so it reports a SMALL number of degrees in the top
half of a high-latitude frame; a globe does the opposite, and at 78°N a frame
mercator says reaches 81° actually carries the camera over the pole. `halfFrameLat()`
now answers per projection, using the globe's projected diameter (162.97·2^zoom
px — the constant `fitGlobe` inverts).

**2. The flight flew a different route from the one drawn.** It concatenated
every stored leg and resampled the result. `frameRoute()` returns more than the
route: legs no hop claimed are appended after it in source order, and hops with
no geometry leave gaps. Concatenation flies the orphan as though it came next,
and closes each gap with a straight line through whatever lies between — so the
camera crossed ground the map below it was not drawing.

`FrameLeg` now carries `hop`, set by `chainByItinerary` when it claims a leg for
a hop. The flight takes the claimed hops in order and follows each one's own
coordinates, so what the camera traverses is the drawn geometry by construction.
It also removes a whole class of error for free: a leg knows which stops it runs
between, so nothing is matched by proximity any more — the out-and-back
itinerary that calls at one port twice used to defeat that.

**3. Every collection said "Fly the route".** Now `routeVerbLong` /
`routeVerbShort` in atlas-config: jets fly, hotel yachts **sail**, expeditions
and world voyages **cruise**, rail **rides** (a train runs, but the traveller
rides, and every other verb here is the traveller's). Hotels and villas have one
stop and no route, so they get no control at all.

**…and close stops are no longer flown as if they were an ocean.** Two changes,
both geometric rather than per-collection:

- **The reading altitude follows the route's own median leg**, bounded by
  `FLY_STOP_ZOOM_MIN`/`MAX` (4.6–7.4). One height cannot read every collection:
  at the jet's, a Highland line is a smudge; at the railway's, a Pacific
  crossing is an afternoon of open water. Measured on the shipped atlases, rail
  now reads at 6.28, hotel yachts at 6.81, world cruises at 5.58, jets at 4.60.
- **A leg that already fits the frame does not climb.** Rising and falling over
  a strait whose far side is on screen is motion for its own sake and it costs
  the very thing a coastal cruise is being watched for. 64% of rail legs and 55%
  of yacht legs are now crossed flat, at reading height, and quicker for it;
  world cruise legs, whose ports are genuinely far apart, still climb.
  Pitch follows the same logic — it flattens in proportion to how far the leg
  actually rises (`FLY_FULL_CLIMB`), so a flat leg keeps its tilt instead of the
  horizon lying down and sitting back up for no visible reason.

**The pace bound is now structural, not a target.** Chasing the above turned up
the deeper bug: position rode an easing curve while altitude rode its own, so
the ramp reached full speed at 15% of a leg while the climb had got a quarter of
the way up — the opening of every long crossing was flown fast through a frame
still tight enough to read a city in. Measured on the shipped atlases: a world
cruise peaked at **3.97 frame-widths a second** and a jet tour at 1.94, while
both averages looked respectable.

`legProfile()` replaces the easing curve with an integral: the camera moves at a
rate proportional to how wide the picture currently IS, shaped by the ramp for
soft ends. Normalised, a leg covers exactly its own ground while crossing the
same fraction of the frame every second, so the limit holds throughout a leg
rather than on average. A leg's duration is then the longer of what its climb
wants and what the pace requires — which is what makes the bound hold for a
merged leg spanning half an ocean, the case climb-only timing missed entirely
(merging lengthens a leg without changing how far it climbs).

**Measured after, on the shipped atlases** (348×340 phone band, ~40 routes each):

| collection | read zoom | median length | peak pace | legs flown flat |
|---|---|---|---|---|
| private jet | 4.60 | 26.5s (max 39s) | 0.70 sc/s | 16% |
| rail | 6.28 | 15.4s (max 40s) | 0.64 sc/s | 64% |
| hotel yacht | 6.81 | 20.6s (max 29s) | 0.67 sc/s | 55% |
| world cruise | 5.58 | 38.7s (max 42s) | 0.72 sc/s | 0% |

Every collection now sits under the 0.75 limit, against 1.94 and 3.97 before.

**Verified.** `verify:route-flight` grows to 55 checks. The ones that matter
here: every camera position sits on the drawn line to within 0.006° (measured to
the nearest point on a segment, not to a vertex — a camera correctly half way
along a segment is on the route); an orphan leg is drawn but never flown; a hop
with no geometry is left out rather than cut across, and the calls after the gap
still carry their own names; close stops are crossed flat while a leg that
outgrows the frame still climbs; and the polar guard engages on a whole-globe
framing while leaving an Alaskan cruise and a Riviera one exactly where they
belong.

Still not seen live: this sandbox blocks `api.mapbox.com`.

## The three fixes broke the map, and what that cost (2026-08-25)

The polar/hop/verb commit shipped to main and broke the atlas: clicking a card
showed no route and froze the globe in every browser. Main was reverted to the
previous commit within the hour, the causes were found against a stubbed
renderer, and the work re-landed. Four faults, in the order they bite:

**1. A NaN camera froze the map.** `frameSpan` passed `pitch: opts.pitch` and
`bearing: …` through to `easeTo`, and for the ordinary browse framing both were
`undefined`. Mapbox reads camera options with `'pitch' in options`, not with a
value check — a key PRESENT and undefined is not "leave that axis alone", it is
`+undefined`, which is NaN. A NaN pitch or bearing poisons the transform and the
renderer stops. So the framing meant to reveal the route killed the map instead,
which is why the route never appeared: it was drawn onto a map that had died.
Camera options are now built conditionally; an absent key is the only way to say
"don't touch that axis".

**2. A repaint killed any flight in progress**, and this one was NOT new — it
shipped with the flight rewrite and had been live since. `endFlight()` was wired
into `haltSpin()`, and `paintFocusRoute` calls `stopSpin()` on every repaint: a
hover leaving a card and restoring the pinned route, a basemap switch, a filter
change. On a desktop the selected card smooth-scrolls under a stationary
pointer, its mouseleave re-emits the pinned route, and the flight was dead a few
hundred milliseconds in — before its own arrival had finished. Ending a flight
now belongs to the things that genuinely take the camera: the map's own
interaction listeners, a new framing, the route being cleared.

**3. The jet atlas flew as one leg.** The hop-tagging fix assumed geometry
arrives one leg per itinerary hop, which is true of sea and rail and false of
jets: `adaptJet` arcs a whole journey into a single lofted polyline, so
route-frame's walk claims nothing and falls back to its greedy chain. Reading
"no hops claimed" as "no itinerary" flew a nine-city world tour as one unbroken
leg, naming one call and stopping at none. `routeHops` now cuts the drawn line
at the stops in that case — the camera still follows exactly the geometry on
screen; only where it comes down is decided differently.

**4. A dead control on a handful of sailings.** Some shipped yacht itineraries
resolve every port to the same coordinate ("Secrets of The Adriatic" puts all
five calls on Venice), so there is nothing to draw and nowhere to fly. The card
counted LOCATED stops and offered the control anyway. It now counts DISTINCT
ones, and a route with no drawable geometry but real stops is flown between them
rather than not at all.

**What let all this through.** `npm run verify`, the type checker and a
production build were all clean on the broken commit, and the browser check
made was that the right verbs rendered — not that clicking a card still drew a
route. Every one of these faults is visible in the first two seconds of using
the page, and none of them is visible to a harness that only ever calls the
flight's own functions.

So there is now a **stubbed Mapbox** (`scripts/mapbox-stub.js`) — a stand-in
implementing the map surface AtlasShell actually uses, recording sources,
layers, camera calls and popups rather than rendering. `scripts/verify-atlas-ui.mjs`
serves it to a headless browser in place of the CDN build and drives the real
page: hover a card, click it, press the route control, and assert that a route
is painted, that the camera is asked to go somewhere finite, and that the flight
reaches its calls. It is the check that would have caught all four.

`verify:route-flight` also grows the regressions as unit checks: a repaint does
not kill a flight; the camera is never handed an undefined or non-finite option;
a route drawn as a single leg still lands at every call; a route with no
drawable geometry is flown between its calls. Two of them assert on the SOURCE,
because which of `haltSpin` and the interaction listeners ends a flight is the
whole bug and both live outside the sliced block.

## A journey is flown in full; a voyage is sampled (2026-08-25)

Two tunings, once the flight was working on real maps.

**The hold came down to 1100ms** from 1400. A call's name is three or four
words on a still map, and the eye is already on it — it has just been flown
there. The saving is per call, so it comes off a thirteen-city tour four
seconds at a time.

**And the ceiling stopped shedding calls from anything but a world cruise.**
Every other atlas is a journey; a world cruise is a voyage, and the shipped
data says so plainly — stops per itinerary:

| collection | median | max |
|---|---|---|
| private jet | 7 | 13 |
| rail | 4 | 14 |
| hotel yacht | 6 | 10 |
| expedition | 9 | 79 |
| world cruise | 39 | 153 |

Shedding calls from a nine-city jet tour to save four seconds shows less of the
trip than the trip has, which is the opposite of what the flight is for. A world
cruise cannot be flown in full — 153 ports at a hold and a hop each is the
better part of ten minutes — so there alone the landings are spread across the
voyage, roughly one a week. The route is still drawn and still flown over in
full either way; only the pauses thin out.

Read from the COLLECTION rather than from the itinerary's length, because the
two are not the same question: a long expedition and a short world cruise carry
the same number of ports, and it is the product that decides whether flying all
of them is the point or impossible. The consequence is that the tail of the
expedition atlas (its longest is 79 ports) runs long, deliberately — one sailing
in a hundred, asked for, and the control says "Stop" for as long as it runs.

**Measured on the shipped atlases** (348×340 phone band, ~40 routes each):

| collection | read zoom | median length | peak pace | flat legs | calls landed |
|---|---|---|---|---|---|
| private jet | 4.60 | 24.4s (max 47s) | 0.67 sc/s | 15% | all |
| rail | 6.28 | 13.8s (max 38s) | 0.64 sc/s | 64% | 99% |
| hotel yacht | 6.81 | 18.5s (max 26s) | 0.67 sc/s | 55% | 93% |
| world cruise | 5.58 | 38.8s (max 40s) | 0.73 sc/s | 0% | 10% |

The rail and yacht figures are not calls being dropped: they are exactly the
consecutive same-port repeats — a second night in one place — which have no hop
to fly and so no landing to make. Collapsing consecutive repeats in the source
data gives 99% and 93%, the same numbers. Every distinct call is landed on.

## Things to do — the Project Expedition layer, surfaced (2026-08-27)

The eighth thing the Guide can answer, and the only one that was finished,
working, deployed, and effectively unreachable. Written down here because it
never was: before today it appeared in no state doc, no README env row, no nav,
no card, no button, and no chip.

**What the layer is.** `lib/experiences.js` calls Project Expedition's
`/return_tours` and returns real tours, private guides and day experiences for a
place — Private and Elevate picks (the advisor's own recommendations) first,
then a few from the broader catalogue. It is exposed to the model as a second
Anthropic tool, `search_experiences`, beside `search_offerings`
(`app/api/guide/route.ts`). It is **discovery, not booking**: pricing and
`booking_meta` are dropped on purpose and no checkout URL is ever returned.

**Why it stayed hidden.** Three gates, two of them deliberate and correct, one
of them an oversight that made the other two fatal:

1. `lib/guide-prompt.js` told the model never to deliver experiences unasked.
   Right call — an advisor who answers a hotel question with an activity list
   stops sounding like an advisor, and each call is a country-sized catalogue
   pull (~2 MB, 8s timeout) that would tax every reply to serve a minority.
2. `route.ts` keeps experiences out of `toolMeta`, so they never become result
   cards, map pins, a deep link, or an advisor CTA. Also right: a record with no
   price and no booking path must not render like inventory that has both. Only
   the area hotels the tool returns alongside are pushed into the pipeline.
3. **Nothing anywhere said the question could be asked.** The only door was a
   traveller typing "what is there to do in Ushuaia" unprompted, in a product
   whose empty state teaches "Antarctica in January" — destination plus season.
   Nobody phrases it that way here.

Gate 3 is what shipped as fixed. Gates 1 and 2 still stand.

**The three doors now open, in order of expected intent:**

- **Journey dossier** (`components/JourneyDossier.tsx`) — the days at the
  embarkation port. Every voyage and journey has one or two on the front of it,
  the supplier's file covers none of them, and this is the layer's strongest
  case: `record.from` (or the first landfall) becomes the ask.
- **Hotel dossier** (`components/HotelDossier.tsx`) — the days around a stay,
  asked from the screen where the traveller is already reading about one
  property. Hidden when the record carries no city.
- **Chat, under any reply that returned results** (`ChatMoves` in
  `components/GuideChat.tsx`) — a second move beside the advisor CTA, built
  deterministically from `leadPlace()` rather than emitted by the model, because
  a model-emitted offer appears only when the model remembers to emit it, which
  is how a working feature became unreachable in the first place. Suppressed on
  a reply that *is* an experiences answer.

All three compose the question through `askAboutDays()` in `lib/atlas/ask.ts`
and deliver it down the existing ask path (in place where a chat is mounted,
`/?ask=` where one is not). The wording carries place and country explicitly,
because the model — not `normalizeCountry` — is what parses them into the tool
call.

`leadPlace()` (`lib/guide-meta.ts`) decides whether the chat offer appears at
all, and the null case is the load-bearing half: `search_offerings` takes a
marquee `region` key as well as a place, and "what is there to do in Antarctica"
is a worse question than no question. Order is named place → a returned result's
city → `places[]`. The city outranks `places[]` on purpose: that field holds
colloquial *areas* ("the Amalfi Coast", "the Cotswolds"), which are the right
input for a hotel search and the wrong subject for a day — a day is spent in a
town, and "a few days in Amalfi Coast" gives away that a machine wrote the
traveller's own sentence.

**The prompt now distinguishes delivering from offering.** The model still may
not call the tool unasked. It may close a reply that landed a real stay or
departure with one short sentence leaving the door open ("if it helps, I can
look at what there is to do around Positano") and then stop — at most once a
conversation, never on consecutive replies, never in place of the answer they
came for.

**Measurement, which did not exist.** `experiences_asked` (with `source`:
chat-move / hotel-dossier / journey-dossier) and `experiences_returned` (total,
preferred, unavailable) in `lib/analytics.ts`. The counts ride to the client on
`GuideMeta.experiences` — deliberately *beside* `tools`, not in it, so a
prose-only record can never reach `leadTool` and become a card. A run of zeroes
in `preferred` means we are promoting the generic catalogue rather than the
curated half, which is an argument about the feed, not about placement.

### ⚠ Two things to confirm in production before judging the numbers

1. **`PE_API_BASE` defaults to staging.** Unless production sets it to the live
   base, every one of these doors leads to staging inventory.
2. **`PROJECT_EXPEDITION_TOKEN` may not be set in production at all.** If it is
   not, `search_experiences` degrades gracefully — the Guide says the catalogue
   is unreachable and offers an advisor — which is correct behaviour and also
   indistinguishable, from the outside, from the feature working badly. Both
   vars are now in the README env table.

### Not proposed, and deliberately so

**No experiences pillar, and no experience cards.** The Safari Atlas earns
`/atlas/safari` because the camp *is* the waypoint — a bookable thing with
geometry, where both feeds describe the same journey from both ends. Project
Expedition is the opposite shape: no route, no coordinates, no pricing, no
booking path by design, and a country-level pull with place matching done
client-side. `WORKORDER-safari-atlas.md` rejects culinary, wellness and cultural
tours as "route-only… an eighth variation on the jet atlas"; this fails that
test harder. Safari is a pillar; Project Expedition is texture — what fills the
days between the bookable things. Surfacing it like a pillar is what would make
it look cheap.


## Virtuoso is the supplier of record (2026-08-25 → 08-28)

The atlases used to be curated files with an AI's guesses filling the gaps. They
are now the Virtuoso Partner API's facts with our curation layered on top, and
the division of authority is the whole design: **Virtuoso owns what a property
or a journey IS** — name, place, coordinates, category, amenities, photographs,
the year-stamped benefits — and **we own what Virtuoso has no opinion about** —
Cadence programme membership, ranking, the marquee region the map filters on,
booking links, advisor curation.

Protocol, and the traps that cost real time, are in
`Master Documents/Virtuoso_API_Reference.md`. The three that shape the code:
the login parameter is `user` and not `apiUser`; every kind of failure answers
with a bodyless 500 that never says which kind; and **bearer tokens are
single-use**, arriving at the top level of each response as `token`. That last
one forbids parallelism outright, so `lib/virtuoso/client.mjs` serializes every
call through one promise chain. A full hotel detail crawl is ~2,000 sequential
calls at ~800ms — half an hour — which is why every sync caches to NDJSON and
resumes.

**What is synced** (`data/atlas/`, committed, never fetched at request time):

| feed | records | what it decides |
|---|---|---|
| hotels | 2,073 | the hotel atlas's facts, perks and photography |
| promotions | 2,028 | live supplier offers, joined to a property by company name |
| cruises | 4,465 | the expedition atlas, day by day |
| tours | 505 | the jet, rail and safari atlases |

**What it produced.** `luxury-hotels.json` holds 2,240 properties: 1,925
upgraded from Virtuoso, 148 newly added, 167 local-only partners, 381 duplicates
folded away and 2 junk records removed. 995 categories were corrected — the old
classifier had put 73% of everything into "City Hotel" and found 15 ski
properties where the supplier flags 99. 1,922 perk lists and 1,923 photographs
now come from the supplier rather than from us. The journey atlases grew
against their curated bases: yacht 374 → 467, world 250 → 303, expedition
3,542 → 3,662, and safari 0 → 274. Jet and rail shrank (147 → 124, 135 → 130)
because the supplier's catalogue is the authority on what is still sold; the 27
bespoke jet journeys with no supplier record are kept deliberately.

**The data is committed, not fetched.** Every supplier change lands as a
reviewable diff, because these files carry a lot of hand-curation and a supplier
quietly dropping records is invisible without one.
`.github/workflows/virtuoso-sync.yml` runs the whole chain at 09:00 UTC, each
crawl `continue-on-error` so a bad night for sailings cannot throw away a good
hotel refresh, with the NDJSON cache carried between runs so a night that cannot
finish resumes rather than restarts.

**Three guards stand between an unattended crawl and production**, because
nobody is watching at 3am: `merge-virtuoso-journeys.mjs` refuses a feed under
90% detail coverage and refuses again if any atlas would lose more than a
quarter of its journeys; `verify-virtuoso-delta.mjs` refuses a hotel count that
falls more than 10%; and `verify-virtuoso-freshness.mjs` judges staleness on
when a feed was last **checked**, not when it last **changed**, so a quiet
fortnight at the supplier reads as healthy and a week of failing syncs does not.

### The review pass (2026-08-28) — what was wrong

**`npm run verify` had been silently disabled for a day.** The hotel merge gate
byte-compared its output against the committed file — but three fields in that
file are decided by the date the merge runs, not by anything a supplier sent:
`promotions` and `hasPromotion` filter offers on today, and `perksStale`
compares the supplier's benefit year against this one. The morning after an
offer expired, the gate reported the file stale with nothing having changed, and
everything behind it in the `&&` chain never ran. (The perk-year half had not
bitten yet; it would have, on 1 January.) The gate now compares the parts the
feeds actually own and reports calendar drift as the note it is. The deploy
re-merges on every build, so the live site was never affected.

**And `npm run verify` was an `&&` chain, so it hid its own findings.** That
is the right shape for a build and the wrong one for a verification suite: the
checks are independent claims about different parts of the atlas, and stopping
at the first failure meant a false positive at the front took sixteen real
checks down with it — one of which was genuinely red, and had been for a
fortnight (the route-flight assertion below). It now
runs through `scripts/verify-all.mjs`: every check runs, and the failures are
named together at the end. `npm run verify:bail` keeps the old fail-fast
behaviour, and `node scripts/verify-all.mjs <substring>` runs a subset.

**Four generated files churned every night on their timestamps alone.**
`hotel-aliases.json`, `virtuoso-id-map.json`, the sea-route collections and the
cruise-region overlay each stamped the moment their generator ran, so the tree
was already dirty before the nightly job asked git whether anything had moved —
which is why the job's "No supplier changes today" branch could never fire, and
why a real change arrived buried among four noisy ones. `scripts/lib/steady-stamp.mjs`
now keeps the previous stamp when nothing else would change, the same way
`lib/virtuoso/write-feed.mjs` already did for the feeds themselves.

**The nightly job never rebuilt the safari camps.** `build:safari-camps` reads
`luxury-hotels.json` and `safari/itinerary.json`, both of which the job rebuilds,
but the job did not then rebuild `public/maps/safari/camps.json` from them.
`verify:safari-camps` byte-compares, so the first night that moved a camp would
have turned the suite red for everyone. Added to the workflow.

**The freshness check called a half-checked set current.** A feed with no
recorded check at all warned and then `continue`d, never reaching the verdict,
so the summary read "Virtuoso feeds are current" while hotels and promotions had
never recorded one — the precise failure the file was written to catch. It now
carries them into the verdict, and `--strict` fails on them. Its drift check
also looked for a noun (`"safari journeys"`) that `atlas-config.ts` does not use,
so the safari headline count was never actually verified; and its regex escape
was inert (the character class closed early), which cost nothing only because no
noun contains a metacharacter.

**The four sync scripts carried four byte-identical copies** of the streaming
NDJSON cache reader — the one that exists because the cruise cache reached
1.35GB and `readFileSync` threw at Node's 512MB string ceiling. That is a fix
that lands in three files and not the fourth; it is now
`lib/virtuoso/ndjson-cache.mjs`.

**A test outlived the decision it encoded.** `verify:route-flight` had been red
since `dbd82c0`, which noted it and left it. The claim that failed was "a hop
with no geometry is left out, not cut across" — and the code was right, not the
test. Both positions sound correct, which is why this is worth writing down:
route-frame leaves a hop it has no line for EMPTY on purpose, because a straight
stroke between two ports claims a route the ship does not take. The camera is
not under that constraint — it draws nothing, it only travels — and the
alternative to travelling is silently not calling at a port the itinerary lists,
leaving a hole in the numbering that reads as a data error. Around 15% of
expedition stops carry no coordinate, so that is the common case.

`fillGaps` (in `routeHops`) made that change on 2026-08-25 in `9611c35`, hours
after `ddf25a3` wrote the assertion — and the test should have gone red that
afternoon. It did not, because the verifier was crashing before it reached a
single assertion, having drifted off two renamed constants. By the time
`dbd82c0` repaired it, the failure looked like a pre-existing mystery rather
than the direct consequence of a deliberate change made the same day. Two gates
failing at once (that crash, then the `&&` chain) is what turned a half-day
inconsistency into a fortnight of red.

The assertion now states what the flight actually does: a hop with no geometry
is flown direct, and its call is still landed on. It is measured against bowed
legs, so cutting the corner on a hop that *does* have geometry still lands 6°
off and fails — the useful half of the original claim is kept.

**The shrink guard covered one file out of eleven.**
`verify-virtuoso-delta.mjs` is the last gate before the unattended job commits,
and it checked `luxury-hotels.json` and nothing else — so a night where
`/v2/cruises` answered with an empty catalogue would have erased 4,465 sailings,
committed them, and deployed. It now covers all four raw feeds and all six
journey atlases. Limits are per feed and the reasons are real rather than
generous: 10% by default, 30% for promotions because campaigns expire in batches
on fixed dates, 25% for the journey atlases because departures sail (matching
`MAX_ATLAS_SHRINK` in the merge, which asks the same question of a different
baseline — the curated base rather than what is committed and serving).

Checked against four deliberate breaks before shipping: an emptied cruise feed
refuses at 100%, a 20% short tour crawl refuses, a 20% promotions drop passes as
the campaign expiry it looks like, and growth always passes.

One feed over its limit blocks the WHOLE commit, including feeds that refreshed
perfectly. That is deliberate, and it is the opposite of the `continue-on-error`
stance the crawl steps take, for a reason worth stating: a crawl that fails
publishes nothing new, while a crawl that succeeds with half a catalogue
publishes a deletion. Blocking costs a day of freshness; not blocking costs live
inventory.

### Still open

- **The hotel and promotion feeds have no recorded check.** Both files are on
  disk and current in content, but neither has run through `write-feed.mjs`
  since the status file was introduced, so freshness cannot speak for them.
  One successful nightly run fixes it; until then the verifier says so out loud
  rather than rounding up to green.
- ~~**`Master Documents/BeVvip_API_Integration_Strategy.md` describes an
  architecture that no longer exists.**~~ **Closed 2026-08-28.** The replacement
  is `Master Documents/BeVvip_Supplier_Architecture.md`: division of authority,
  the nightly pipeline and its four guards, the overlay ledgers, the query
  layer, the crawlable surfaces, and what is deliberately absent. The May
  document keeps its status note and is now explicitly history — it is still
  worth reading for *why* the rule in §1 exists, which is the half that
  survived. The stack sections of the two project master documents are still
  stale and are the remaining piece of this item.

## The crawlable surface — entity pages and live answers (2026-08-28)

The Virtuoso work made the atlas true. It did not make any of it **readable**,
and that gap is the whole of this change.

Before it: the answers surface was 24 hand-written pages, the sitemap held 147
URLs, and the 2,240 properties behind every claim on those pages existed for a
crawler only as a number in a sentence. The map is a client component, the
property dossier fetches `/api/hotel/luxury-hotels/:id`, and `robots.txt`
disallows `/api/` — so the supplier's own descriptions, the coordinates, the
room counts, the year-stamped benefits and the live promotions were all
invisible to search and to answer engines alike. A page whose entire claim is
first-hand knowledge of specific hotels could not name one.

### 1. Every property is a page

`/hotels` → `/hotels/<country>` → `/hotels/<country>/<property>`, server-rendered
from the merged feed, with `Hotel` + `BreadcrumbList` JSON-LD. 400 were prebuilt
at deploy across as many countries as possible and the rest served on ISR; all
2,240 are built at deploy now, for the reason in "The ISR writes were paying for
nothing" below. The sitemap went from 147 URLs to 2,504.

Slugs are assigned once for the whole feed, not computed per record, and the one
collision in the catalogue (two Oberoi Beach Resorts both addressed "Hurghada,
Egypt") is broken by our stable `id`, lowest keeps the clean slug. That ordering
is the point: a new colliding property cannot take an existing property's URL
away, so a bookmarked link stays a link.

Two things are deliberately NOT in the markup, and both are the kind of omission
worth writing down so nobody adds them back as an improvement:

- **`aggregateRating`.** The feed carries `reviews.total` and
  `recommendedPercent` for 1,599 properties. They are Virtuoso ADVISOR reviews,
  collected by the supplier, and "% who recommend" is not a rating on a scale.
  Claiming them as our star rating is the kind of rich result that gets a site's
  structured data ignored wholesale. The number is shown to a reader in prose,
  with its source named, and kept out of the JSON-LD.
- **`offers` / `priceRange`.** We hold no rates. The architecture's central rule
  is that the language model is never the rate source; markup is not an
  exception to it.

### 2. The answers stopped stating counts and started asking for them

`data/answers/*.js` no longer types numbers. `{{hotels:program=Marriott STARS}}`
is a query against the shipped feed, resolved when the page renders
(`lib/seo/facts.mjs` holds the semantics and no data; the Next pages and
`scripts/verify-seo.mjs` are two loaders for one implementation).

The drift this fixed had already happened, everywhere, in published and indexed
copy: STARS 103 → 59, Bellini Club 22 → 3, Mandarin Oriental Fan Club 34 → 4,
Virtuoso 1,970 → 1,866, Italy 244 → 217, and — the one where the classifier had
been wrong rather than the supplier — **15 ski properties where the feed flags
94**. Every one of those sentences was live on a page built to be quoted.

Two other things each answer can now carry:

- **`capsule`** — 40-90 words that answer the question standing alone, before
  the long-form lead. It is what the `acceptedAnswer` says, and the selector the
  `Article` block's `speakable` names. All 24 have one.
- **`evidence`** — a query whose results render as a table of REAL properties,
  each linked to its own page, with an `ItemList` of them in JSON-LD. This is
  the part only the Virtuoso sync makes possible: a claim about "the Preferred
  Partner properties" now arrives with the properties, and the sentence and the
  table cannot disagree because they are the same query.

### 3. One publisher, defined once

`lib/seo/site.js` defines the agency and the site as `@id`-addressable nodes,
emitted in the root layout on every page; everything else references them.
`lib/answers.js` used to describe the publisher inline in `faqJsonLd`, a fourth
spelling of "Aspen Travel Advisors" with nothing tying it to the other three.
Schema moved to `lib/seo/answer-schema.js` so the registry stays free of the
atlas — `robots.js` and `sitemap.js` import it and must not load the feed.

Also added: `/llms.txt` (what is first-hand here, what is ours, and — loudly —
that we hold no rates, so any price attributed to this site is invented), and
`components/SiteFooter.tsx`, which is not decoration: every route into the
inventory ran through SiteNav's Explore menu, which renders its links only after
a click, so a crawler landing anywhere found three links and a map canvas. The
footer goes in the document routes rather than the layout, because `.app` is
pinned to `100dvh` and never scrolls — a footer there takes a strip off the map
on every page.

### 4. `verify:seo`, and why it is in the nightly job

Three failures here are silent, and the third one bit during this very change:

1. **A token that resolves to zero.** `{{hotels:program=Marriot STARS}}` — one
   't' — is a valid query for a programme nothing is filed under. It resolves,
   cleanly, to "0", and publishes "our atlas tracks 0 properties under Marriott
   STARS". Caught by count, not by exception.
2. **An evidence query matching nothing** — the claim keeps its sentence and
   loses its table.
3. **A surface that forgets to resolve at all.** The detail page resolved its
   record and the answers index did not, so `/answers` and `/llms.txt` published
   `{{hotels:program=Virtuoso}}` in their link summaries while the pages behind
   those links read correctly. Resolving-is-possible and every-surface-resolves
   are different claims; the second is only answerable from the built output, so
   the check walks `.next/server/app` when a build is present and says out loud
   when it is not. Every prose consumer now reads through `resolvedAnswers()` /
   `resolvedAnswer()` rather than the raw registry.

It runs in `npm run verify` and also as its own step in
`.github/workflows/virtuoso-sync.yml`, after the shrink gate. That is the
reason it exists twice: the published copy is now made of queries against the
feed that job replaces, so a supplier retiring a programme breaks a sentence
without touching a line of code, at 09:00 UTC, with nobody watching.

## The rest of the atlas gets pages too (2026-08-28, same day)

The hotel work above left five collections and the villas out. They are in now,
and two of the three decisions are worth keeping written down.

### One page per ITINERARY, not per departure

`/journeys/<collection>/<slug>`, six collections, **1,991 pages carrying 4,960
departures**. The obvious implementation — a page per sailing — is the wrong
one, and not marginally: the cruise feed holds 3,662 sailings across 902
distinct operator-plus-itinerary pairs, and "Exploring Galápagos" alone appears
235 times, identical but for a date. That is 235 near-duplicate pages, which is
the fastest way to have the whole tree discounted.

So a page is an itinerary and the departures are a table on it — better for a
reader too, because "when does this run" becomes a question one page answers
completely instead of 235 pages answering it once each. Yacht collapses 467 →
347 the same way. The other four barely collapse at all (train 130 → 128), which
is itself the evidence that the key is the right one.

`verify:seo` asserts the collapse rather than assuming it: if departures-per-page
ever falls below 1.2 the grouping has stopped grouping — a supplier appending
the sail date to the title would do it — and the tree has quietly become
near-duplicate pages again. Measured today: 2.5.

The pages run the REAL adapters (`adaptCruise` / `adaptVoyage` / `adaptJourney`),
so a page and the map agree about what a journey is; the three prose fields the
adapters do not carry (description, what's included, the offers) are read back
off the raw record. The verifier compiles those same adapters through
`scripts/lib/adapters-build.mjs`, the way `verify-adapters` and `verify-hotels`
already do, rather than transcribing the grouping rule into a second copy.

### The villa pages already existed. Nothing linked to them.

3,902 villa detail pages have been live since the villa atlas shipped, and they
had **no JSON-LD at all** — a page carrying a name, a place, a coordinate, a
sleeps and a bedroom count published none of it in a machine-readable form —
and **114 of them were in the sitemap**. The other 3,788 were rendered,
addressable, and unreachable: worse than absent, because they cost render budget
and returned nothing.

Both fixed: `VacationRental` + `BreadcrumbList` on the detail pages, and
`/villas` → `/villas/<destination>` hubs above them. The detail URLs are
deliberately NOT moved to sit under `/villas/…`. They are live, indexed and
linked; a tidier address for 3,902 pages that already answer would 404 every one
of the old ones.

Two omissions in the villa markup, and the second was a real bug caught in
review of the rendered output:

- **No `geo` for the 236 villas placed on a locality centroid.** The page says
  in prose that the location is approximate; a `GeoCoordinates` node claiming a
  town square is the villa is a worse lie in markup than in a sentence.
- **No `addressCountry`, at all.** The first draft mapped the feed's
  `destination` onto it and published `"addressCountry": "Florida"`. That field
  mixes four levels of geography across its 62 values — countries ("South
  Africa"), US states ("Florida"), Mexican resort towns ("Punta Mita"), Canadian
  provinces ("British Columbia") — and `region` is a marketing bucket. We do not
  hold a country for a villa, so the markup no longer claims one.

### `country` stopped being a facet and became an address

The hotel pages made `country` a public URL, and `audit-listings.mjs` now
reports what that exposed — four checks, in `--section countries`:
case-and-accent variants splitting a country across two hubs ("Turks And Caicos
Islands" 10 / "Turks and Caicos" 1); cities claimed by two countries (a signal,
not a verdict — Bodrum is a duplicate, Naples and Cambridge are two real
places); one ISO code under two country names (certain: VNM holds both "Vietnam"
and "Da Nang"); and countries no property has a city in ("Various", three
residence programmes).

Reported, not repaired, and specifically NOT canonicalised in
`lib/seo/hotels.js`: folding "Turkey" into "Türkiye" for the page would give
`/hotels/turkiye` 24 properties while `/atlas/hotel?country=Turkey` still showed
2. A page and a map disagreeing about what a country contains is a worse defect
than the one it fixes. The repair belongs in a ledger applied at load, the way
`hotel-aliases.json` and `place-aliases.json` are, so both surfaces see it.

An earlier draft of the last check flagged any country value that also names a
city, and called Singapore, Anguilla, Saint Barthélemy and French Polynesia
errors. They are city-states and territories where the names genuinely coincide.
Having no city at all is the tell that survives.

### Where the sitemap ended up

**147 URLs → 8,354.** 2,240 properties and 117 country hubs, 1,991 itineraries
and 6 collection hubs, 3,902 villas and 62 destination hubs, 24 answers, 8
atlases, three roots. 1.45MB — inside Google's 50MB / 50,000-URL limits with
room to spare, so it stays one file.

Two fixes fell out of reading the generated XML rather than the code. `/villas`
and `/journeys` each shipped twice, because `app/sitemap.js` listed the roots AND
each entry function emitted its own; the entry functions now own their whole
trees, roots included. And the atlas list in `core` was hand-kept, named seven
collections, and had never been updated when safari shipped as the eighth — the
one atlas whose inventory was actively growing was the one not being listed. It
derives from `COLLECTIONS` now. That is the third time this exact failure appears
in this file; `audit-listings.mjs` documents its own version of it in `SHIPPED`.

### Still open here

- **Villa and sailing counts are still typed in answer copy.** `{{hotels:…}}` covers the hotel
  feed and `{{collection:…}}` covers the shipped totals; "1,541 villas that
  sleep eight or more under $2,000" and "555 Antarctic departures" are still
  prose snapshots, because a villa or sailing term would pull the 7.3MB villa
  file and the 4.9MB sailings file into the answers bundle. Worth doing behind
  a build-time facts artifact rather than a live import.
- **The fact engine still only knows hotels.** `{{hotels:…}}` queries the hotel
  feed; there is no `{{journeys:…}}`, because a journey term would pull every
  route feed and 3.6MB of cruise geometry into the answers bundle. The journey
  data is now normalized and indexed in `lib/seo/journeys.js`, so the shape of
  the fix is clear — a build-time facts artifact both can read.
- ~~**`generateStaticParams` prebuilds 400 of 2,240.**~~ Resolved on 2 September
  by building all of them — see "The ISR writes were paying for nothing".


## Safari was on the map and outside the product (2026-08-28)

Safari shipped as the eighth atlas with everything visible: pins on the home
globe, its own colour in the registry, `/atlas/safari`, an entry in the Explore
menu, 274 journeys in the feed, a camps layer built nightly. What it never got
was a **query backend**. `lib/atlas/index.js` registered six:

    const BACKENDS = { hotel, cruise, jet, yacht, worldcruise, train };

so `queryAtlas("safari")` threw `unknown atlas type: safari`, `safari` was not
in the `search_offerings` tool enum, and `dispatchSearchOfferings` had no branch
for it. Its last line is:

    // Unknown type -> treat as hotel search rather than erroring.
    return searchHotels(input, fetchImpl);

Right instinct for an unknown type, wrong outcome for a real one. **A traveller
asking The Guide for a Botswana safari got a shortlist of LODGES** — the 72
`Lodge / Safari` properties in the hotel atlas — and never an itinerary, because
the 274 itineraries were unreachable from the tool. No error, no empty result,
no gap a reader would notice: a confident answer from the wrong atlas, while the
right atlas's pins sat on the globe behind the chat panel.

This is the third time the same shape of failure has appeared in this file, and
every time it has been safari: missing from `audit-listings.mjs`'s `SHIPPED`
table, missing from the sitemap's hand-kept atlas list, missing from the
dispatcher. A collection that ships in eight places and is registered in seven
looks complete from every direction except the one nobody checks.

### What was added

- **`lib/atlas/safaris.js`** — the sibling of `trains.js` over the safari feed.
  Same journey shape (both are `adaptJourney` collections), three differences,
  all the feed's: no named vessel; 268 of 274 journeys are on-demand with a
  booking window rather than a date, so the `onDemand` exemptions carry nearly
  the whole collection; and no `mq` stamp, so marquee keys derive from the
  region tag.
- **Registered** in `lib/atlas/index.js`, with a note on why villa is still
  absent (it has a different contract — party size, bedrooms, nightly ceiling —
  and is served by `searchVillasChannel`).
- **`safari` in the tool enum**, a dispatch branch with a lodge sidecar, and
  `/api/safari-journeys` in `ATLAS_PATHS`. The sidecar ranks on `wildlife`
  rather than `uhnw`, because the stay that pairs with a Botswana itinerary is
  a camp and `uhnw` returns city palaces.
- **A safari pillar in the prompt.** The old line filed safaris as advisor-only
  alongside buyouts, which was true when it was written and had been false since
  the atlas shipped. Seven pillars became eight. The new text also says plainly
  that safari is two questions — the ITINERARY (type safari) and the LODGE (type
  hotel) — and that a good answer calls both.

### The bug the split haystack caught

`country=Namibia` returned **81** journeys against **17** that are actually in
Namibia. Cause: one shared search haystack that included the region family's
vocabulary, and `REGION_HAY.OKAVANGO` contains "namibia" because the region is
"Botswana, the Okavango & Namibia" — so every Okavango journey answered a
Namibia question. The Guide would have named Botswana itineraries as Namibia
options, which is precisely what its own prompt forbids: *"only present a
category when the returned records genuinely reach the destination."*

Now two haystacks. `country=` reads the journey's own geography (name, brand,
country, from, to, stops) and returns 20 — the 17 plus three that genuinely
start or call in Namibia. `q=` reads that plus the region words, so "the
Serengeti" and "Victoria Falls" still find what they describe. A region family
is a good search hint and a bad country.

### Answers

`data/answers/safari.js`, and a **Safari category** that could not previously
exist. `answersByCategory()` renders `CATEGORY_ORDER.filter(c => groups.has(c))`
— so an answer whose category is not in that hand-kept array is dropped from
`/answers` silently, keeping its own page and its sitemap entry and losing the
only thing that links to it. `verify:seo` now fails on an unknown category, so
adding one is a build error rather than an orphan. The existing safari-lodge
answer moved from Hotels to Safari and gained a link to the itinerary half it
never had.

### Still open here

- **`{{hotels:…}}` is still the only fact term.** The safari answers state
  itinerary counts (274, and the per-country split) as prose from `UPDATED`,
  because the fact engine reads the hotel feed only. `lib/seo/journeys.js` now
  normalizes and indexes every journey collection, so a build-time facts
  artifact that both the pages and `verify-seo` can read is the shape of the
  fix.
- **`region=kenya` returns 111, not 74.** The safari atlas's own region tag is
  EASTAFRICA = "Kenya, Tanzania & the Great Migration", so a region filter
  answers with the family. That is the collection's own taxonomy and the same
  behaviour rail has; the prompt routes country names to `country=` (74) and
  reserves `region=` for the fourteen marquee keys, so the Guide should not hit
  it. Worth watching in transcripts rather than pre-emptively splitting.


## Closing out the open items (2026-08-28)

Four things were carried as open in this file and in the work orders. Three are
closed; the fourth turned out to be a trap.

### The country ledger — closed

`country` stopped being a filter facet the day `/hotels/<country>/<property>`
shipped, and the audit found four countries spelled two ways, each minting its
own thin hub page: Turkey (2) beside Türkiye (22), Turks and Caicos (1) beside
Turks And Caicos Islands (10), a case variant of Saint Vincent, and "Da Nang"
filed as a country.

The evidence that these are typos and not distinctions is in the data:
**every minority spelling is a pre-merge `source: local` record carrying no
countryCode, while the majority spelling carries the supplier's ISO.** Da Nang
is the exception and the strongest case — it carries VNM, so the feed
contradicts itself rather than us contradicting the feed.

`data/atlas/hotel/country-overrides.json` + `lib/atlas/country-overrides.js`,
applied at load. 117 countries → 113. Two deliberate non-actions are written
into the ledger: **Macau is not folded into China** despite sharing CHN, because
it has its own ISO code in the world, its own visa regime and its own market;
and the three "Various" portfolio listings (no city, address literally
"Various", placeholder coordinates — the Mandarin Oriental entry sits in the
Gulf of Tonkin) keep their atlas records and get no address page, because a page
claiming an address for them would be inventing one. 2,240 → 2,237 property
pages.

**`lib/atlas/hotel-overlays.js` is the part worth keeping.** `applyProgramOverrides`
had four call sites — the API, the map builder, the entity pages, the verifier —
each of which a new overlay had to be added to by hand, with nothing failing
when one was missed. The symptom would have been the page and the map
disagreeing about what a country contains, which is the precise defect the
ledger was written to avoid creating. There is one function now.

`audit-listings.mjs --section countries` reads the feed THROUGH the overlays, so
it reports what is LEFT rather than what is already fixed — a report that can
never go green is a report people stop reading. What is left is seven cities
that two countries legitimately share (Naples, Cambridge, Victoria).

### The journey facts artifact — closed

`{{hotels:…}}` was the only fact term, so the journey copy still typed its
numbers. A `{{journeys:…}}` term could not read the route feeds directly:
counting rows would have pulled every atlas plus 3.6MB of cruise route geometry
into the answers bundle.

`scripts/build-journey-facts.mjs` precomputes the countable fields —
`data/atlas/shared/journey-facts.json`, 1,991 rows, one per ITINERARY — using
`lib/seo/journey-key.mjs`, the same grouping the `/journeys` pages serve from.
That module is itself a fix: the grouping rule had three copies within a day of
being written (the pages, the verifier, and now the generator), and a verifier
carrying its own definition of the thing it verifies can pass while the thing is
broken.

**Two journey tokens, not one.** `{{journeys:…}}` counts itineraries — pages,
the thing a reader browses. `{{departures:…}}` counts sailing dates behind them.
Safari is 250 and 274; expedition cruise is 902 and 3,662. Writing the departure
count and linking to the itinerary pages is the near-miss that makes a page look
wrong to somebody checking it.

Two gates: `verify:journey-facts` byte-compares the artifact against the feeds,
and `verify:seo` asserts the per-collection counts so the failure message names
which collection moved. Both wired into `prebuild`, `sync:virtuoso`, the nightly
workflow and `verify-all`.

One grammar bug found writing the first tokens: `&` separates terms, so
`operator=Abercrombie & Kent` parsed as a term called " Kent" and failed the
build. Values now accept `%26`, query-string style, and the parse error says so.

### The safari work order — closed

`WORKORDER-safari-atlas.md` still read **BLOCKED ON EGRESS** months after the
crawl ran. Marked shipped, with the 403 kept as a historical note because that
block can recur, and with the outcome recorded: 274 journeys against the
300–800 the phase predicted, well above the ~120 floor that would have triggered
a re-scope.

### The landmask copies — NOT a cleanup, and acting on the note would have broken production

D1 left `public/maps/{cruise,yacht,worldcruise}/data/landmask.bin` with a note
saying "delete the served three in D3". **Do not.** D3 shipped keeping the
standalone pages as two deliberate escape hatches, which supersedes that plan:
`?legacy=1` is the documented fallback if the Maps key or the tiles are
unavailable, and **`?hero=1` — the ambient embeds the marketing landers use —
renders the iframe even for migrated collections**, because the landers want a
bare map rather than a filter rail. Deleting the three copies would have blanked
the sea routes on every marketing lander, silently.

The note has been corrected in place. This is the second time in this file a
"still open" item has been stale in a direction that would cause a regression if
acted on, which is an argument for reading the code before the note.

## Paul Gauguin joins the Expedition Atlas (2026-08-29)

Paul Gauguin Cruises is now an eleventh line in the expedition selection. It was
already an approved partner everywhere except the map — `paul-gauguin` sits in
`brand-profiles.json` and `advisor-overlay.json` with `appliesTo: ['cruise',
'yacht']` — while the atlas it applies to had never carried a sailing of it.

**Selected on the line alone, not crossed with a cruise type.** Every other
expedition line is `cruiselines × cruisetypes: Expedition`. Paul Gauguin is a
330-guest luxury small ship with a watersports marina rather than an ice-class
hull with a zodiac fleet, and the catalogue types it that way, so the same cross
would have returned little or nothing. `SELECTIONS` in
`scripts/sync-virtuoso-cruises.mjs` therefore holds a second `atlas:
'expedition'` entry with no type filter — safe for this line in a way it would
not be for Silversea or Seabourn, because one ship sailing nothing but French
Polynesia and the South Pacific has no mass-market half to filter out. It lands
in Hawaii & Tahiti (38 sailings today, the thinnest real region on the map) and
in Australia, NZ & South Pacific on the Fiji and Tonga itineraries; both regions
already exist and `port-region.mjs` already files French Polynesia correctly.

**What is in this commit and what arrives on its own.** The curation ships here —
the operator's short name, logo domain, colour and blurb in both copies of
`atlas-meta.json`, the ship in both copies of `ships.json`, and `gauguin` in
`normalizedCruiseOperator` so the guide resolves "the Gauguin" to the line. The
sailings themselves arrive with the next `virtuoso-sync` run (09:00 UTC), which
commits them like any other refresh; nothing here fabricates inventory.

**The first sync landed 2026-08-29 (`1025f40`): 84 sailings, 2026-09-05 through
2028-12-27, all 84 carrying a day-by-day route.** 79 file under Hawaii & Tahiti,
which was the thinnest real region on the map at 38; the other five are the 2027
repositioning season — Fiji/Tonga/Cook Islands, the Fiji–Bali and Australia–Fiji
crossings, and one Singapore–Darwin run that the overlay correctly files under
Asia & Mekong. The operator string is `Paul Gauguin Cruises`, matching the
atlas-meta key exactly, so the rail renders it.

The hull's spelling was the open question, and the feed answered it: **`m/s Paul
Gauguin`, not `Paul Gauguin`.** `ships.json` joins on the exact string, so the
entry was corrected in both copies — with the plain name it parsed as one
unmatched catalog ship and the enrichment (guests, ice class) silently never
reached the ship rail. `expandedCatalogShipNames` splits on ` / ` with spaces,
so the `m/s` prefix does not accidentally split into two ships.

**The operator rail now counts what loaded.** It had been reading
`OPERATORS[].count` from `atlas-meta`, which is a snapshot of whichever import
last wrote that file and had drifted badly — 3,542 against 3,662 rows in total,
Quark 109 against 168, Aqua 516 against 377 — and that number is the only figure
a traveller sees beside a line's name. `public/maps/cruise/index.html` now takes
both the count and the sort order from `byOperator`, and skips operators the
feed carries nothing for, which is what keeps Paul Gauguin out of the rail as a
"0 sailings" row for the one night between this commit and its first sync.

## The nights either side — hotel cross-references for the other five (2026-08-30)

`build-safari-camps.mjs` made the case for the safari atlas by joining it to the
hotel atlas: a safari's itinerary stops are places we also sell, so the journey's
own file can name the camps on it. The same file said why the other collections
could not have that — "the jet, rail, yacht and cruise atlases draw routes whose
stops are cities, not beds."

True of the middle of those journeys. **False at both ends.** A world cruise
leaves from Venice and a private jet expedition leaves from Seattle, and nobody
flies in on the morning of embarkation: there is a night before, usually two, and
a night after at the other end. Those nights are the one part of a voyage we can
book outright — from the same 2,240 vetted hotels, with the same year-stamped VIP
perks — and until now the atlas that plots the voyage and the atlas that plots
the hotel had nothing to say to each other.

### What ships

- **`scripts/build-gateway-hotels.mjs`** → `public/maps/{jet,train,yacht,worldcruise,cruise}/gateways.json`.
  For every journey, the hotels within **40km** of its first plotted stop and of
  its last. Wider than the camps' 25km on purpose: that radius measured a lodge
  against the reserve it sits inside, this one measures a hotel against a city,
  and the traveller arriving for a departure is arriving by air — Venice's berth
  to Marco Polo is 13km, Athens to Piraeus 11km. Coverage: jet 122/124, rail
  121/126, yacht 464/465, world cruise 300/306, expedition cruise 3,643/4,311
  (the shortfall is not a routing gap — all 668 carry a route; it is 49 gateways
  with no vetted hotel within 40km, and the list reads like the expedition
  business itself: Puerto Baquerizo Moreno, Sitka, Juneau, Longyearbyen, Sorong,
  Tromsø, Broome, Puerto Williams. That is a hole in the hotel atlas, not in
  this join, and the file now names it.)
- **Gateways are stored once and shared.** 4,311 expedition sailings leave from
  113 places; storing Ushuaia's hotels per sailing instead of per place is the
  difference between a 440KB file and a multi-megabyte one. Shared by NAME, and
  re-checked by coordinate at 15km, because bare city names are not unique —
  Victoria is in British Columbia and in the Seychelles, and a gateway that
  pooled the two would offer a Canadian hotel for an Indian Ocean departure.
- **Brand affinity, which is the point on four of the five.** Four Seasons
  Yachts and the Four Seasons Private Jet, Aman at Sea and the Aman Jet
  Expeditions, the Ritz-Carlton Yacht Collection, Belmond's trains, both Orient
  Express products: these are hotel houses that went to sea or into the air, and
  the night before belongs to the house. Aman Venice is 400m from the berth an
  Aman at Sea voyage sails from. So each gateway carries the nearest four hotels
  **plus the nearest hotel of every house the collection sells**, and the read
  side puts the journey's own house first — an FS jet gets the Four Seasons even
  where it is the ninth-nearest hotel in the city. 464 yacht journeys, 52 rail
  and 22 jet journeys are house-matched.
  - Matched on the journey's brand, title AND vessel, because the house is not
    the operator: the Four Seasons jet expeditions are run by TCS World Travel
    and say so in the feed's `b`, with the house in the title.
  - **Explora is the deliberate non-match.** `Explora Journeys` is MSC's cruise
    line; `Explora Atacama` is a Chilean lodge group. Same word, unrelated
    companies. An affinity that is only a shared word is worse than none.
- **`lib/atlas/gateway-hotels.ts`** — the read side, sibling of `safari-camps.ts`
  and carrying the same kind of note about what the data does and does not
  license the UI to say. The camps are ON the itinerary; these are the nights
  either side of it, so the UI may say "where to stay before" and may NOT say
  the night is included — some fares do include one and no feed names which.
- **`JourneyDossier`** grows a stays block under the itinerary, in the dossier's
  own gold rather than safari's jacaranda (five collections share it and none of
  them is safari). One heading for a round trip — "Where to Stay Before & After
  — Venice, Italy" — two when the ends differ. Rows link into the hotel atlas
  with `?hotel=`, which highlights without hiding the neighbours, plus a
  `?city=` link to the rest.
- **The house flag says "Same house", not the house's name.** The name is
  already the first two words of nearly every row it lands on: "Four Seasons ·
  Four Seasons Hotel Bangkok" says the same thing twice and says nothing about
  the relation, which is the news.

### The gate

`npm run verify:gateway-hotels` runs the byte-comparison (`--check`, as the camps
do) and then `scripts/verify-gateway-hotels.mjs`, which imports the **real
adapters and the real `indexGateways()`** and asserts six things. Every one is a
mistake this repo has shipped before:

1. Structure — no journey points at a missing gateway, no gateway at a missing
   hotel, no orphan hotels.
2. **Geometry, recomputed** from the two coordinates. The safari routes drew on
   the wrong continent for a release because `ll` is [lat, lng] and the renderer
   reads [lng, lat]; transposing Washington, D.C. now puts it 14,844km from its own hotels and
   the arithmetic notices.
3. **Identity against the adapters.** Each atlas keys its dossier records
   differently — `String(t.id ?? index)` for the journey family, because 27 jet
   trips carry no id — and a key convention that drifts produces a file the UI
   silently never reads. Renaming the keys to `jt_*` turns this red on all 122.
4. **Ends, derived independently** from the adapted offering's own `path`, so a
   first/last mix-up or a route resolved by the wrong key fails.
5. **The affinity, end to end**: where a journey's house has a hotel at its
   gateway, `forTrip()` must return it first. 411 placements checked, and the
   suite fails if that number ever reaches zero — every other assertion is
   conditional, so a table that stopped matching would otherwise pass in silence.
6. Coverage floors, as on the other feeds, against a silent shrink.

Registered in `verify-all.mjs`, in `prebuild` and in `sync:virtuoso` beside
`build:safari-camps`. Verified in a real browser on all five collections before
shipping: the block renders, the rows link, and the Venice sailing offers Orient
Express Venezia and the Palazzo Dona Giovannelli above Aman Venice.

### Deliberately not done

The Guide and the answer pages do not read these files. `lib/guide-prompt.js`
and `lib/seo/journeys.js` learned about the safari camps in a separate pass, and
the same work here — "what would we book you the night before" as a prompt
pillar and as a line on a journey's entity page — is its own change with its own
verification. The data and the atlas ship first.


## The ISR writes were paying for nothing (2026-09-02)

Five days after the entity pages shipped, the Vercel team hit **100% of the free
tier's 200,000 monthly ISR writes** (218K), with every other meter comfortable —
Edge Requests 391K/1M, ISR Reads 155K/1M, Fast Data Transfer 4.66GB/100GB. A
free team that exceeds an included limit has its projects **paused**, so the
meter that was about to take the site down was the one nobody was watching.

### Where the writes came from

Not the nightly sync's crawl, and not the Guide. The three entity detail routes
carried `revalidate = 86400` with `dynamicParams = true`:

| Route | Pages | Prebuilt |
| --- | ---: | ---: |
| `/hotels/<country>/<property>` | 2,240 | 400 |
| `/journeys/<collection>/<slug>` | 1,991 | 240 |
| `/atlas/villa/<destination>/<slug>` | 3,902 | 114 |
| | **8,133** | **754** |

An ISR write is billed every time one of those pages is written to the cache —
at build for the prebuilt slice, and on every on-demand generation for the other
7,379. So **one sweep of the tree is 8,133 writes**, and the free tier's entire
month is 24 sweeps. The sitemap went from 147 URLs to 8,354 on 28–29 August;
the crawlers that took it up (robots.txt welcomes fourteen AI crawlers by name,
on purpose) are what sweeps it. The Fast Data Transfer curve in the same window
is the same crawl seen from the other side.

Two multipliers on top of that. A new production deployment starts a fresh ISR
cache, so every deploy re-arms all 8,133 pages — and the Vercel API lists 13
production deploys in the four days from 29 August, because the nightly sync
commits **every night by design** (the heartbeat in `virtuoso-sync-status.json` always dirties the tree,
which is the point — see the workflow's own comment). And within a deployment,
the 86400 expiry re-rendered every page that was still being crawled a day
later, whether or not anything had changed.

### Why the expiry was never buying anything

These pages render from JSON **committed to the repository**. Nothing they read
can change between deployments — the only thing that changes it is the nightly
sync's commit, and that commit is itself a deploy. A 24-hour expiry re-rendered
identical bytes from an identical file, forever, and paid a billed write each
time.

So all three routes are now `revalidate = false`: generated once, held for the
life of the deployment. The data is exactly as fresh as it was before — it was
never the expiry that refreshed it — at **one write per page per deploy** rather
than one per page per day per deploy.

### Then the routes stopped being ISR at all

`revalidate = false` stopped the daily re-render; it did not stop the writes,
because 754 of 8,133 pages were still generated by a function on a crawler's
first request, and a deployment re-arms all of them. There was never a reason
for that split. It was pricing a render that has no price: the page is the same
bytes on every request until the next deploy, so "on demand" bought nothing and
cost a billed write per page per deployment.

So `generateStaticParams` now returns the whole tree on all three routes, with
`dynamicParams = false` beside it. A property, an itinerary and a villa are
static assets on the CDN. **Nothing on this site is an ISR route any more** —
the build's route legend no longer prints an ISR line at all.

Measured locally on the current feeds, `npm run build` end to end, including the
whole prebuild data chain:

    ✓ Generating static pages (8559/8559)
    TOTAL_SECONDS=286

Under five minutes against a 45-minute Vercel build ceiling, so the build-time
worry the old note recorded was never worth the writes it was avoiding. The
route counts are 3,902 villas, 2,237 properties, 2,185 itineraries, and the
hubs and answers above them.

Two things were checked against the build output rather than assumed, because
`dynamicParams = false` turns a page that would have been rendered into a 404:

- Every one of the 4,633 URLs in the generated `sitemap.xml` has a prerendered
  page. The parameter functions and the sitemap entry functions now read the
  same source — `allHotelParams`/`allHotels`, `journeyDetailParams`/
  `journeySitemapEntries` — so this is structural rather than lucky, but it is
  cheap to re-check by reading `.next/server/app/sitemap.xml.body` against
  `.next/prerender-manifest.json`.
- The villa detail pages are deliberately NOT in the sitemap (noindex, follow),
  and all 3,902 are built anyway. They are linked from the hubs and from The
  Guide's answers, and a crawler that follows one must not meet a 404.

### Still open here

- **A deploy per night rebuilds everything.** On a night when the supplier
  changed nothing, the only diff is the heartbeat, and the build that follows it
  republishes 8,559 identical pages. That is now build minutes rather than
  billed writes, which is a much cheaper unit, but it is still work for nothing.
  A Vercel Ignored Build Step that skips the build when the heartbeat is the
  sole change would remove those; the heartbeat still has to land on `main`
  either way, because `verify-virtuoso-freshness.mjs` judges the data on it —
  so this is a build-skip question, not a commit question.
- **Preview deploys build the whole tree too.** Every push to a `claude/*`
  branch prerenders all 8,559 pages. Of the 20 deploys the API returns for
  29 August – 2 September, 7 are previews.
- **The build is now the only place a bad slug shows up.** A page that used to
  be generated on request and 404 through `notFound()` is now a page that does
  not exist. `notFound()` stays in all three, as the guard for a param pair the
  feed carried at build and the lookup cannot resolve.

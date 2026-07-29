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

## Atlas unification — Deliverable 3 IN PROGRESS (started 2026-07-29)

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

**First-review fixes (2026-07-29): no routes drawn, globe too small.**

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
- Pricing rule: `rate_from_usd: 0` (211 records) renders the supplier's
  `price_string` ("Call for Pricing"), never $0. Some records carry
  "Call for Pricing" as price_string with a positive rate; the display price is
  always formatted from `rate_from_usd`.
- Geo: `geo.precision === "villa"` (3,666) renders as solid pins; centroid/locality
  precision renders smaller and hollow, and clustering keeps stacked centroids readable.
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
   and `/atlas/villa` (map pins + pagination + no $0 anywhere).
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

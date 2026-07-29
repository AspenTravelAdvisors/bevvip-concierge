# Work Order — Atlas unification (one browse map, three engines → two, on purpose)

**Goal:** Collapse the six iframed Leaflet atlases into the Mapbox globe so browsing
any collection is one consistent surface — while **keeping** Google Photorealistic
3D for the hotel property view, where it is irreplaceable. Along the way, move sea
routing from per-visitor runtime A* to a build-time precompute.

**Owner:** Cowork / Claude Code. Each phase is independently runnable in a fresh
session — read "Standing context" first, then the phase you're on.
**Repo:** `bevvip-concierge/next-concierge`
**Created:** 2026-07-27
**Prerequisite:** the UX pass in `UX-AUDIT.md` / `STATE.md` is merged and deployed.

---

## Standing context — read before any phase

### The engines, and which survive

| Engine | Used by | Fate |
| --- | --- | --- |
| **Mapbox GL** | home globe (`components/AtlasShell.tsx`), villas (`components/VillaAtlas.tsx`) | **survives** — becomes the single browse surface |
| **Google Maps `maps3d`** | hotels (`public/maps/hotel/index.html`) | **survives, repositioned** — becomes the property detail view |
| **Leaflet** | cruise, jet, train, worldcruise, yacht (`public/maps/<t>/index.html`) | **retired** in Phase 3 |

### ⛔ Three things that will look like cleanup and are not

1. **Do NOT delete the Google Maps integration, `GOOGLE_MAPS_API_KEY`,
   `app/api/hotel/config/route.ts`, or the `/maps/hotel/api/*` rewrite in
   `next.config.ts`.** The hotel atlas runs
   `google.maps.importLibrary("maps3d")` → `Map3DElement { mode: MapMode.HYBRID }`
   — Google **Photorealistic 3D Tiles**, i.e. real photogrammetry mesh of the
   actual buildings. Mapbox has no equivalent (its "3D buildings" are extruded
   footprints — a grey block where the hotel is). For a luxury travel product
   this is the single most persuasive thing the app does. It stays.
2. **Do NOT hand-swap coordinate pairs.** Six data sources disagree about order
   (table below). Phase 0 exists to make the order impossible to get wrong; after
   it lands, every conversion goes through `lib/atlas/geo.ts`.
3. **Do NOT just flip `ROUTES_ENABLED = true`** in `AtlasShell.tsx` and ship it.
   The globe has no land avoidance and no antimeridian unwrapping, so you get
   straight lines through Spain and voyages that cross the Pacific the long way
   round the world. Phase 1 is the prerequisite.

### The coordinate zoo

| Source | Field | Order |
| --- | --- | --- |
| `data/atlas/hotel/luxury-hotels.json` | `{lat, lng}` | named |
| `public/maps/hotel/hotel-points.json` | GeoJSON `coordinates` | `[lng, lat]` |
| `data/villas-of-distinction.json` | `geo.{lat, lon}` | named — note `lon`, not `lng` |
| jet / train `ROUTES[*][].ll` | `ll` | `[lat, lng]` |
| jet / yacht / worldcruise `REGIONS[*].coord` | `coord` | `[lat, lng]` |
| yacht / worldcruise `PORTS[name]` | pair | `[lat, lng]` |
| `AtlasShell.PIN_NUDGE`, `REGION_FALLBACK` | pair | `[lng, lat]` |

`AtlasShell` already converts these correctly in ~4 places (`regionsToFC` does
`lng: r.coord[1], lat: r.coord[0]`; `fetchRouteLines` does `[s.ll[1], s.ll[0]]`).
The conversions are right; the convention lives only in comments, which is the
problem Phase 0 fixes.

### Dual-copy discipline

Datasets exist twice: `data/atlas/<type>/…` (canonical) and `public/maps/<type>/…`
(web-served). Only files under `public/` are served. Any regeneration must write
both and they must stay byte-identical (`diff -q`).

### Verifying your work

- `npm run check` — fast tsc over the UI layer (~20s). Use constantly.
- `npm run build` — full build. **Slow (many minutes)**: `resolveJsonModule` +
  `allowJs` makes tsc infer literal types for `villas-of-distinction.json` (7.3 MB)
  and `itinerary-fit.json` (7.1 MB). Run before deploying, not on every edit.
- `git push` is blocked in this environment; the user pushes via GitHub Desktop →
  Vercel auto-deploy.
- Instrumentation exists in `lib/analytics.ts`. Add map events there, not inline.

### Routes that must keep working

`app/sitemap.js` publishes all seven `/atlas/<type>` URLs at priority 0.8, plus
featured villa details. `app/answers/*` links into three of them by name. These
URLs must survive every phase — after unification `/atlas/hotel` renders the one
map filtered to hotels, but the route, its `generateMetadata`, and its deep-link
params (`?region=`, `?ids=`, `?brand=`, `?month=`…) all still resolve.

---

## Deliverable 0 — `lib/atlas/geo.ts`, the coordinate seam

**Pure refactor. No visual change. Do this before anything else.**

Create `lib/atlas/geo.ts`:

```ts
/** A [longitude, latitude] pair. Only this module can mint one. */
export type LngLat = readonly [number, number] & { readonly __lngLat: unique symbol };

export function fromLatLngPair(ll: readonly [number, number]): LngLat;   // jet/train .ll, REGIONS.coord, PORTS
export function fromLngLatPair(xy: readonly [number, number]): LngLat;   // GeoJSON, PIN_NUDGE, REGION_FALLBACK
export function fromNamed(p: { lat: number; lng?: number; lon?: number }): LngLat; // hotels, villas
export function isFinitePair(v: unknown): v is readonly [number, number];
/** Unwrap so consecutive points never jump >180° — see Deliverable 1. */
export function unrollLine(pts: readonly LngLat[]): LngLat[];
```

The branded type is the point: a bare `[number, number]` can no longer be passed
where a `LngLat` is expected, so the order becomes un-mixable rather than
merely documented. Every parser is named for the shape it accepts.

Then migrate the existing call sites in `components/AtlasShell.tsx`:
`regionsToFC`, `pointForResult`, `fetchRouteLines`, `PIN_NUDGE` / `REGION_FALLBACK`
consumers — and `components/VillaAtlas.tsx` where it reads `geo.lat` / `geo.lon`.

**Done when:** `npm run check` clean; the home globe renders identically (pins in
the same places — compare against a screenshot taken before the change); no
remaining raw `[1]`/`[0]` index-swapping outside `geo.ts`.

---

## Deliverable 1 — sea routes, precomputed

### What exists today (do not rewrite from scratch — port it)

`public/maps/worldcruise/index.html` contains ~11 KB of purpose-built sea routing,
duplicated in `cruise` and `yacht`. Read it before touching anything. It is good.

- **`data/landmask.bin`** — bit-packed land grid, `W=3600 × H=1700`, `RES=10`
  (0.1°/cell), `LAT_MAX=85`. Exactly `3600 × 1700 ÷ 8 = 765,000` bytes.
  Identical file in all three atlases (`md5 dfd335a1c8ff36341718bfc6397e0440`) —
  **de-duplicate to one copy** as part of this work.
- **`buildOcean()`** — flood-fill from six open-ocean seeds, so a leg can never
  start or end in a landlocked lake or a closed bay that happens to be wet.
- **`aStarSea()`** — A* over ocean cells: cosine-latitude cost correction so
  distances stay honest near the poles; a **1.6× penalty on cells adjacent to
  land** so ships sit ~1 cell offshore instead of scraping the coast; progressively
  widening search boxes (pad 45 → 140 → 280 → 440) for round-the-continent
  detours; a 1.4M-cell budget guard.
- **`rdp()` + `chaikin()`** — Douglas–Peucker simplification then corner-cutting.
  This is what turns the A* staircase into something that reads as a shipping lane.
- **`arcPts()`** — quadratic bezier for legs that don't hit land (an arc reads as
  a voyage; a straight line reads as a ruler).
- **`unroll()`** — antimeridian unwrapping.
- **`legGeometry()`** — the orchestrator + `_legCache` memoization.

Leaflet-specific and **not** to be ported: `reanchorRoutes` / `bump` /
`setLatLngs` (Leaflet world-copy panning — Mapbox handles this itself).

### 1a. Extract to a shared module

Create `lib/atlas/sea-router.mjs` — plain ESM, no DOM, no Leaflet, runnable in
Node. Move the functions above verbatim where possible; change only what's needed
to accept an injected mask buffer and to emit `[lng, lat]`.

**Before changing any rendering, prove equivalence.** Write
`scripts/verify-sea-routes.mjs` that runs the extracted router over a fixed set of
known-tricky legs and prints the geometry:

- Lisbon → Barcelona (must go around Gibraltar, not across Iberia)
- Miami → Los Angeles (must go around, or through, not across Central America)
- Tokyo → Napa (antimeridian; must cross the Pacific, not circle the globe)
- Alexandria → Barcelona (open Mediterranean — should be a clean arc)
- Ushuaia → Antarctic Peninsula (Drake Passage)
- Any leg touching > 60°N (cosine correction sanity)

Compare visually against the live Leaflet atlases before proceeding.

### 1b. Precompute at build time

Today every visitor downloads 765 KB of landmask and runs A* in the main thread.
On a unified globe you may be asked for 3,542 cruise sailings + 250 world cruises
+ 374 yacht voyages at once — that will not hold up interactively.

Write `scripts/build-sea-routes.mjs`, following the existing
`scripts/build-hotel-points.mjs` pattern, and add it to `prebuild` in
`package.json` alongside `build:hotel-points`. It should:

1. Read `PORTS` + `TRIPS` from yacht and worldcruise, and
   `public/maps/cruise/data/itinerary-routes.json` for expedition sailings.
2. Route every leg once, de-duplicating identical legs across trips (the existing
   `_legCache` key — `a.lat,a.lng|b.lat,b.lng` rounded to 2dp — is the right key;
   many voyages share legs).
3. Apply `unrollLine()` from `lib/atlas/geo.ts`.
4. Emit `public/maps/shared/sea-routes.json` as a GeoJSON FeatureCollection of
   LineStrings, `properties: { type, tripIds: [...] }`.
5. Print a coverage report: legs routed, legs that fell back to an arc, legs that
   failed entirely (list them).

The landmask then never reaches the browser. Keep one canonical copy at
`data/atlas/shared/landmask.bin` for the build script; delete the three served
copies once nothing fetches them.

### 1c. Render on the globe

In `AtlasShell.tsx`: replace `fetchRouteLines()`'s per-atlas parsing with a fetch
of `sea-routes.json`, keep `paintRoutesForKey()`, and set `ROUTES_ENABLED = true`.
Jet and rail keep runtime `arcPts` geometry (they are not sea routes and are cheap
— but they still need `unrollLine`).

**Done when:** routes render on the globe with no leg crossing land; no voyage
takes the long way around the antimeridian; `sea-routes.json` is committed and
regenerable; no landmask is fetched by any browser; the `ROUTE_ZOOM = 5.5` gate
still keeps the globe readable when zoomed out.

---

## Deliverable 2 — hotels: browse on Mapbox, inspect in Google 3D

The split follows the hotel atlas's own camera logic: `DETAIL_TILT = 67°` engages
at `DETAIL_RANGE = 2600 m` and eases to flat by 220 km. **Photorealistic 3D is
worthless at globe zoom and unbeatable at property zoom.** So give each engine the
job it is good at.

1. **Browse** stays on the Mapbox globe, which already plots all 2,501 hotels from
   `public/maps/hotel/hotel-points.json`.
2. **Inspect** becomes a deliberate destination: a "See it in 3D" action on the
   hotel result card (`components/ResultCards.tsx`) and on the globe's hotel
   popup, opening the Google `Map3DElement` view focused on that property.
3. Reduce `public/maps/hotel/index.html` to that focused role: arriving with
   `?ids=h_00001` (or a new `?hotel=` param) should fly straight to the property
   at detail range and tilt, with the browse chrome (filter rails, list) hidden.
   Keep the full browse mode reachable so nothing is lost before Phase 3 lands.
4. Add `hotel_3d_opened` to `lib/analytics.ts` — this is the feature most worth
   knowing the usage of, and it is currently unmeasured.

**Done when:** `/atlas/hotel` opens the unified browse map; a card's "See it in 3D"
lands on the photoreal view of the right building, tilted, on real ground
elevation; the Google key, `/api/hotel/config` and the `next.config` rewrite are
all still in place and working.

---

## Deliverable 3 — retire the five Leaflet atlases

**This is the bulk of the project. The maps are the easy part; the filter UIs are
the work.** Do one collection at a time, in this order (simplest data first):
`train` → `jet` → `yacht` → `worldcruise` → `cruise`.

The five share one data grammar — `BRANDS` / `REGIONS` / `TRIPS` / `PORTS` /
`ROUTES`, coordinates in `[lat, lng]` — so one adapter covers all five.

1. **`lib/atlas/adapters/<type>.ts`** — normalize each atlas's `itinerary.json`
   into a common shape: `{ id, title, brand, operator, region, month, startDate,
   ports: LngLat[], url }`. Use `geo.ts` for every coordinate.
2. **Filters.** Inventory each Leaflet app's filter rail before porting it —
   brand, region, month, operator, port, ship (see
   `WORKORDER-expedition-ship-data.md`, which is changing the cruise ship filter;
   coordinate with it). Build one filter component driven by a descriptor per
   collection rather than five bespoke rails.
3. **Deep links.** Every param the Leaflet app understood must keep working, since
   `app/atlas/[type]/page.tsx` currently forwards all of them and the atlases' own
   Share buttons emit them. Enumerate them per atlas before deleting anything.
4. **Delete** `public/maps/<type>/` and its vendored Leaflet only once the
   replacement handles every param and filter.

**Done when:** all five render on the globe with working filters and deep links;
`/atlas/<type>` URLs unchanged; `AtlasFrame` chrome still wraps them;
`components/AtlasView.tsx` and the iframe path are deleted; no `leaflet.min.js`
remains in the repo.

---

## Deliverable 4 — Explore becomes intent-shaped

Only possible once collections share one map. Today you cannot show hotels and
villas together because they are different applications.

1. In `components/SiteNav.tsx`, group the menu — keeping the seven individual
   collections available beneath:
   - **Places to stay** — hotels + villas (6,403 records)
   - **Voyages** — expedition sailings + world cruises + hotel yachts
   - **Journeys** — rail + private jets
2. Support multi-collection state on the map (`/atlas/stay`, or
   `/atlas?types=hotel,villa` — pick one and put it in the sitemap).
3. **Resolve the duplication:** the legend and Explore will otherwise be two
   controls over the same seven items with different verbs. Make them one state
   rendered twice — Explore navigates when you are off-map, and reflects/focuses
   legend state when you are on it. Do not ship both as independent controls.

**Done when:** "Places to stay" plots hotels and villas together on one map; the
Explore menu and the legend never disagree; new grouped routes are in
`app/sitemap.js`.

---

## Deliverable 5 — independent: normalize result shapes

Not a map task; can be done any time. `UX-AUDIT.md` item 16.

`components/ResultCards.tsx` (`cardDate`, `cardDuration`) reconciles
`dates | startDate | month | nights | days` at render time because each collection
reports timing differently. Move that into `lib/search-offerings.js` so every
result leaves the search layer in one shape.

**Why it was deferred:** 93 KB module, seven datasets, no test coverage. Do it
alone, not folded into other work, and diff the rendered output per collection
before and after — including villas, where `rate_from_usd: 0` must render the
supplier's `price_string` ("Call for Pricing") and never `$0`.

---

## Validation / done criteria (whole work order)

- [ ] D0 — no coordinate order handled outside `lib/atlas/geo.ts`; globe pins
      unchanged vs. pre-refactor screenshot.
- [ ] D1 — `scripts/verify-sea-routes.mjs` output matches the Leaflet atlases on
      all six reference legs; `sea-routes.json` built in `prebuild`; no landmask
      fetched by any browser; no leg crosses land or the antimeridian the long way.
- [ ] D2 — photoreal 3D still reachable per property; Google key + config route +
      rewrite intact; `hotel_3d_opened` firing.
- [ ] D3 — five collections on the globe; every previous deep-link param honored;
      zero Leaflet in the repo.
- [ ] D4 — grouped Explore; legend and nav share one state.
- [ ] D5 — one result shape from the search layer; no `$0` villa anywhere.
- [ ] `npm run check` clean and `npm run build` succeeds after each deliverable.
- [ ] `STATE.md` updated per deliverable; `UX-AUDIT.md` item 9 / 16 status flipped.

## Notes / gotchas

- **The three landmask copies are byte-identical.** De-duplicate; don't
  "improve" one of them.
- **`arcPts` k-factor is 0.16.** That constant is what makes the arcs look like
  voyages rather than wires. Keep it if you re-implement.
- **Mapbox billing consolidates.** Every map load moves onto one meter in Phase 3.
  Check current Google vs. Mapbox spend before assuming this is a saving — you are
  keeping the Google key either way (Deliverable 2).
- **Villas are stays, not routes** — `fetchRouteLines` already returns `[]` for
  them. Keep that.
- **`prebuild` already runs `build:hotel-points`.** Chain, don't replace.

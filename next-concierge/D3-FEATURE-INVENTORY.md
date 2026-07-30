# Deliverable 3 — FEATURE inventory

`D3-FILTER-INVENTORY.md` covers the filters and deep links, and it was written
before any porting, so the filter layer went across with 10.7M parity
comparisons and no surprises.

**Nothing equivalent was written for the features, and it showed.** Rail shipped
missing its real track geometry, its stop markers, its route pinning, its brand
logos and its day-by-day itinerary — each found by the user, one at a time,
after deploy. A parity harness over predicates cannot catch a missing logo.

This file is the checklist that should have existed. Work it per collection
before declaring one done.

Status: ✅ ported · ⚠️ partial · ❌ missing · n/a not in this collection

## Map surface

| Feature | Source | train | notes |
| --- | --- | --- | --- |
| Ambient region pins with counts | `byRegion` + `.rmarker` | ✅ | via AtlasShell overlay |
| Region pin click → filter that region | `openRegion()` | ✅ | `onRegionSelect`; was opening everything |
| Traced route on hover | `drawRoute(trip)` 170ms debounce | ✅ | |
| Click pins the route (`routeLocked`) | `routeLocked` / `pinnedTrip` | ✅ | click again releases |
| Real track geometry | `data/rail-routes.json` | ✅ | 269 legs, 47,070 pts |
| Rail vs road/ferry leg styling | `trackSegment` / `connSegment` | ✅ | mode on each leg |
| Railway symbology + glow | `.rrail` `routeGlow` drop-shadow | ✅ | `fr_glow` + line-blur |
| Numbered stop dots | `.stopdot` divIcon | ✅ | `fs_dot` / `fs_num` |
| Stop hover label "3. Day 4 · Inverness" | `bindTooltip` + `stopDaySummary` | ✅ | |
| Route colours legible on satellite | n/a — Leaflet was dark-only | ✅ | palette switches per basemap |
| Region pins dim while tracing | `body.tracing .rmarker` | ❌ | cosmetic focus aid |
| Active region pin highlight | `markers[k].el.classList.add('route')` | ❌ | |
| Fit padding avoids the open panel | `paddingBottomRight:[420,70]` | ⚠️ | uses generic `fitPad()` |
| Basemap picker | default / dark / satellite | ✅ | AtlasShell's Style menu |
| Zoom control | `L.control.zoom` | ⚠️ | Mapbox default only |
| Data credit line | `DATA_CREDIT` | ❌ | attribution text |

## Cards

| Feature | Source | train | notes |
| --- | --- | --- | --- |
| Brand logo, 3-tier fallback | `logoEl()` | ✅ | local → Google favicon → DDG → initials |
| Coloured initials fallback | `BRANDS[k].color` + glyph | ✅ | |
| Title | `t.n` | ✅ | |
| Date range + "N departures" | `fmtRange` + `depCount` | ✅ | |
| On-demand window "dates on request" | `t.win` | ✅ | |
| Vessel · duration · stop count | `t.train`, `t.days` | ✅ | |
| Route path "A → B → C" | `t.cities` names | ✅ | |
| Day-by-day itinerary | `itineraryHTML` + `itineraryRanges` | ✅ | consecutive days collapse to ranges |
| Round-the-world flag | `.card.world` | ✅ | |
| "Ask The Guide" action | `askGuideBtn()` | ✅ | `/?ask=…&src=train` |
| Card links to supplier listing | `t.u` target=_blank | ✅ | |
| Border tint when brand filtered | inline `--accent` | ✅ | |
| Card highlight while its route draws | `markRoutedCard` `.routed` | ✅ | `data-pinned` |

## Filters / chrome

| Feature | train | notes |
| --- | --- | --- |
| Brand rows WITH logos | ✅ | logos in the rail, not just cards |
| Region chips with counts | ✅ | facet counts in the select |
| Month filter + summary text | ✅ | |
| Location + role filter | ✅ | type-ahead, 205 locations |
| Free-text search | ✅ | ported tokeniser |
| Reset | ✅ | |
| Share button | ⚠️ | browser URL is shareable; no button |
| World-trips view (`world=1`) | ❌ | parsed, no UI entry point |
| Result count | ✅ | in the rail |

## Cross-atlas affordance scan (all five `index.html` element ids)

Done 2026-07-29 by enumerating every `id=` in all five atlases, so the list is
exhaustive rather than remembered. All five share one chrome, so this applies
to every collection.

**Deliberate design changes (approved, not regressions)**

| Original | Replacement | Note |
| --- | --- | --- |
| `panel` / `pTitle` / `pSub` / `pList` — region detail panel | Card grid under the map | The VillaAtlas pattern, chosen deliberately |
| `bvi*` — onboarding tour/carousel | Base Camp's own tour | Already exists app-wide |
| `helpDock` / `helpForm` / `helpOverlay` — enquiry form | `AtlasFrame`'s "Talk to an advisor" | Already exists app-wide |
| `mapMenu*` — basemap picker | `AtlasShell` Style menu | ✅ |
| `shareDock` / `shareToast` | Rail Share button | ✅ now carries the view too |

**Genuinely missing — ranked by how much an advisor would feel it**

1. ~~**Mobile.**~~ ✅ **Done 2026-07-29.** Pill → drawer → "Apply · N", matching
   `railPill` / `railApply` / `applyCount` / `sheetScrim`.

   The commit step is the point, not decoration. On a phone the map is the whole
   screen, so applying a filter per keystroke redraws the map under your thumb
   while you are still deciding, and the count you are aiming for keeps moving.
   The sheet edits a DRAFT; the Apply button carries the draft's count, so it
   says what you will get rather than what you already have.

   Also handled: **tapping a card scrolls the map back into view** — on a phone
   the cards are below the fold, so tracing a route you cannot see reads as
   nothing happening. Desktop shows both at once and deliberately does not jump.
   16px control font in the sheet stops iOS Safari zooming the viewport on
   focus; `env(safe-area-inset-bottom)` keeps the bar off the home indicator;
   results go single-column with bottom padding so the last card is not trapped
   under the fixed bar.
2. **`worldBtn` / `worldCount`** — journeys' round-the-world view. `world=1` is
   parsed and filters correctly; there is no button.
3. **Branded progressive loader** — `atlasVeil` / `loadBar` / `loadFill` /
   `loadMsg` ("Rendering photorealistic 3D terrain…"). Collections currently
   pop in.
4. **`routeBack`** — an explicit way out of a traced route. Clicking the pinned
   card again works but is undiscoverable.
5. **Richer pickers.** `datePop`/`dateGrid` is a month GRID; `locationPop` and
   `portPop` are searchable lists with role buttons; `shipList`/`shipSearch` is
   a searchable ship list; `opList` shows suppliers **with logos**. I have
   single selects and one type-ahead — functionally equivalent, visually much
   plainer, and the supplier list loses its logos.
6. **`dockCoach`**, **`hint`** (cruise), **`quiet-map`** — small coach marks.

## Still open after this pass

- `world=1` has no UI affordance (the param is parsed and honoured).
- No explicit Share button — the URL is the share link, which is arguably
  better, but it is a removed affordance and should be a deliberate call.
- Region-pin dimming/highlight while a route is traced.
- Data credit / attribution line.
- Zoom buttons (Mapbox ships its own; Leaflet's were bottom-left).

## The lesson

Write this table BEFORE porting the next collection, from that atlas's own
`index.html`, and check it off as you go. The filter inventory made the filter
port boring and correct; the absence of a feature inventory made the feature
port a sequence of user-reported regressions.

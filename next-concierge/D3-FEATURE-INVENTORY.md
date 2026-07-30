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

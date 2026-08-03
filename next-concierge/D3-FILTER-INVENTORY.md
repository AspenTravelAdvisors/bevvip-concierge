# Deliverable 3 — filter & deep-link inventory

Compiled 2026-07-29 by reading the five Leaflet atlases directly. The work order
says the maps are the easy part and the filter rails are the work, and that
nothing gets deleted until every param and filter is reproduced. **This file is
the checklist to reproduce.** Nothing here is a guess; every row was read out of
`public/maps/<type>/index.html`.

## Headline: two families, one real outlier

The work order's claim that "one adapter covers all five" is *mostly* right. The
param sets collapse into exactly two families:

| family | atlases | params |
| --- | --- | --- |
| **Journeys** | train, jet | `brand country exRegions hero ids location locationrole month operator q region regions trip world` |
| **Voyages** | yacht, worldcruise, cruise | `brand country hero ids month operator port portrole q region regions ships trip` |

Identical within each family, character for character. The divergence is only
`location`/`locationrole`/`exRegions`/`world` (journeys) vs
`port`/`portrole`/`ships` (voyages).

**But cruise is an outlier inside its own family** — see "Three region models"
and "Three month models" below. A single descriptor still works, but it needs
those three axes parameterised, not assumed.

## Filter predicates, as actually written

### Journeys — train
```
!isPastTrip(t)
&& (!activeBrands.size || activeBrands.has(t.b))
&& (t.onDemand || !activeMonths.size || (t.mks && t.mks.some(k => activeMonths.has(k))))
&& (!activeIds.size  || activeIds.has(String(t.id)) || activeIds.has(t.guideId) || activeIds.has('rj_'+t.id))
&& textMatches(t)
&& tripMatchesLocation(t, activeLocation, activeLocationRole)
&& regionPass(t)   // include AND NOT exclude
```

### Journeys — jet
Identical to train except the month field: `t.mk` (scalar), not `t.mks` (array).

### Voyages — yacht / worldcruise
```
!isPastTrip(t)
&& (!activeBrands.size || activeBrands.has(t.brand))
&& (!activeShips.size  || activeShips.has(t.ship))
&& (!activeMonths.size || activeMonths.has(t.monthKey))
&& (!activeIds.size    || activeIds.has(String(t.id)) || activeIds.has('<prefix>_'+t.id))
&& textMatches(t)
&& (!activePort || tripMatchesPort(t, activePort, activePortRole))
&& regionPass(t)   // include only
```

### Voyages — cruise (the outlier)
```
s.start >= today                                    // ISO date string, not isPastTrip()
&& (!activeOps.size    || activeOps.has(s.operator))  // OPERATOR, not brand
&& (!activeMonths.size || activeMonths.has(s.monthKey))
&& (!activeIds.size    || activeIds.has(String(s.id)) || activeIds.has('cr_'+s.id))
&& (!activePort        || sailingMatchesPort(s, activePort, activePortRole))
&& (!activeShips.size  || activeShips.has(s.ship))
&& textMatches(s)
&& (!activeRegions.size || activeRegions.has(s.region))   // SCALAR region
```

## The three axes that must be parameterised

### 1. Three region models
| atlases | shape | semantics |
| --- | --- | --- |
| train, jet | `t.g` array | include (`regions`) **and exclude** (`exRegions`) |
| yacht, worldcruise | `t.g` array | include only |
| cruise | `s.region` **scalar** | include only |

Region exclusion exists only in the journeys family. `regions=` is a
comma-separated multi-select; `region=` (singular) is a legacy single-region
focus resolved through `findRegionKey()` and promoted into the selected filter
when no valid `regions=` filter arrived.

### 2. Three month models
| atlases | field | shape |
| --- | --- | --- |
| train | `t.mks` | **array** of month keys |
| jet | `t.mk` | scalar |
| yacht, worldcruise, cruise | `t.monthKey` | scalar |

Journeys additionally give `onDemand` trips a free pass on the month filter, so
they sort to the bottom of every selected month. Voyages have no such escape.

### 3. Brand vs operator
train/jet filter on `t.b`; yacht/worldcruise on `t.brand`; **cruise on
`s.operator`** — and cruise's Share button emits `operator=`, not `brand=`,
which is why its `.set` list differs from the rest of its family.

## ID prefixes (the `ids=` param)

Every atlas accepts both the raw id and a prefixed form:

| atlas | prefix |
| --- | --- |
| train | `rj_` |
| jet | `jt_` |
| yacht | `yc_` |
| worldcruise | `wc_` |
| cruise | `cr_` |

train and jet also accept `t.guideId` as a third alias. **All of these must keep
resolving** — they are what the Guide's deep links and the atlases' own Share
buttons emit.

## Params that are not filters

- `hero=1` — ambient mode for the marketing landers. Already handled upstream in
  `app/atlas/[type]/page.tsx`; the replacement must keep honouring it.
- `world=1` — journeys only, calls `openWorld()`. A UI mode, not a filter.
- `trip=` — opens a specific trip's detail panel.
- `country=` — **not a separate filter**: it is folded into the search terms,
  `activeSearchTerms = [...words(q), ...words(country)]`.
- `q=` — free text, tokenised by `words()`, which strips a stop-list including
  domain words ("cruise", "yacht", "voyage", "ship", "luxury", …). Reproduce
  `norm()`/`words()` exactly or search results will silently drift.

## Rail controls

Only the search inputs are static markup (`#locationSearch` on journeys,
`#portSearch` + `#shipSearch` on voyages). Everything else — brand/operator
chips, month chips, region pills with their three-state include/exclude/off —
is built in JS. The three-state region pill (`.reg.active` / `.reg.excluded`)
is the one control with no equivalent anywhere in the Mapbox UI today.

## Suggested build order

Unchanged from the work order — simplest data first — but now with the reason:

1. **train** — array months + region exclusion. Establishes the hardest region
   model early, on the smallest dataset.
2. **jet** — same shape, scalar months. Proves the descriptor parameterises.
3. **yacht** — introduces ships + ports, drops exclusion.
4. **worldcruise** — identical to yacht; should be a config entry, not code.
5. **cruise** — the outlier: operator, scalar region, date-string cutoff.
   Coordinate with `WORKORDER-expedition-ship-data.md`, which is changing the
   ship filter.

## Resolved 2026-07-29 — both former open questions

### The role vocabularies are DIFFERENT. Do not collapse them.

| family | param | accepted values |
| --- | --- | --- |
| train, jet | `locationrole` | `any`, `start`, `end`, `stop`, `visit` |
| yacht, worldcruise | `portrole` | `call`, `disembark`, `embark` |
| cruise | `portrole` | `any`, `call`, `disembark`, `embark` |

They are semantically parallel — start↔embark, end↔disembark, visit/stop↔call —
but the literal strings differ, and cruise carries an `any` branch the other two
voyages lack. A shared descriptor field would have silently broken every
`portrole=`/`locationrole=` deep link. **Keep the vocabulary per family and pass
the string through verbatim.**

### No app code emits `exRegions`, `locationrole` or `portrole`

Zero references across `app/`, `lib/`, `components/`. These are produced *only*
by the Leaflet atlases' own Share buttons, which means:

- Links already shared by travellers (email, bookmarks) may carry them, so the
  replacement must still **parse** them.
- Nothing internal generates them, so there is no link surface to migrate, and
  no obligation to rebuild a UI control for region *exclusion* unless it is
  wanted on its own merits. Parse-and-apply is enough; the three-state pill is
  optional.

`region`, `regions`, `ids`, `month`, `brand`, `operator`, `q`, `country`,
`port`, `ships`, `trip` and `hero` DO have live internal callers and must all
keep working.

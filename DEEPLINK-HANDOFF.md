# Atlas deep-link hand-off (cruise / jet / yacht apps)

## What changed in Base Camp (this repo)
The Living Atlas now builds **selection-aware** deep links. When a traveler clicks a
cruise / jet / yacht region pin, the popup's "Open … Atlas" link is:

```
https://<atlas-app>/?region=<REGION_KEY>
```

`<REGION_KEY>` is the exact key each atlas uses to tag its trips (the `g` array in
`itinerary.json` / `atlas-meta.json`), so it matches that app's own `openRegion(key)`.
Examples: cruise `?region=Antarctica`, jet `?region=ANTARCTICA`, yacht `?region=MED`.

The Hotel Atlas already consumes its query params (`region`, `brand`, `country`,
`program`, `category`, `q`) via its `applyDeepLink()`, so hotel links already
preselect and zoom. No change needed there.

## Status (2026-06): all five atlases consume the deep link
This is now **done** in every atlas repo — the "still needs doing" plan below is
kept only as historical context. Each of the cruise, jet, yacht, and world-cruise
apps already has an `applyDeepLink()` at the end of its inline `<script>` that
reads `region`, `ids`, `operator`/`brand`, `month`, `regions`, and `q` from
`location.search` and reproduces that view. Verified across all four:

- **`?region=`** resolves through each app's `findRegionKey()`, which maps the
  Guide's marquee keys to the app's native keys (e.g. yacht/world-cruise alias
  `mediterranean → MED`, `caribbean → CARIB`, `polynesia → POLY`). An unmatched
  region is harmless: `ids` alone still opens the record via `openSearchResults`.
- **`?ids=`** filters to the exact record(s). The apps store bare ids
  (`18492135`) while the `/api/*` feeds (and Base Camp) prefix them
  (`cr_`/`jt_`/`yc_`/`wc_`), so each app's filter checks **both** forms
  (`activeIds.has(String(s.id)) || activeIds.has('cr_'+s.id)`). A single-result
  card therefore opens that sailing's own card in the panel — the detail view.

So Base Camp's per-result `deepLink` of `<base>/?region=<region>&ids=<id>`
(hotel uses `<base>/?ids=<id>`) already lands on the specific record with its
card open. No further atlas change is required for the hand-off.

---

### Historical: the original "what still needs doing" plan
The **cruise, jet, and yacht apps do not read URL params at all** today — that is
why "Open Atlas" currently just lands on the main view. Each app already has the
right entry point: a function `openRegion(key)` (the same call fired when a user
clicks a region), plus a `REGIONS` lookup. They just need to honor `?region=`.

Paste this at the **very end of the existing inline `<script>` block** in each app
(it must be inside that block so it closes over `openRegion` / `REGIONS`):

```js
/* --- Base Camp deep-link consumer: ?region=KEY preselects + zooms --- */
(function () {
  function applyRegionParam() {
    try {
      var key = new URLSearchParams(location.search).get('region');
      if (!key) return;
      if (typeof openRegion !== 'function') return;
      // skip unknown keys when a REGIONS map is in scope
      if (typeof REGIONS === 'object' && REGIONS && !REGIONS[key]) return;
      openRegion(key);           // same action as clicking the region: selects + zooms
    } catch (e) { /* never block first paint */ }
  }
  if (document.readyState === 'complete') setTimeout(applyRegionParam, 350);
  else window.addEventListener('load', function () { setTimeout(applyRegionParam, 350); });
})();
```

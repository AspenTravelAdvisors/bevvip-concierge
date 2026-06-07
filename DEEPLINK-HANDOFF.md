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

## What still needs doing (the three other repos)
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

Notes:
- The 350 ms delay lets the Leaflet map and trip data finish initializing before
  `openRegion` runs. If an app finishes later, raise it or call `applyRegionParam`
  from that app's own init-complete hook instead.
- If `openRegion` selects the panel but does not move the map in some app, add a
  `map.flyTo` / `map.fitBounds` for that region inside `openRegion` (or right after
  the call) so the view zooms to fit.

## Chat-result links (cruise / jet / yacht)
In-chat result cards for these three types still open the app's main view, because
the Guide passes a marquee region key (e.g. `antarctica`) that does not 1:1 map to
each app's own region keys. To make chat results preselect too, add a marquee→app
key mapping in `lib/search-offerings.js` (build it per type from each app's
`REGIONS`) and set `deepLink` to `<base>/?region=<mappedKey>`. The Living-Atlas
pin path needs none of this, since those pins already carry the app's native key.

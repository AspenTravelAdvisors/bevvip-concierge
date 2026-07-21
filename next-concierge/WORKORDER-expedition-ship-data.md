# Work Order — Add per-sailing ship data to the Expedition Cruise Atlas

**Goal:** Give every expedition sailing a real `ship` value so the Expedition Atlas
filters by individual ship exactly like the Yacht and World Cruise atlases do
(true per-sailing filter), instead of the current "fleet browser" workaround.

**Owner:** Codex (data mining) → then Claude/human wires the atlas swap.
**Repo:** `bevvip-concierge/next-concierge`
**Created:** 2026-07-21

---

## Background / why

- Yacht (`public/maps/yacht/itinerary.json`) and World Cruise
  (`public/maps/worldcruise/itinerary.json`) carry a `ship` field on every trip,
  so their atlases do a true per-sailing ship filter.
- The Expedition atlas source (`public/maps/cruise/sailings.json`) has **no ship
  field** — columnar schema is `[id, operator, name, start, nights, region, slug, product]`,
  3,542 rows. Because of that, the atlas currently ships a *fleet browser* that
  infers operator + cruising region from `ships.json` (a 29-entry reference
  catalog, some entries grouped sisterships). That is a stopgap, not a real filter.
- Virtuoso DOES expose the operating ship per sailing (Codex has already
  harvested data this way). This work order captures that ship per sailing and
  bakes it into the dataset.

## Source of truth for the sailing list

Each sailing's Virtuoso page is reconstructable from the columnar file:

- `urlBase`      = `https://www.virtuoso.com/advisor/brianharris/cruises/sailings/`
- sailing URL    = `urlBase + id + "/" + slug`
  e.g. id `18256875`, slug `papeete-tahiti-to-lautoka-01apr2027-14apr2027`
  → `https://www.virtuoso.com/advisor/brianharris/cruises/sailings/18256875/papeete-tahiti-to-lautoka-01apr2027-14apr2027`
- `productBase`  = `https://www.virtuoso.com/advisor/brianharris/cruises/`
  productUrl (when `product` present) = `productBase + product`

Note: these pages require the authenticated advisor session — use the same
access path Codex already used to harvest the other atlases.

## Deliverable 1 — harvest `id → ship`

Produce a mapping of **every** sailing `id` (all 3,542) to the exact ship name
Virtuoso lists for that departure.

Rules:
1. **Key on `id`** (stable), not slug.
2. Capture the **individual hull** name as Virtuoso spells it (e.g.
   `Le Bellot`, `Silver Endeavour`, `National Geographic Endurance`,
   `World Navigator`). Do NOT collapse sisterships into a class label — that's
   what the catalog does and it's exactly what we're replacing.
3. Preserve punctuation/accents/® exactly as the source spells them (downstream
   join relies on exact strings, same convention as the other atlases).
4. Emit a coverage report: total ids, ids resolved, ids unresolved (list them
   with their operator + URL). Aim for 100%; flag any sailing where Virtuoso
   shows "varies"/TBD so we can decide how to label it.
5. Deliver as `scripts/cache/expedition-ship-map.json`:
   `{ "compiled": "YYYY-MM-DD", "source": "virtuoso-advisor", "map": { "<id>": "<ship>", ... }, "unresolved": ["<id>", ...] }`

## Deliverable 2 — bake `ship` into the dataset (add a build script)

Write `scripts/build-expedition-ships.mjs` that:

1. Reads `public/maps/cruise/sailings.json` and the ship map from Deliverable 1.
2. Adds `"ship"` to the columnar `schema` array (append after `product`).
3. Appends the ship string to each row array (empty string `""` if unresolved).
4. Writes the result to BOTH copies (they must stay identical):
   - `public/maps/cruise/sailings.json`   (served — the atlas fetches this)
   - `data/atlas/cruise/sailings.json`     (canonical)
   Re-run must be idempotent (detect if `ship` column already present and update
   in place rather than double-appending).
5. Prints before/after distinct-ship counts per operator for a sanity check.

Reference operator roster (future-sailing counts, for validating coverage):

```
1194  National Geographic-Lindblad Expeditions
 588  PONANT EXPLORATIONS
 516  Aqua Expeditions
 322  HX Expeditions
 286  Seabourn
 177  Silversea
 129  Atlas Ocean Voyages
 120  Swan Hellenic
 109  Quark Expeditions
 101  Aurora Expeditions
```

Cross-check harvested ship names against the individual hulls implied by
`data/atlas/cruise/ships.json` (expand its grouped entries: "Ponant Explorers
class (Le Bellot, Le Jacques-Cartier + 4 sisters)", "Sisterships Le Boréal /
L'Austral / Le Soléal / Le Lyrial", "World Navigator / World Traveller / World
Voyager / World Seeker", "Aria Amazon / Aqua Nera"). Any harvested ship not
attributable to its operator's known fleet = flag for review (likely a parse
error or a newly added hull).

## Deliverable 3 — loader passes `ship` through

In `public/maps/cruise/loader.js`, `rowToSailing()` destructures the row:

```js
const [id, operator, name, start, nights, rawRegion, slug, product] = row;
```

Add `, ship` to the destructure and include `ship` on the returned sailing
object (alongside `url`, `productUrl`, etc.). Guard for the columnar index by
reading from the row using the schema order, not a hardcoded position, if you
want to be safe against future column shuffles.

## Deliverable 4 — swap the atlas to a true per-sailing filter

Once every sailing has a `ship`, replace the fleet-browser logic in
`public/maps/cruise/index.html` with the same per-sailing filter the Yacht /
World Cruise atlases use (they are the reference implementation — mirror them):

- Build the Ship section rows from **distinct `ship` values present in the
  sailings** (with real departure counts), not from `ships.json`.
- `shipPass(s)` becomes `!activeShips.size || activeShips.has(s.ship)` inside
  `matches()` — drop `SHIP_REGION_ALIAS`, `SHIP_BY_NAME`, `regionKeyByName`,
  `buildShipSection`'s operator/region inference, and the `fetch('ships.json')`.
- KEEP `ships.json` purely as **enrichment** (ice class / guests / zodiacs /
  subs / notes shown on the row and/or in the sailing card) by joining on the
  exact ship name. Ships not in the catalog simply show no extra specs.
- Remove the "itineraries rotate across the fleet" hint line — no longer true.
- Preserve the existing `?ships=` deep-link + `__atlasShareUrl` param and the
  >12-ships search box (there will be ~30+ distinct hulls, so the search box
  stays useful).

Yacht/World Cruise reference anchors to copy the pattern from:
`activeShips` state → `matchesNonRegion` predicate → ship-list builder →
`toggleShipFilter` → `syncReset` → both reset paths → `applyDeepLink` (`ships=`)
→ `__atlasShareUrl`.

## Validation / done criteria

- [ ] 100% (or explicitly-listed exceptions) of 3,542 sailings have a ship.
- [ ] `public/maps/cruise/sailings.json` and `data/atlas/cruise/sailings.json`
      are byte-identical after the build (`diff -q` passes).
- [ ] Distinct ships per operator look sane vs. the known fleet (no class-label
      blobs, no cross-operator leakage).
- [ ] Atlas loads with no console errors; Ship section lists individual hulls
      with correct departure counts; selecting a ship shows only that ship's
      sailings; `?ships=<name>` deep-link + share URL round-trip.
- [ ] Answer-page counts in `data/answers/expedition.js` re-checked if any were
      derived per-ship (bump its `updated` if they change).

## Notes / gotchas

- **Dual-copy discipline:** any regen of `ships.json` OR `sailings.json` must
  update both the `data/atlas/cruise/` canonical and the `public/maps/cruise/`
  served copy. Only files under `public/` are web-served.
- Keep the columnar format (arrays keyed by `schema`, prefixes hoisted to
  `urlBase`/`productBase`) — it keeps the file ~0.8 MB raw / ~120 KB gzipped.
- `git push` is blocked in this environment (no GitHub cred); the user pushes
  via GitHub Desktop → Vercel auto-deploy. Leaflet renders in the preview
  sandbox, so the atlas can be verified locally before deploy.

# Work Order — Villas onto the shared browse surface (the seventh atlas)

**Goal:** Make `/atlas/villa` behave like the six collections that came off Leaflet —
same selection grammar, same map-follows-the-card interplay, same rail, same phone
chrome — instead of being the one atlas with its own everything.

**Verdict:** Feasible, and the path is the one the other five already walked (adapter +
descriptor + build-time feed). It is **not** a flag flip: villas are the only atlas
whose data never reaches the browser, and three of their filters have no control in
the shared rail. Budget it as a project, and take the behaviour parity first — most of
what reads as "inconsistent" is one missing gesture, not the architecture.

**Owner:** Cowork / Claude Code.
**Repo:** `bevvip-concierge/next-concierge`
**Created:** 2026-08-23
**Companion:** `WORKORDER-atlas-unification.md` (Deliverables 0–3, which produced
`AtlasCollection` and the six ports this one extends).

---

## Where villas actually differ

Everything below was measured on this checkout, not assumed.

| | Six collections (`AtlasCollection`) | Villas (`VillaAtlas`) |
| --- | --- | --- |
| Inventory in the browser | whole collection, once (`load()`) | **never** — 24 records/page from `/api/villas/search` |
| Feed | `public/maps/<type>/*.json`, static | 7.3 MB server-side dataset + a ~115 KB pins feed |
| Filtering | client-side, instant, counts on every option | server round-trip per change |
| List | first 120 of the filtered set | real pager, 163 pages of 24 |
| Card | text row, no photo | **photo card** — image, badges, summary, two advisor CTAs |
| Selection | click a card → fly, highlight, trace; sticky map on phone | **none** — cards are links, the map never answers them |
| Map | `AtlasShell` (Mapbox, circle layers, no clustering) | own Mapbox instance, **clustered** |
| Rendering | client-only | **server-rendered first page** (SEO, deep links arrive drawn) |
| Chrome | `.atlas-mapwrap`, `.atlas-collection`, shared rail + phone drawer | `.villa-map-wrap`, `.villa-filters`, own inline rail |

Two of those are the whole project: **the browser has no villa inventory**, and
**villa filters are not the shared rail's grammar**. The rest is porting.

### The feed, priced out

A card-grade static feed for all 3,902 villas (every one has coordinates), measured by
building the object and compressing it:

| Feed | raw | gzip | brotli |
| --- | --- | --- | --- |
| core (id, name, slug, region/destination/location, lng/lat, sleeps, bedrooms, rate, featured, specials) | 1.58 MB | 137 KB | 102 KB |
| core + image URL | 1.90 MB | 205 KB | 159 KB |
| core + image + 160-char summary | 2.44 MB | 375 KB | 281 KB |
| *(reference)* `hotel-points.json`, 2,475 hotels, already shipped to every visitor | 758 KB | 100 KB | 65 KB |

So: **villas with photos cost about twice the hotel feed and are entirely shippable**;
summaries are what doubles it again, and they are the one field a card can fetch later
or drop. Note this is a *derived* feed — `deep_link` and the supplier payload stay
server-side, which is the rule `/api/villas/search` exists to enforce.

---

## Phase 0 — behaviour parity, without moving villas at all

**Do this first. It is a day's work and it removes most of what reads as
inconsistency.** Villa cards are inert: clicking one navigates to the detail page, and
the map beside it never reacts. Every other atlas answers a click by flying to the
thing and holding the map still while you keep clicking.

1. Give `VillaAtlas` a `selectedId`, the same shape `AtlasCollection.pinnedId` has:
   click a card → fly to its pin, highlight it, click again to release. The map
   instance, the pin ids and the `exactLocation` flag are all already in the component.
2. Rename the map wrapper `.villa-map-wrap` → keep it, but add `.atlas-mapwrap`
   alongside, and apply `.stuck` while something is selected on a phone. The rules in
   `globals.css` are unscoped by collection and will simply apply.
3. Scroll the selected card clear of the stuck band — `.atlas-card[data-pinned]`'s
   `scroll-margin-top` is `--atlas-map-h`, which villa's band should adopt.
4. The card keeps its detail link. Selecting and opening are separate acts here for the
   same reason they are on hotels (see the `pinnedId` / `detailId` note in
   `AtlasCollection`).

After Phase 0, a traveller moving between `/atlas/hotel` and `/atlas/villa` meets the
same gesture. What is still different is the chrome and the pager.

---

## Phase 1 — `lib/atlas/adapters/villa.ts` + a build-time feed

1. `scripts/build-villa-points.mjs`, modelled on `build-hotel-points.mjs`: reads
   `data/villas-of-distinction.json`, writes the core+image feed to **both**
   `data/atlas/villa/villa-points.json` and `public/maps/villa/villa-points.json`
   (dual-copy discipline, byte-identical, per the companion work order). Wire it into
   `prebuild`.
2. `adaptVillas(raw): AtlasOffering[]`. Straightforward — villas have no itinerary, no
   route, no month:
   - `regions: [region]`, and `destination` / `location` / `category` into `attributes`
   - `routeFor: () => null`, `stops: []`, `path: []` (hotels already do this)
   - `searchText` must reproduce `searchVillas`'s `q` semantics exactly, and
     `searchMode: "substring"` like hotels
   - coordinates through `lib/atlas/geo.ts` — villas name theirs `geo.lon`, **not**
     `lng` (the coordinate zoo table in the companion work order)
3. `VILLA_DESCRIPTOR` with `supportsMonthFilter: false`, `supportsStopFilter: false`,
   `supportsBrandFilter: false`, and facets for destination and location. Both are long
   lists — `destination` is what `menuLimit` was added for, and it already does villa's
   current "Destination is disabled until a region is picked" trick generically.
4. `scripts/verify-villas.mjs` already exists; extend it to assert the adapter's
   predicate against `searchVillas` over a param sweep, the way `verify-hotels.mjs`
   does (1.75M comparisons) — this is the check that makes the swap safe.

## Phase 2 — three controls the rail does not have

The rail's grammar is region / brand / month / vessel / stop / q / trip-length /
`world`, plus declared enumerated facets. Villas need:

| Villa filter | Today | Work |
| --- | --- | --- |
| `sleeps`, `bedrooms` | "Sleeps 8+", "4+ bedrooms" | a **numeric ≥ facet**. `minDays`/`maxDays` already prove the pattern but are hardcoded to `o.days`; generalise to a declared numeric axis |
| `priceMax` | "Under $3,000/nt" | the same control, ≤ direction, on `attributes.rate` |
| `featured`, `specials` | two checkboxes | a **boolean facet**. `world` is exactly this, hardcoded to `o.world`; generalise it and villa gets both for free |
| price sorts | `priceDesc` default | `SORT_MODES` is `type === "hotel" ? … : …` in `AtlasCollection`; move it to the descriptor and add price |

None of these is deep — each is a declared axis in `AtlasFilterDescriptor`, a branch in
`matchesOffering`, a read/write pair in `params.ts`, and a control in the rail. They are
listed separately because together they are the bulk of Phase 2, and because
generalising `world` and the trip-length wheels pays off for the other six too.

## Phase 3 — the list, the map, the page

- **Pager → the shared list.** 163 pages of 24 become the filtered set, first 120,
  narrowed by filters — which is what every other atlas does and what makes the map
  the way you navigate. `?page=` stops meaning anything; nothing in `sitemap.js` uses
  it, but check `app/answers/*` before dropping it.
- **Clustering.** `AtlasShell` has none (hotels draw 2,475 pins unclustered plus a
  density-dot layer below a zoom threshold). Villas cluster today. 3,902 pins is the
  same order as hotels, so the honest options are: accept pins + the density layer, or
  add clustering to `AtlasShell` — where it would also improve hotels. Decide before
  Phase 3, not during it.
- **Photo cards.** `AtlasCollection` cards are text rows. Villas are browsed by
  photograph and stay that way — see Phase 3b, which is now the destination for both
  villas and hotels rather than a villa concession.

## Phase 3b — one stay card, two collections

**Decided:** villas keep their photographs, and hotels get them too once the supplier
API lands. Hotels and villas are the same kind of thing to a traveller — a place to
stay, chosen substantially by how it looks — and they should be browsed on the same
card. Sailings, flights and rail journeys are not that kind of thing (a card there
leads with a route and a date) and keep the text row.

### The data contract already exists

- `lib/search-offerings.js` **already** normalizes both into one shape carrying `thumb`
  and `photos[]` — hotels at `hotelCard()`, villas at the villa mapper
  (`thumb: v.imageUrl`). The Guide has been speaking this dialect the whole time; no
  component renders the images yet.
- `data/atlas/hotel/luxury-hotels.json` carries a **`thumb` field on all 2,475
  records, empty on every one**. The slot is cut and waiting for a source.
- `Master Documents/BeVvip_API_Integration_Strategy.md` §5 defines the normalized
  supplier response with `"photos": ["https://…"]`, so the incoming feed is expected to
  fill it.
- Villas: **3,896 of 3,902 have an image URL** (avg 76 chars, supplier CDN). The six
  without already fall back to `.villa-card-noimg`.

So the work is a media slot on the shared card, not a data project.

### The card

`AtlasCollection` already takes per-collection card slots — `cardPrimary` (hotels' rate
link), `cardAction` (Property details & 3D), `detailFor` (the dossier). Add one more,
`cardMedia`, and the anatomy is shared:

```
[ media ]              photo, with the collection's badges over it
crumb                  hotel: City · Country     villa: Region · Destination · Location
Name
stats · price          hotel: category · rating  villa: sleeps · bedrooms · from-rate
[ primary ] [ ask ]    hotel: VIP rate search    villa: request through your advisor
```

The differences that remain are the ones that must remain: a hotel card may carry a
rate search and the photoreal 3D; **a villa card may never grow a booking link** —
villas are advisor-arranged, and that rule outranks card symmetry.

### Photo-capable, not photo-required

Hotels have zero photos today. A photo-led card shipped before the API lands would
turn 2,475 hotel cards into grey rectangles, which is worse than the clean text row
they have now — and a grid where some cards have images and some do not reads as
broken, not as mixed.

So media is a **per-collection switch, thrown when that collection's feed actually
carries images**: villas on (99.8% coverage), hotels off until the supplier feed fills
`thumb`, then a one-line change in `scripts/build-hotel-points.mjs` (`thumb: h.thumb ||
null`) and the switch flips. Cost of carrying it in the client feed, at villa's average
URL length: roughly +25–40 KB gzipped for 2,475 hotels. Not a consideration.

### Open questions before the hotel half

1. **Rights.** Villa images are hotlinked from the supplier's CDN. Whatever fills
   hotels' `thumb` — Virtuoso, TravelWits, or a harvest — needs its redistribution terms
   confirmed, and a decision on hotlinking vs. proxying/caching through our own origin.
2. **Delivery.** Cards use plain `<img loading="lazy">` with the Next image optimizer
   opted out (supplier hosts are not in `next.config` `remotePatterns`). Moving villas
   to the shared list means up to 120 cards rather than a page of 24 — lazy loading
   covers it, but the decision to keep or drop the optimizer should be deliberate.
3. **Aspect ratio and crop.** One ratio for both collections, chosen for hotel
   exteriors and villa pools alike; supplier images arrive in neither.

## Phase 4 — what must still be true afterwards

- `/atlas/villa/[destination]/[slug]` keeps working, and `featuredVillaParams()` keeps
  feeding `app/sitemap.js`.
- Every deep link `app/atlas/villa/page.jsx` canonicalises today still resolves:
  `region`, `destination`, `location`, `sleeps`, `bedrooms`, `priceMax`, `featured`,
  `specials`, `q`, `ids`, `sort`, `bbox` — with `resolveRegion` / `resolveDestination`
  / `resolveLocation` still doing the alias work for Guide links.
- **Every CTA still routes to The Guide or the advisor.** Villas are advisor-arranged;
  no card may grow a booking link, and supplier `deep_link` must not enter the feed.
- The 7.3 MB dataset still never reaches the browser.

---

## The one thing to decide before Phase 1

Villa is the only **server-rendered** atlas: `page.jsx` runs the search on the server so
`?region=caribbean&sleeps=10` arrives fully drawn, in HTML. Moving to
`AtlasCollection` makes it client-only like the other six.

That is a real trade — villas are the collection with per-item detail routes in the
sitemap, so the atlas page's own crawlability matters more here than it does for
sailings. Either accept it (the detail routes carry the SEO, and the six collections
already made this trade), or keep a server-rendered shell for first paint and hydrate
the shared surface over it. **Answer this first**: it decides whether Phase 3 is a
deletion or a second rendering path.

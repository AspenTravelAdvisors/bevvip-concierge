# Base Camp — STATE

Running record of what is live in next-concierge (deployed at bevvip-concierge.vercel.app,
Vercel Root Directory = `next-concierge`). Update this file when an offering type,
data source, or major surface ships.

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

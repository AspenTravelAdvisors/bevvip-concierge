# The Guide

**The Guide** is an AI travel concierge for luxury and expedition travel, live at
**[guide.expeditionbucketlist.com](https://guide.expeditionbucketlist.com)**.

Travelers describe the trip they have in mind; The Guide (built on Claude)
searches real inventory — hotels, villas, expedition and world cruises, safaris,
rail journeys, hotel yachts and private jet trips — and answers with result
cards that open on the Living Atlas. When they're ready, it hands the brief to
an advisor. All bookings are made with
**[Aspen Travel Advisors](https://aspentraveladvisors.com)**.

## What's on the site

| Route | What it is |
| --- | --- |
| `/` | The Guide — streaming chat concierge with result cards and advisor hand-off |
| `/atlas/<type>` | The Living Atlas — map views for each collection (hotel, cruise, safari, train, yacht, jet, world cruise), plus `/atlas/villa` |
| `/hotels`, `/villas`, `/journeys` | Browsable collection pages by destination |
| `/answers` | Answer pages for common travel questions |
| `/bucket-list` | A traveler's saved trips |

Example atlas links:
`/atlas/hotel?hotel=<id>`, `/atlas/safari/?ids=<id>`, `/atlas/cruise/?ids=<id>`.

## Repository layout

```
next-concierge/      The application (Next.js App Router, TypeScript) — the live site
  app/               Routes and API handlers (app/api/guide is The Guide's backend)
  components/        UI: chat, result cards, atlas shells, advisor request
  lib/               Guide prompt, offering search, atlas config, booking helpers
  data/              Committed atlas inventory and curated data
  scripts/           Data sync, build and verification scripts
  public/maps/       The per-collection atlas map apps
Master Documents/    Project, supplier and API reference documentation
design-mocks/        Design explorations
.github/workflows/   CI, nightly Virtuoso data sync, IndexNow, monthly answer pages
```

## Getting started

Requires Node.js 18+ (CI uses Node 22).

```sh
cd next-concierge
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

Then open http://localhost:3000. The full list of environment variables
(Mapbox, Google Maps, Project Expedition, rate limits and more) is documented in
[`next-concierge/README.md`](next-concierge/README.md#environment).

## Checks

```sh
npm run check     # typecheck
npm run verify    # the full verification suite; every failure is named at the end
```

CI (`.github/workflows/ci.yml`) runs the typecheck and verification suite on
every push to `main` and every pull request.

## Data

Supplier inventory (Virtuoso hotels, promotions, cruises and tours) is
**committed to the repo, not fetched at request time**, so every supplier
change arrives as a reviewable diff. A nightly GitHub Action syncs it and
commits the result; `prebuild` re-runs the merges on every deploy so expired
offers and departed sailings are filtered out. See
[`next-concierge/README.md`](next-concierge/README.md#supplier-data) and
[`Master Documents/Virtuoso_API_Reference.md`](Master%20Documents/Virtuoso_API_Reference.md).

## Deployment

The site deploys on Vercel with the project's Root Directory set to
`next-concierge`. Merges to `main` build and go to production automatically.
Production configuration and rollback are covered in
[`next-concierge/PROMOTE.md`](next-concierge/PROMOTE.md).

## Further reading

- [`next-concierge/README.md`](next-concierge/README.md) — app internals, environment, verification
- [`next-concierge/STATE.md`](next-concierge/STATE.md) — running record of what has shipped
- [`next-concierge/BOOKING-SPEC.md`](next-concierge/BOOKING-SPEC.md) — booking flow
- [`DEEPLINK-HANDOFF.md`](DEEPLINK-HANDOFF.md) — atlas deep-link contract

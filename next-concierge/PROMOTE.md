# Production deployment — the Next.js concierge is live

The Next.js concierge in `next-concierge/` **is now the live site** at
`https://bevvip-concierge.vercel.app/`. This doc records the production
configuration and how to roll back. (It used to be a "how to promote" guide;
the promotion is done.)

## What's true right now

- **Production runs this Next.js app.** Vercel's **Root Directory** is set to
  `next-concierge`, so Vercel builds the Next.js app (Framework Preset:
  **Next.js**), not the legacy `public/` + `api/*` static deployment at the
  repo root.
- **`main` feeds production.** `next-concierge/` is merged to `main`, and Vercel
  auto-builds `main` and promotes it to production.
- **The Guide is Claude-only.** Chat is served by the route handler at
  `app/api/guide/route.ts` (Claude tool-use via `@anthropic-ai/sdk`). The
  legacy OpenAI proxy (`api/chat.js`) has been **deleted** from the repo.
- **There is no longer a legacy app to fall back to.** `public/`, `api/*` and
  the root `vercel.json` have been deleted from the repository. Rolling back
  now means promoting an earlier *deployment*, not changing the Root Directory
  — see the rollback section below.

## Production configuration (Vercel project settings)

- **Settings → General → Root Directory:** `next-concierge`
  - Build Command / Output Directory: **defaults** (Next.js owns them). Do
    **not** set Output Directory to `public` while Root Directory is
    `next-concierge` — that combination breaks the Next.js build.
- **Settings → Environment Variables (Production):**

  | Name | Value | Required |
  | --- | --- | --- |
  | `ANTHROPIC_API_KEY` | the Claude API key (`sk-ant-...`) | **yes** — chat is dead without it |
  | `CLAUDE_MODEL` | leave unset unless overriding (default `claude-sonnet-4-6`) | no |
  | `NEXT_PUBLIC_MAPBOX_TOKEN` | the Mapbox public token (same one the old app used) | no — globe falls back gracefully if absent |
  | `GUIDE_MODEL_ATTEMPTS` | leave unset (default 4) — retries on transient Claude overloads | no |
  | `GOOGLE_MAPS_API_KEY` | Google Maps JS key, served via `/api/hotel/config` | no — required only for the hotel map tiles |

  See `next-concierge/README.md` for the full env var table.

- **The `VIRTUOSO_API_*` credentials do not belong here.** They are used only by
  the nightly sync, which runs in GitHub Actions and commits its output, so they
  live as **repository secrets** — `VIRTUOSO_API_USER`, `VIRTUOSO_API_KEY`,
  `VIRTUOSO_API_AES_KEY`, `VIRTUOSO_API_AES_IV`. Vercel builds committed data
  and never calls the supplier. Adding them to Vercel would spread a secret with
  nothing to gain.

## Verify production

Open `https://bevvip-concierge.vercel.app/` and check:

- [ ] Home page `/` loads The Guide chat.
- [ ] Send a message (e.g. "Four Seasons in the Caribbean") — you get a
      streaming reply and result cards. *(If chat errors with a key message,
      `ANTHROPIC_API_KEY` is missing/wrong in Production.)*
- [ ] `/atlas/hotel` loads the tabbed Atlas (Hotels / Cruises / Jets / Yachts).
      The dark globe renders if the Mapbox token is set; otherwise the elegant
      fallback. Either is fine.
- [ ] `/atlas/banana` is a **404** (proves the new app is serving, not the old
      static site).

Quick tell-tales that the new build is live:

- `/atlas/hotel` loads the tabbed Atlas (the old static app has no such route).
- Page source references `/_next/static/...` assets.
- The document response carries `X-Powered-By: Next.js`.

## Rollback

The legacy static app is **gone** — `public/`, `api/*` and the root
`vercel.json` were deleted once this app had been live long enough to trust, so
the old "set Root Directory back to `/`" escape hatch no longer works. Setting
it back now builds nothing.

Roll back by deployment instead:

- **Fastest:** Vercel → Deployments → pick the last known-good deployment of
  **this** app → **Promote to Production**. Instant, no code changes.
- **By commit:** revert on `main` and let Vercel rebuild. Note that `prebuild`
  re-runs the Virtuoso merges, so a revert of application code still deploys
  against the currently committed supplier data — reverting the data is a
  separate revert of the `virtuoso-sync[bot]` commits.

If a rollback is ever needed because the *data* is wrong rather than the code,
`scripts/verify-virtuoso-delta.mjs` is the gate that should have caught it;
widen what it covers rather than restoring a static app that no longer exists.

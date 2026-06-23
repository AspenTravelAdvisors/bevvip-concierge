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
- **The root `vercel.json` is irrelevant in production.** Its
  `"outputDirectory": "public"` and `api/guide.js` function config only matter
  when Root Directory is the repo root — i.e. the rollback path below. Leave it
  as-is; it is the safety net, not the live config.

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

  See `next-concierge/README.md` for the full env var table.

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

## Rollback to the legacy static app (if needed)

Nothing here overwrites the old app — `public/` + `api/guide.js` still exist at
the repo root — so a rollback is just a redeploy.

- **Fastest:** Vercel → Deployments → pick the last known-good *old static*
  deployment → **Promote to Production**. Instant revert, no code changes.
- **Config revert:** Settings → General → Root Directory → set back to `/`
  (root) → redeploy `main`. Vercel then builds the legacy `public/` app using
  the root `vercel.json` (`outputDirectory: public`, `api/guide.js`). Note the
  legacy chat lacks the Next.js route's overload-retry handling.

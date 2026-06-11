# Promoting the Next.js build to production

This guide takes the new Next.js concierge in `next-concierge/` and makes it
the live site at `https://bevvip-concierge.vercel.app/`. No prior context
needed — follow top to bottom.

## What's true right now (the starting point)

- The **live site still runs the old static app.** The root `vercel.json`
  has `"outputDirectory": "public"`, so Vercel serves the legacy
  `public/` + `api/guide.js` deployment.
- **All the new code lives in `next-concierge/`** on the branch
  `claude/nextjs-usage-gotq25`. It is *not* merged to `main` and Vercel is
  *not* pointed at it yet.
- The original files are untouched. Promoting is purely a Vercel-config +
  merge step — no code rewrite required.

You have two paths. **Do Path A first** (a safe preview on a throwaway URL),
confirm it works, then do Path B to make it the real production site.

---

## Path A — Preview deploy (verify before going live)

Goal: get a temporary `*.vercel.app` preview URL building from
`next-concierge/` so we can click around before touching production.

1. **Open the Vercel project.**
   Vercel Dashboard → the `bevvip-concierge` project.

2. **Point Vercel at the subdirectory.**
   Settings → General → **Root Directory** → Edit →
   set it to `next-concierge` → Save.
   - This makes Vercel run the build *inside* `next-concierge/`, where the
     Next.js `package.json` lives. The Framework Preset should auto-detect
     as **Next.js**. If it doesn't, set it manually to Next.js.
   - Leave Build Command / Output Directory on their defaults (Next.js
     handles these — do **not** set Output Directory to `public`).

3. **Add the environment variables.**
   Settings → Environment Variables. Add these to **Preview** (and you'll
   reuse them for Production in Path B):

   | Name | Value | Required |
   | --- | --- | --- |
   | `ANTHROPIC_API_KEY` | the Claude API key (`sk-ant-...`) | **yes** — chat is dead without it |
   | `CLAUDE_MODEL` | leave unset unless overriding (default `claude-sonnet-4-6`) | no |
   | `NEXT_PUBLIC_MAPBOX_TOKEN` | the Mapbox public token (same one the old app used) | no — globe falls back gracefully if absent |

   > The old app's Mapbox token is in the legacy front-end code if you need
   > to find it; reuse the same token.

4. **Trigger the preview build.**
   Deployments → open the latest deployment from branch
   `claude/nextjs-usage-gotq25` → **Redeploy**. (Or push any commit to that
   branch.) Vercel builds a preview at a URL like
   `bevvip-concierge-git-claude-nextjs-...vercel.app`.

5. **Verify the preview (2 minutes).** Open the preview URL and check:
   - [ ] Home page `/` loads The Guide chat.
   - [ ] Send a message (e.g. "Four Seasons in the Caribbean") — you get a
         streaming reply and result cards. *(If chat errors, `ANTHROPIC_API_KEY`
         is missing/wrong.)*
   - [ ] Visit `/atlas/hotel` — a **tabbed Atlas page** loads (Hotels /
         Cruises / Jets / Yachts tabs). The dark globe renders if the Mapbox
         token is set; otherwise you get the elegant fallback panel. Either is
         fine.
   - [ ] Visit `/atlas/banana` — should be a **404** (proves routing is the
         new app, not the old static site).

   If all four pass, the build is good. Proceed to Path B.

---

## Path B — Promote to production

Goal: make that same build the real `bevvip-concierge.vercel.app`.

The Root Directory + env var changes from Path A are project-wide, so the
only remaining question is *which branch* feeds production. Two ways:

### Option B1 — Merge to `main` (recommended; keeps `main` as source of truth)

1. Make sure `ANTHROPIC_API_KEY` (and `NEXT_PUBLIC_MAPBOX_TOKEN` if used) are
   also added to the **Production** environment in Settings → Environment
   Variables (not just Preview).
2. Merge `claude/nextjs-usage-gotq25` → `main` (open a PR or merge directly,
   per the team's norms).
3. Vercel auto-builds `main` and promotes it to production. Done.

### Option B2 — Promote the preview deployment directly (no merge yet)

1. Confirm Production env vars are set (same as B1 step 1).
2. Deployments → find the good build from `claude/nextjs-usage-gotq25` →
   **⋯ menu → Promote to Production**.
3. This serves the branch build at the production domain without merging.
   Good for a fast cutover, but `main` will still hold the old app until you
   eventually merge — so prefer B1 unless you need speed.

---

## Verify production

Open `https://bevvip-concierge.vercel.app/` and re-run the four checks from
Path A step 5. Quick tell-tales that the new build is live:

- `https://bevvip-concierge.vercel.app/atlas/hotel` loads the tabbed Atlas
  (the old app has no such route).
- Page source references `/_next/static/...` assets.
- Response headers include `X-Powered-By: Next.js` (DevTools → Network →
  the document request).

---

## Rollback (if anything looks wrong)

- **Fastest:** Vercel → Deployments → pick the last known-good *old* static
  deployment → **Promote to Production**. Instant revert, no code changes.
- **Config revert:** Settings → General → Root Directory → set back to `/`
  (root), and redeploy `main`. This returns Vercel to building the legacy
  `public/` app.

Nothing in `next-concierge/` overwrites the old app, so a rollback is always
just a redeploy of the previous deployment.

---

## Notes / gotchas

- **Don't** set Output Directory to `public` while Root Directory is
  `next-concierge` — that combination breaks the Next.js build. Let Next.js
  own the build output.
- The new app is **Claude-only**; the legacy OpenAI proxy (`api/chat.js`) was
  intentionally not ported. No OpenAI key is needed.
- The old `api/guide.js` function config in the root `vercel.json` is
  irrelevant once Root Directory points at `next-concierge/` — the Next.js
  route handler (`app/api/guide/route.ts`) replaces it.
- See `next-concierge/README.md` for the full env var table and what each
  route does.

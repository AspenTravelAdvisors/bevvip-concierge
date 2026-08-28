# BeVvip Next Concierge

A Next.js (App Router, TypeScript) reimagining of the Base Camp concierge, and
since the promotion recorded in `PROMOTE.md` **the live site**. It is the only
application in this repository: the legacy static app that used to sit at the
repo root (`public/`, `api/*`, the root `vercel.json`) has been deleted, so the
rollback path that doc once described no longer exists. What remains outside
this directory is documentation (`Master Documents/`) and design mocks.

## What's here

- **`/` — The Guide.** Streaming chat concierge. The route handler at
  `app/api/guide/route.ts` ports `api/guide.js` to TypeScript using the
  official `@anthropic-ai/sdk` (replacing the hand-rolled SSE parser) and
  keeps the same Claude tool-use loop (`search_offerings` against the live
  Atlas APIs) and the same wire protocol
  (`status` → `delta`* → `meta` → `done`), so either frontend can talk to
  either backend during a migration.
- **Result cards + Atlas handoff.** The `meta` frame renders as inventory
  cards with per-result deep links, plus "View on the Living Atlas"
  (internal) and "Open full Atlas" (external) CTAs.
- **`/atlas/[type]` — unified Living Atlas.** One shell for
  `hotel | cruise | jet | yacht`, honoring the `?region=` deep-link contract
  from `DEEPLINK-HANDOFF.md`. Server-rendered with per-region metadata for
  SEO; tabs switch atlas type without losing the selected region. Renders
  the Mapbox dark globe when a token is present, otherwise an elegant
  fallback with the external-atlas handoff.

## Claude-only

This version is **Claude-only**. The Guide superseded the legacy OpenAI proxy
(`api/chat.js`), which has since been removed from the repo entirely.

## Run

```sh
cd next-concierge
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

## Environment

| Var | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | The Guide (Claude) |
| `CLAUDE_MODEL` | no | Override model (default `claude-sonnet-4-6`, matching the legacy deployment) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | no | Render the Living Atlas globe |
| `GOOGLE_MAPS_API_KEY` | no* | Google Maps JS key for the hotel map iframe (served via `/api/hotel/config`). *Required for the hotel map to render tiles. |
| `NEXT_PUBLIC_*_ATLAS_BASE` | no | Override the in-app atlas handoff path (default internal `/maps/<type>`; see `lib/atlas-config.ts`) |
| `PROJECT_EXPEDITION_TOKEN` | no* | Things to do — tours, private guides and day experiences from Project Expedition (`lib/experiences.js`, the Guide's `search_experiences` tool). *Unset means the Guide answers every "what is there to do here" with an advisor hand-off instead of real experiences. |
| `PE_API_BASE` | no | Project Expedition API base. **Defaults to staging** (`https://apistage.projectexpedition.com/v1`) — production deployments must set this to the live base, or they are showing staging inventory. |
| `PE_TIMEOUT_MS` | no | Abort a Project Expedition call after this many ms (default 8000; a country pull is ~2 MB and a cold function adds connect + TLS). |

All atlas inventory and query logic is served in-process from `data/atlas/` + `lib/atlas/` — this app has no runtime dependency on the external `*.vercel.app` atlas deployments.

### Sync-time only (never read by the running site)

The Virtuoso Partner API credentials are needed by `npm run sync:virtuoso` and
by the nightly GitHub Action, and by nothing else. They belong in
`next-concierge/.env.local` locally (gitignored) and as **repository secrets**
for the Action — *not* in Vercel, which only builds committed data.

| Var | Purpose |
| --- | --- |
| `VIRTUOSO_API_USER` | Agency name, passed as the `user` login parameter |
| `VIRTUOSO_API_KEY` | API key, encrypted into the auth token |
| `VIRTUOSO_API_AES_KEY` | AES-256-CBC key (base64) for the auth token |
| `VIRTUOSO_API_AES_IV` | AES-256-CBC IV (base64) for the auth token |
| `VIRTUOSO_API_BASE` | Optional override of `https://api.virtuoso.com` |

## Verification

```sh
npm run verify              # every check, all of them, failures named at the end
npm run verify:bail         # stop at the first failure
node scripts/verify-all.mjs virtuoso route   # just the ones whose name matches
```

`verify` deliberately does **not** stop at the first failure. It used to be an
`&&` chain, and a single false positive at the front took sixteen real checks
down with it — including one that was genuinely red. Each check is an
independent claim about a different part of the atlas, so each one runs.

## Supplier data

Virtuoso is the source of truth for hotel, promotion, cruise and tour facts.
The protocol — and the traps that cost real time — is written up in
`Master Documents/Virtuoso_API_Reference.md`.

The data is **committed, not fetched at request time**, so every supplier change
lands as a reviewable diff:

```
sync:virtuoso-hotels      ─┐
sync:virtuoso-promotions  ─┤  crawl  →  data/atlas/**/virtuoso-*.json   supplier truth
sync:virtuoso-cruises     ─┤
sync:virtuoso-tours       ─┘
                              ↓
match:virtuoso-hotels         →  data/atlas/hotel/virtuoso-id-map.json  ours ↔ theirs
merge:virtuoso-hotels         →  luxury-hotels.json                     truth + curation
merge:virtuoso-journeys       →  the six journey atlases
```

- `.github/workflows/virtuoso-sync.yml` runs the whole chain nightly and commits
  the result. Crawls resume from an NDJSON cache carried between runs, because a
  full detail crawl is thousands of strictly sequential calls.
- `npm run verify:virtuoso` checks that the feeds are fresh and that the merged
  outputs are current with respect to them.
- `prebuild` re-runs the merges on every deploy, so date-sensitive content
  (expired offers, departed sailings) is always filtered as of the build.

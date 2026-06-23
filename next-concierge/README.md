# BeVvip Next Concierge (test build)

A Next.js (App Router, TypeScript) reimagining of the Base Camp concierge.
The original app in the repo root is untouched — this lives entirely in
`next-concierge/` and reuses copies of the shared data layer
(`lib/search-offerings.js`, `lib/guide-prompt.js`).

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
| `HOTEL_ATLAS_API_BASE` etc. | no | Override Atlas data APIs (see `lib/search-offerings.js`) |
| `NEXT_PUBLIC_*_ATLAS_BASE` | no | Override external atlas app URLs (see `lib/atlas-config.ts`) |

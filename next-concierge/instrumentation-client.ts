// next-concierge/instrumentation-client.ts — client half of BotID.
//
// Runs on every page load and attaches BotID's signals to requests aimed at the
// protected paths below. The server half (lib/guide-botid.ts) reads the verdict.
//
// ENFORCING. /api/guide refuses a model round to a caller classified as
// automated and hands that visitor to an advisor instead — never a 403, never
// an error bubble. The rule and the reasoning live in lib/guide-botid.ts.
//
// Only /api/guide is protected. It is the one endpoint that spends money with a
// third party per call; the browsing APIs are Vercel compute only and are
// covered by the WAF rate limits.
import { initBotId } from "botid/client/core";

initBotId({
  protect: [{ path: "/api/guide", method: "POST" }],
});

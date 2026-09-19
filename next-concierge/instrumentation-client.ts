// next-concierge/instrumentation-client.ts — client half of BotID.
//
// Runs on every page load and attaches BotID's signals to requests aimed at the
// protected paths below. The server half (lib/guide-botid.ts) reads the verdict.
//
// SHADOW MODE. Nothing here blocks anything. /api/guide currently records the
// verdict on its telemetry line and serves the turn either way, so a
// misclassified traveler is not affected while we find out what the classifier
// would actually have done to real traffic. The decision to enforce is a
// separate, deliberate change — see lib/guide-botid.ts for what it should look
// like when that day comes.
//
// Only /api/guide is protected. It is the one endpoint that spends money with a
// third party per call; the browsing APIs are Vercel compute only and are
// covered by the WAF rate limits.
import { initBotId } from "botid/client/core";

initBotId({
  protect: [{ path: "/api/guide", method: "POST" }],
});

// robots.txt — welcomes the AI answer-engine crawlers alongside classic search,
// and turns away the handful that take the atlas and send nobody back.
//
// The line is drawn by one question: can this crawler put a traveler in front
// of us? Everything that can — search indexes, answer engines, the fetchers
// that run when a person asks an assistant something live, and the big labs'
// training crawlers whose models then name us unprompted — is allowed. The
// owner's call, September 2026: visibility is what the business needs most
// right now, and whether the labs' training crawlers pay their way is to be
// decided from the `ai` split on booking_clicked and advisor_request_sent
// (lib/arrival.ts) after a quarter of data, not guessed at.
//
// The /api routes are the only surface no crawler should spend budget on.

import { SITE_URL } from "@/lib/answers";
import { NO_RETURN_CRAWLERS } from "@/lib/crawlers";

const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  // Meta AI answers inside WhatsApp and Instagram, where this clientele is.
  // Kept for reach even though it is primarily a training crawler.
  "meta-externalagent",
];

export default function robots() {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/api/" },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: "/api/",
      })),
      ...NO_RETURN_CRAWLERS.map((userAgent) => ({ userAgent, disallow: "/" })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

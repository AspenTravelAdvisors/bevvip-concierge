// next-concierge/middleware.ts — refuse traffic the site does not serve, before
// any page, API route or data file is served:
//
//   - countries the business does not serve (lib/blocked-countries.ts)
//   - training crawlers that send no visitors back (lib/crawlers.ts). They are
//     also disallowed in robots.txt; this is for the ones that ignore it.

import type { NextRequest } from "next/server";
import { blockedResponse, isBlockedCountry } from "@/lib/blocked-countries";
import { isNoReturnCrawler } from "@/lib/crawlers";

export function middleware(req: NextRequest) {
  if (isBlockedCountry(req.headers)) return blockedResponse();
  // robots.txt stays readable, so a crawler that does honour it learns why.
  if (req.nextUrl.pathname !== "/robots.txt" && isNoReturnCrawler(req.headers.get("user-agent"))) {
    return new Response("Crawling is not permitted. See /robots.txt.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

export const config = {
  // Everything except Next's own build assets. The atlas data under /maps and
  // /data is deliberately included: it is the part worth copying.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

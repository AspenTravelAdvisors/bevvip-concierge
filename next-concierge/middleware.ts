// next-concierge/middleware.ts — refuse traffic from countries the site does
// not serve, before any page, API route or data file is served. See
// lib/blocked-countries.ts for the decision and how to change the list.

import type { NextRequest } from "next/server";
import { blockedResponse, isBlockedCountry } from "@/lib/blocked-countries";

export function middleware(req: NextRequest) {
  if (isBlockedCountry(req.headers)) return blockedResponse();
}

export const config = {
  // Everything except Next's own build assets. The atlas data under /maps and
  // /data is deliberately included: it is the part worth copying.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

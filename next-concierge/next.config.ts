import type { NextConfig } from "next";

// The Hotel Atlas iframe (public/maps/hotel/) calls a small same-origin API:
// paged hotel summaries + per-hotel detail + the Google Maps key from
// /api/config. Those are now served in-process by this app under /api/hotel/*
// (backed by lib/atlas), so we rewrite the iframe's same-origin `maps/hotel/api/*`
// calls there — no external deploy. The other four atlases are fully static.

/*
 * The origin this app answers as, for the redirect below.
 *
 * Same value and same fallback as SITE_URL in lib/answers.js. It is re-derived
 * here rather than imported because next.config.ts is loaded outside the app's
 * module graph — the "@/" alias does not resolve in it — and a second literal
 * of the host is exactly the drift this repo has already paid for once. Reading
 * the same env var is the closest thing to importing it that this file can do.
 */
const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL || "https://guide.expeditionbucketlist.com";

/*
 * The old host, and every host that should land on the new one.
 *
 * theaitravelguide.com was the address before the app moved under the brand it
 * belongs to. While it is still attached to this project, a request to it
 * renders the whole site — a byte-identical second copy of 4,600 pages on a
 * second host, which is the textbook way to split your own ranking in half.
 *
 * The rule below makes it a 308 to the same path on the new origin. Two things
 * about it are load-bearing:
 *
 *   - `permanent: true` (308, not 302). A temporary redirect asks a crawler to
 *     keep the old URL indexed and keep coming back; a permanent one transfers
 *     the signal and retires the old address. It is also what makes this a
 *     one-time cost rather than a hop on every future request.
 *   - `/:path*` → `/:path*`. Path-for-path, so a link into
 *     /answers/best-antarctica-expedition-cruise lands on that answer rather
 *     than dumping the visitor on a home page to find it again. Query strings
 *     are carried by Next automatically. Every redirect here is ONE hop: the
 *     destination host serves the page, it does not redirect again.
 *
 * www and apex are listed separately rather than as one regex. A `has` value is
 * matched by path-to-regexp, where an unnamed group is a parameter rather than
 * a plain alternation — two literal rules cannot be misread.
 *
 * If the domain is instead redirected at the Vercel project level, that fires
 * at the edge before this app runs and this rule simply never matches. It is
 * the backstop for the case where the old domain is still pointed here.
 */
const RETIRED_HOSTS = ["theaitravelguide.com", "www.theaitravelguide.com"];

const nextConfig: NextConfig = {
  // The Guide's tool loop can run several Claude + Atlas round trips.
  // (On Vercel, per-route maxDuration is exported from the route file.)
  reactStrictMode: true,
  async redirects() {
    return RETIRED_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `${SITE_ORIGIN}/:path*`,
      permanent: true,
    }));
  },
  async rewrites() {
    return [
      {
        source: "/maps/hotel/api/:path*",
        destination: "/api/hotel/:path*",
      },
    ];
  },
};

export default nextConfig;

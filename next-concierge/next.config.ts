import type { NextConfig } from "next";

// The Hotel Atlas iframe (public/maps/hotel/) calls a small same-origin API:
// paged hotel summaries + per-hotel detail + the Google Maps key from
// /api/config. Those are now served in-process by this app under /api/hotel/*
// (backed by lib/atlas), so we rewrite the iframe's same-origin `maps/hotel/api/*`
// calls there — no external deploy. The other four atlases are fully static.

// Every host but one is an alias. `guide.expeditionbucketlist.com` is the
// address — it is what SITE_URL says, what the canonical tags, sitemap, robots
// and JSON-LD resolve to, and what the header shows a visitor. The five hosts
// below are the domains the Vercel project still answers on for historical
// reasons; each one that keeps serving a 200 is a second copy of the whole
// site, which is how the same page ends up indexed under four addresses and
// none of them accumulates authority.
//
// Doing this here rather than with Vercel's per-domain "Redirect to" setting
// is deliberate: the redirect is then reviewable in the diff and survives a
// project being re-created, instead of living only in dashboard state.
//
// Vercel's own deployment hosts (*.vercel.app) are NOT in this list on
// purpose. They are how a preview or a failing production build gets opened
// and debugged, and a 308 to the live site makes that impossible. They are
// kept out of search results by the canonical tag instead, which every page
// emits from SITE_URL.
const CANONICAL_ORIGIN = "https://guide.expeditionbucketlist.com";

const ALIAS_HOSTS = [
  "theaitravelguide.com",
  "www.theaitravelguide.com",
  "thetravelguideai.com",
  "www.thetravelguideai.com",
  "basecamp.aspentraveladvisors.com",
];

const nextConfig: NextConfig = {
  // The Guide's tool loop can run several Claude + Atlas round trips.
  // (On Vercel, per-route maxDuration is exported from the route file.)
  reactStrictMode: true,
  async redirects() {
    // `has` host values are matched as anchored regexes, so the dots are
    // escaped — an unescaped `.` would match any character.
    return ALIAS_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host.replace(/\./g, "\\.") }],
      destination: `${CANONICAL_ORIGIN}/:path*`,
      // 308, not 307: these moves are permanent, and a permanent redirect is
      // what tells a crawler to transfer the old address's authority here
      // rather than keep both.
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

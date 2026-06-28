import type { NextConfig } from "next";

// The Hotel Atlas iframe (public/maps/hotel/) calls a small same-origin API:
// paged hotel summaries + per-hotel detail + the Google Maps key from
// /api/config. Those are now served in-process by this app under /api/hotel/*
// (backed by lib/atlas), so we rewrite the iframe's same-origin `maps/hotel/api/*`
// calls there — no external deploy. The other four atlases are fully static.

const nextConfig: NextConfig = {
  // The Guide's tool loop can run several Claude + Atlas round trips.
  // (On Vercel, per-route maxDuration is exported from the route file.)
  reactStrictMode: true,
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

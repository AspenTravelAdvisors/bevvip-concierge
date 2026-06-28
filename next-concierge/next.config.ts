import type { NextConfig } from "next";

// The Hotel Atlas, copied into public/maps/hotel/, still needs its serverless
// API (paged hotel summaries + per-hotel detail + the Google Maps key from
// /api/config). Rather than re-host that backend here, proxy the iframe's
// same-origin `maps/hotel/api/*` calls to the live Hotel Atlas deploy — keeping
// the browser same-origin (no CORS) while the real data comes from the atlas's
// own functions. The other four atlases are fully static and need no proxy.
const HOTEL_ATLAS_BASE =
  process.env.NEXT_PUBLIC_HOTEL_ATLAS_BASE || "https://luxury-hotel-atlas-two.vercel.app";

const nextConfig: NextConfig = {
  // The Guide's tool loop can run several Claude + Atlas round trips.
  // (On Vercel, per-route maxDuration is exported from the route file.)
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/maps/hotel/api/:path*",
        destination: `${HOTEL_ATLAS_BASE}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

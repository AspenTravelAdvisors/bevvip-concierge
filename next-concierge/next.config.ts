import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Guide's tool loop can run several Claude + Atlas round trips.
  // (On Vercel, per-route maxDuration is exported from the route file.)
  reactStrictMode: true,
};

export default nextConfig;

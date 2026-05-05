import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js dev-mode indicator. We have our own ambient
  // design system — the floating N badge interrupts the deep-sea aesthetic.
  devIndicators: false,

  // Next 16 blocks cross-origin dev requests by default. Allow our
  // tunneled hostname + localhost so the browser can hit internal dev
  // routes (HMR, RSC fetches) from Cloudflare's edge without the
  // "cross-origin request from <host> blocked" warning.
  allowedDevOrigins: [
    "astra.thearrogantclub.com",
    "localhost",
    "127.0.0.1",
  ],

  // Production builds fail on TypeScript errors — and that's the
  // intent. The earlier `ignoreBuildErrors: true` override was load-
  // bearing because of pre-existing TS errors in AgentSnapshot,
  // usePushSubscribe, and the instanceof-Date cluster across pg
  // routes. All fixed in Phase-2b cleanup; flag flipped back off so
  // any new error is caught at deploy.
  typescript: {
    ignoreBuildErrors: false,
  },
  // Next 16 dropped the `eslint` config option. Eslint runs via
  // `next lint` separately now and doesn't gate `next build`.
};

export default nextConfig;

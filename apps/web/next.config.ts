import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/shared is consumed as TypeScript source (no build step).
  transpilePackages: ["shared"],
  async headers() {
    return [
      {
        // Admin screens: never cache, never frame (clickjacking), and don't
        // leak admin URLs via Referer.
        source: "/admin/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // The invitation token is in the URL; keep it out of Referer headers.
        source: "/invite/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;

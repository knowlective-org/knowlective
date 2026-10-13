import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/shared is consumed as TypeScript source (no build step).
  transpilePackages: ["shared"],
  // Development only: Next.js rejects requests for its dev resources (hot
  // reload, client chunks) from hosts other than localhost, which leaves the
  // screens blank when the dev server is opened as http://127.0.0.1:3000.
  allowedDevOrigins: ["127.0.0.1"],
  // Development only: Next.js's indicator sits bottom-left by default, on top
  // of the sidebar's footer links (account, trash, sign out).
  devIndicators: { position: "bottom-right" },
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
      {
        // Same for the password reset token.
        source: "/reset-password/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;

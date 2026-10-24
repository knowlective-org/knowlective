import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Display languages: next-intl, configured per request in src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// KNOWLECTIVE_BASE_PATH, checked the same way as src/lib/base-path.ts (which can't
// be imported here).
const basePath = (process.env.KNOWLECTIVE_BASE_PATH ?? "").trim().replace(/\/+$/, "");
if (basePath !== "" && !/^(\/[A-Za-z0-9._~-]+)+$/.test(basePath)) {
  throw new Error(`KNOWLECTIVE_BASE_PATH must look like "/knowlective" or "/tools/knowlective" (got "${process.env.KNOWLECTIVE_BASE_PATH}")`);
}

const nextConfig: NextConfig = {
  // packages/shared is consumed as TypeScript source (no build step).
  transpilePackages: ["shared"],
  // Loaded by Node as is on the server, not bundled: reading attachments'
  // text (lib/file-text.ts) uses pdf.js's own worker module, which bundling
  // breaks. The browser's PDF viewer is unaffected.
  serverExternalPackages: ["pdfjs-dist"],
  // The sub-path the app is served under ("" = the root). Fixed when the app
  // is built: Next.js writes it into the browser's code. Our own code reads it
  // from NEXT_PUBLIC_BASE_PATH (src/lib/base-path.ts).
  basePath: basePath || undefined,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
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

export default withNextIntl(nextConfig);

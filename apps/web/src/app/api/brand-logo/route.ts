import { getBrandLogo } from "@/lib/brand";

// The site's logo (lib/brand.ts), public: it's shown to everyone, signed in or
// not. The URL carries a version (?v=), so it's cached for good. Served so
// that nothing in it can run even if opened directly: a CSP allowing no
// scripts (sandbox), and no type sniffing.
export async function GET() {
  const svg = await getBrandLogo();
  if (!svg) return new Response("Not found", { status: 404 });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

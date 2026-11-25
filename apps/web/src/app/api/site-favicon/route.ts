import { readSiteFavicon } from "@/lib/site-favicon";

// The site's favicon (lib/site-favicon.ts), public: it's in everyone's tab,
// signed in or not. The URL carries a version (?v=), so it's cached for good.
// An SVG is served so that nothing in it can run if opened directly.
// auth: public — the site's favicon, on the login screen too.
export async function GET() {
  const favicon = await readSiteFavicon();
  if (!favicon) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(favicon.bytes), {
    headers: {
      "Content-Type": favicon.type === "image/svg+xml" ? "image/svg+xml; charset=utf-8" : favicon.type,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

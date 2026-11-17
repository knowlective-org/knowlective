import { getCurrentUser } from "@/lib/auth/session";
import { readRootFavicon } from "@/lib/root-favicon";

// A knowledge root's favicon (lib/root-favicon.ts), for those who can open
// its root page (not logged in: a public root page's). Not found for anyone
// else, as if there were none. The URL carries a version (?v=), so it's kept
// in the viewer's cache (private: who may see it depends on who asks). An
// SVG is served so that nothing in it can run if opened directly.
export async function GET(_req: Request, ctx: RouteContext<"/api/roots/[rootId]/favicon">) {
  const user = await getCurrentUser();
  const { rootId } = await ctx.params;
  const favicon = await readRootFavicon(user?.id ?? null, rootId);
  if (!favicon) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(favicon.bytes), {
    headers: {
      "Content-Type": favicon.type === "image/svg+xml" ? "image/svg+xml; charset=utf-8" : favicon.type,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

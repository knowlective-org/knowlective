import { getCurrentUser } from "@/lib/auth/session";
import { readAvatar } from "@/lib/avatar";

// A person's picture (lib/avatar.ts), for anyone logged in (as names are
// shown to them); not found for someone who isn't, or when there's none. The
// URL carries a version (?v=), so it's kept in the viewer's cache.
export async function GET(_req: Request, ctx: RouteContext<"/api/users/[userId]/avatar">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const { userId } = await ctx.params;
  const avatar = await readAvatar(userId);
  if (!avatar) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      "Content-Type": avatar.type,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

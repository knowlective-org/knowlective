import { requireAdminView } from "@/lib/admin/auth";
import { readAvatar } from "@/lib/avatar";

// A person's picture (lib/avatar.ts) for the admin console's user list: its
// session cookie is only sent under /admin, so /api/users/<id>/avatar (for
// the app's session) can't serve it there.
export async function GET(_req: Request, ctx: RouteContext<"/admin/users/[userId]/avatar">) {
  await requireAdminView();
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

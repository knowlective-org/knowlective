import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { pageChats } from "@/lib/api/chat";

type Context = RouteContext<"/api/v1/pages/[pageId]/chats">;

// GET: the page's chat blocks, in the order they're in the page: their block
// id (for …/chats/<id>/messages) and title.
export async function GET(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId } = await ctx.params;
    const access = await getPageAccess(prisma, user.id, pageId);
    if (!access) return apiError("not_found");
    return apiJson({ chats: await pageChats(pageId) });
  });
}

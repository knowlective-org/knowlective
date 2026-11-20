import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { pagePeople } from "@/lib/page-people";

type Context = RouteContext<"/api/v1/pages/[pageId]/people">;

// GET: the people who can open the page and can be mentioned or sent a
// message about it (lib/page-people.ts: those with a name), as `{ id, name }`.
export async function GET(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId } = await ctx.params;
    if (!(await getPageAccess(prisma, user.id, pageId))) return apiError("not_found");
    return apiJson({ people: await pagePeople(prisma, pageId) });
  });
}

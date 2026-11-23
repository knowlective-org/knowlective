import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { listPageTables } from "@/lib/api/page-tables";

type Context = RouteContext<"/api/v1/pages/[pageId]/tables">;

// GET: the tables in the page's body (tables, extended tables and child page
// tables), with their columns and row counts.
export async function GET(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId } = await ctx.params;
    if (!(await getPageAccess(prisma, user.id, pageId))) return apiError("not_found");
    return apiJson({ tables: await listPageTables(user.id, pageId) });
  });
}

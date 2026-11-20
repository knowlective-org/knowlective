import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { childProperties } from "@/lib/api/child-properties";

type Context = RouteContext<"/api/v1/pages/[pageId]/children">;

// GET ?property=<column name> (repeatable): the page's child pages that the
// key's owner can see, in their order, with their values in the columns of
// the page's child page table (all of them, or only those named).
export async function GET(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId } = await ctx.params;
    if (!(await getPageAccess(prisma, user.id, pageId))) return apiError("not_found");
    const names = new URL(request.url).searchParams.getAll("property");
    const result = await childProperties(user.id, pageId, names.length > 0 ? names : undefined);
    if (!result) return apiError("not_found");
    if ("unknown" in result) return apiError("invalid_body", `The page's child pages have no property named ${result.unknown.map((n) => JSON.stringify(n)).join(", ")}.`);
    return apiJson(result);
  });
}

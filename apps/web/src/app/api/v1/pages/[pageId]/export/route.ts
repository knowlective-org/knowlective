import { apiJson, withApiKey } from "@/lib/api/http";
import { exportProblem } from "@/lib/api/page-transfer";
import { createPageExport } from "@/lib/page-transfer/export";

type Context = RouteContext<"/api/v1/pages/[pageId]/export">;

// POST: a one-time link to copy the page and the pages under it (as the key's
// owner sees them) to another knowlective site, or elsewhere on this one:
// { url, expiresAt, pages }. Give `url` to POST /api/v1/pages/<id>/import on
// the site to copy to. It works once, for 10 minutes; whoever has it gets
// the pages, so pass it on like the pages themselves (lib/page-transfer/).
export async function POST(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId } = await ctx.params;
    const result = await createPageExport(user.id, pageId, "api");
    if ("error" in result) return exportProblem(result.error);
    return apiJson({ url: result.url, expiresAt: result.expiresAt.toISOString(), pages: result.pages }, 201);
  });
}

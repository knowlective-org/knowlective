import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { exportProblem, importJson, importProblem } from "@/lib/api/page-transfer";
import { createPageExport } from "@/lib/page-transfer/export";
import { importPages } from "@/lib/page-transfer/import";

type Context = RouteContext<"/api/v1/pages/[pageId]/copy">;

// POST { parentId }: copies the page and the pages under it under another
// page of this site: export and import in one go (lib/page-transfer/).
// 201: as POST .../import.
export async function POST(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId } = await ctx.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError("invalid_body");
    }
    const parentId = body && typeof body === "object" ? (body as Record<string, unknown>).parentId : undefined;
    if (typeof parentId !== "string") return apiError("invalid_body", 'Send { "parentId": "<the page to copy under>" }.');
    const link = await createPageExport(user.id, pageId, "api");
    if ("error" in link) return exportProblem(link.error);
    const result = await importPages(user.id, parentId, link.url, "api");
    if ("code" in result) return importProblem(result);
    return apiJson(await importJson(result), 201);
  });
}

import { apiError, apiJson, withApiKey } from "@/lib/api/http";
import { importJson, importProblem } from "@/lib/api/page-transfer";
import { importPages } from "@/lib/page-transfer/import";

type Context = RouteContext<"/api/v1/pages/[pageId]/import">;

// POST { url }: copies the pages of a one-time link (POST .../export on any
// knowlective site, this one included) under this page, as new pages at the
// end of its children. Needs EDIT on this page. 201: { id, url, pages,
// files: { copied, skipped }, peopleRemoved, sameSite } (lib/page-transfer/).
export async function POST(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId } = await ctx.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError("invalid_body");
    }
    const url = body && typeof body === "object" ? (body as Record<string, unknown>).url : undefined;
    if (typeof url !== "string") return apiError("invalid_body", 'Send { "url": "<the copy link>" }.');
    const result = await importPages(user.id, pageId, url, "api");
    if ("code" in result) return importProblem(result);
    return apiJson(await importJson(result), 201);
  });
}

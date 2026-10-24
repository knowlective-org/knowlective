import { atLeast, canEditPage } from "shared";
import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { apiError, apiJson, pageDetail, readPageInput, withApiKey } from "@/lib/api/http";
import { markdownToBody } from "@/lib/api/page-content";
import { replacePageContent } from "@/lib/collab-events";

type Context = RouteContext<"/api/v1/pages/[pageId]">;

// GET: the page with its content as Markdown.
export async function GET(request: Request, ctx: Context) {
  return withApiKey(request, "READ", async ({ user }) => {
    const { pageId } = await ctx.params;
    const access = await getPageAccess(prisma, user.id, pageId);
    // Missing and invisible alike, so page ids can't be probed.
    if (!access) return apiError("not_found");
    return apiJson(await pageDetail(user.id, pageId, access.rootId));
  });
}

// PATCH { title?, markdown? }: replaces the title and/or the whole body. Live:
// everyone with the page open sees it; the content before is kept in the
// page's history. Needs EDIT, and the page not locked.
export async function PATCH(request: Request, ctx: Context) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const { pageId } = await ctx.params;
    const access = await getPageAccess(prisma, user.id, pageId);
    if (!access) return apiError("not_found");
    if (!atLeast(access.access, "EDIT")) return apiError("forbidden");
    if (!canEditPage(access)) return apiError("page_locked");
    const read = await readPageInput(request);
    if ("error" in read) return read.error;
    const { input } = read;
    if (input.title === undefined && input.markdown === undefined) {
      return apiError("invalid_body", "Send \"title\", \"markdown\", or both.");
    }
    await replacePageContent(pageId, user.id, {
      title: input.title,
      body: input.markdown === undefined ? undefined : await markdownToBody(input.markdown),
    });
    return apiJson(await pageDetail(user.id, pageId, access.rootId));
  });
}

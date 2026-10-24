import { getVisibleTrees } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { apiError, apiJson, pageDetail, pageSummary, readPageInput, withApiKey } from "@/lib/api/http";
import { markdownToBody } from "@/lib/api/page-content";
import { replacePageContent } from "@/lib/collab-events";
import { insertChildPage } from "@/lib/page-create";

// GET: every page the key's owner can see, by knowledge root, in sibling order.
export async function GET(request: Request) {
  return withApiKey(request, "READ", async ({ user }) => {
    const trees = await getVisibleTrees(prisma, user.id);
    const pages = trees.flatMap((tree) => {
      const visible = new Set(tree.pages.map((p) => p.id));
      return tree.pages.map((p) => pageSummary(p, visible, tree.rootId));
    });
    return apiJson({ pages });
  });
}

// POST { parentId, title?, markdown? }: a new page under `parentId`, last
// among its siblings. Needs EDIT on the parent, as in the sidebar.
export async function POST(request: Request) {
  return withApiKey(request, "WRITE", async ({ user }) => {
    const read = await readPageInput(request);
    if ("error" in read) return read.error;
    const { input, body } = read;
    if (typeof body.parentId !== "string" || !body.parentId) {
      return apiError("invalid_body", "\"parentId\" (the page to create the page under) is required.");
    }
    const created = await insertChildPage(user.id, body.parentId, input.title ?? "");
    if ("error" in created) {
      if (created.error === "lockedWithChildren") return apiError("page_locked", "The parent page is locked with its child pages.");
      if (created.error === "tooDeep") return apiError("too_deep");
      return apiError("not_found", "The parent page doesn't exist, or the key's owner can't edit it.");
    }
    if (input.markdown !== undefined) {
      await replacePageContent(created.id, user.id, { body: await markdownToBody(input.markdown) });
    }
    const page = await prisma.page.findUniqueOrThrow({ where: { id: created.id }, select: { rootId: true } });
    return apiJson(await pageDetail(user.id, created.id, page.rootId), 201);
  });
}

import { atLeast, canEditPage } from "shared";
import { prisma } from "@/lib/db";
import { getPageAccess } from "@/lib/page-access";
import { closeDocuments, notifyChildrenChanged } from "@/lib/collab-events";
import { removeSlide } from "@/lib/presentation-ops";
import { recordPageDelete } from "@/lib/page-delete-audit";

// Moving one page to the trash from the API and MCP (DELETE
// /api/v1/pages/<id>, delete_page). Unlike the page menu, only a page with no
// child pages: a subtree is deleted from the bottom up, one page at a time,
// so one call can't take away more than the page named. Child pages count
// whether or not the caller can see them (a presentation's slides too:
// delete them first with delete_slide). Needs EDIT and no lock, as for any
// change to the page. It can be restored from the trash as usual. Recorded
// in the audit log, as from the screen.

export type PageDeleteError = "not_found" | "forbidden" | "page_locked" | "root_page" | "has_children";

export async function trashPage(userId: string, pageId: string, via: "api" | "mcp"): Promise<{ parentId: string } | { error: PageDeleteError }> {
  const access = await getPageAccess(prisma, userId, pageId);
  // Missing and invisible alike, so page ids can't be probed.
  if (!access) return { error: "not_found" };
  if (!atLeast(access.access, "EDIT")) return { error: "forbidden" };
  if (!canEditPage(access)) return { error: "page_locked" };
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { parentId: true, kind: true, title: true } });
  if (!page) return { error: "not_found" };
  // A root page is its knowledge root, deleted only in the admin console.
  if (!page.parentId) return { error: "root_page" };
  // A slide goes through its presentation (its history, its lock).
  if (page.kind === "SLIDE") {
    const result = await removeSlide(userId, page.parentId, pageId, via);
    if (!result.error) return { parentId: page.parentId };
    return { error: result.error === "not_found" || result.error === "page_locked" ? result.error : "forbidden" };
  }
  // In one statement, so a child page made meanwhile keeps the page alive.
  const deleted = await prisma.$executeRaw`
    UPDATE "Page" SET "deletedAt" = now(), "deletedById" = ${userId}, "updatedAt" = now()
    WHERE "id" = ${pageId} AND "deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Page" c WHERE c."parentId" = ${pageId} AND c."deletedAt" IS NULL)`;
  if (deleted === 0) {
    const alive = await prisma.page.count({ where: { id: pageId, deletedAt: null } });
    return { error: alive ? "has_children" : "not_found" };
  }
  await recordPageDelete(userId, { id: pageId, title: page.title, parentId: page.parentId }, 0, via);
  closeDocuments([pageId]);
  notifyChildrenChanged(page.parentId);
  return { parentId: page.parentId };
}

"use server";

import { MAX_PAGE_DEPTH, atLeast, getTreeWithAccess } from "shared";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { recordAudit, userLabel } from "@/lib/audit";
import { notifyChildrenChanged } from "@/lib/collab-events";
import { displayTitle } from "@/lib/page-title";
import { nextSortOrder } from "@/lib/page-move";

const CANNOT_RESTORE = "このページは元に戻せません。";

// Brings a page in the trash back, with its subtree.
//
// - Its parent is live: it goes back where it was (`newParentId` ignored).
// - Its parent is in the trash too: it goes under `newParentId`, a live page
//   in the same knowledge root the caller can edit. Its access then comes
//   from the new place, so that move is recorded in the audit log.
export async function restorePage(pageId: string, newParentId?: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (typeof pageId !== "string") return { error: CANNOT_RESTORE };
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { rootId: true, parentId: true, deletedAt: true, title: true },
  });
  if (!page?.deletedAt || !page.parentId) return { error: CANNOT_RESTORE };
  const tree = await getTreeWithAccess(prisma, user.id, page.rootId);
  const { pages, access, live } = tree;
  const editable = (id: string) => atLeast(access.get(id) ?? null, "EDIT");
  if (!editable(pageId)) return { error: CANNOT_RESTORE };

  if (live.has(page.parentId)) {
    await prisma.page.update({ where: { id: pageId }, data: { deletedAt: null, deletedById: null } });
    notifyChildrenChanged(page.parentId);
    return {};
  }

  // The original parent is gone: restore under the chosen page instead.
  // A live page can't be inside the deleted page's subtree, so no cycle.
  if (typeof newParentId !== "string" || !live.has(newParentId) || !editable(newParentId)) {
    return { error: "元の親ページがごみ箱にあります。戻す場所を、編集できるページから選んでください。" };
  }
  const byId = new Map(pages.map((p) => [p.id, p]));
  const depthOf = (id: string) => {
    let depth = 0;
    for (let cursor = byId.get(id)?.parentId ?? null; cursor && depth <= MAX_PAGE_DEPTH; depth++) {
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return depth;
  };
  const subtreeHeight = (id: string, level = 0): number =>
    level > MAX_PAGE_DEPTH
      ? level
      : Math.max(0, ...pages.filter((p) => p.parentId === id).map((p) => 1 + subtreeHeight(p.id, level + 1)));
  if (depthOf(newParentId) + 1 + subtreeHeight(pageId) > MAX_PAGE_DEPTH) {
    return { error: `ページの階層が${MAX_PAGE_DEPTH}段を超えるため、そこには戻せません。` };
  }

  const from = byId.get(page.parentId)!;
  const to = byId.get(newParentId)!;
  await prisma.page.update({
    where: { id: pageId },
    // Last among its new siblings (its old position belonged to the old parent).
    data: { parentId: newParentId, deletedAt: null, deletedById: null, sortOrder: await nextSortOrder(newParentId) },
  });
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.restore.move",
    `ページ「${displayTitle(page.title)}」をごみ箱から「${displayTitle(to.title)}」の下に戻した（元の親「${displayTitle(from.title)}」はごみ箱にあるため。権限は移動先から引き継ぐ）`,
    { pageId, fromParentId: from.id, toParentId: to.id },
  );
  notifyChildrenChanged(newParentId);
  return {};
}

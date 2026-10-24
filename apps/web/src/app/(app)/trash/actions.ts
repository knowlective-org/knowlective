"use server";

import { getTranslations } from "next-intl/server";
import { MAX_PAGE_DEPTH, atLeast } from "shared";
import { getTreeWithAccess } from "@/lib/page-access";
import { auditTranslator } from "@/i18n/audit";
import { displayTitleWith } from "@/i18n/display-title";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { recordAudit, userLabel } from "@/lib/audit";
import { notifyChildrenChanged } from "@/lib/collab-events";
import { nextSortOrder } from "@/lib/page-move";

// Brings a page in the trash back, with its subtree.
//
// - Its parent is live: it goes back where it was (`newParentId` ignored).
// - Its parent is in the trash too: it goes under `newParentId`, a live page
//   in the same knowledge root the caller can edit. Its access then comes
//   from the new place, so that move is recorded in the audit log.
export async function restorePage(pageId: string, newParentId?: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await getTranslations("trash.errors");
  const CANNOT_RESTORE = t("cannotRestore");
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
    return { error: t("parentInTrash") };
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
    return { error: t("tooDeep", { max: MAX_PAGE_DEPTH }) };
  }

  const from = byId.get(page.parentId)!;
  const to = byId.get(newParentId)!;
  await prisma.page.update({
    where: { id: pageId },
    // Last among its new siblings (its old position belonged to the old parent).
    data: { parentId: newParentId, deletedAt: null, deletedById: null, sortOrder: await nextSortOrder(newParentId) },
  });
  const audit = await auditTranslator();
  const displayTitle = displayTitleWith(audit);
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.restore.move",
    audit("audit.pageRestoreMove", {
      title: displayTitle(page.title),
      to: displayTitle(to.title),
      from: displayTitle(from.title),
    }),
    { pageId, fromParentId: from.id, toParentId: to.id },
  );
  notifyChildrenChanged(newParentId);
  return {};
}

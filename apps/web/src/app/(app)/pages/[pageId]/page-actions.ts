"use server";

import { atLeast, getGroupAccessForPage, getPageAccess, getTreeWithAccess } from "shared";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { closeDocuments, notifyChildrenChanged } from "@/lib/collab-events";

export type PageInfo = {
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  // Groups with MANAGE on this page (granted here or inherited).
  ownerGroups: string[];
};

const displayName = (u: { name: string | null; email: string } | null) => (u ? u.name || u.email : null);

// Shown in the page menu. Loaded when the menu opens, so the times are
// current even after a long editing session.
export async function loadPageInfo(pageId: string): Promise<PageInfo | null> {
  const user = await requireUser();
  if (typeof pageId !== "string" || !(await getPageAccess(prisma, user.id, pageId))) return null;
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { name: true, email: true } },
      updatedBy: { select: { name: true, email: true } },
    },
  });
  if (!page) return null;
  const groupAccess = await getGroupAccessForPage(prisma, pageId);
  const ownerIds = [...groupAccess].filter(([, access]) => access === "MANAGE").map(([id]) => id);
  const owners = await prisma.group.findMany({
    where: { id: { in: ownerIds } },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return {
    createdBy: displayName(page.createdBy) ?? "",
    createdAt: page.createdAt.toISOString(),
    // Not edited since it was created: the creator was the last to touch it.
    updatedBy: displayName(page.updatedBy) ?? displayName(page.createdBy),
    updatedAt: page.updatedAt.toISOString(),
    ownerGroups: owners.map((g) => g.name),
  };
}

const CANNOT_DELETE = "このページは削除できません。";

// Live pages under `pageId` (not including it), from getTreeWithAccess().
function liveDescendants(
  pages: { id: string; parentId: string | null }[],
  live: Set<string>,
  pageId: string,
): string[] {
  const result: string[] = [];
  const walk = (id: string) => {
    for (const p of pages) {
      if (p.parentId === id && live.has(p.id)) {
        result.push(p.id);
        walk(p.id);
      }
    }
  };
  walk(pageId);
  return result;
}

// How many live pages would go to the trash with this one (for the
// confirmation message), or an error if the caller may not delete it.
export async function checkDeletePage(pageId: string): Promise<{ descendants: number } | { error: string }> {
  const user = await requireUser();
  const result = await deletionTarget(user.id, pageId);
  return "error" in result ? result : { descendants: result.descendants.length };
}

// Needs EDIT on the page and on everything under it — deleting a subtree
// must not take away pages the caller couldn't edit or even see. Root pages
// can't be deleted (that would be deleting the knowledge root).
async function deletionTarget(
  userId: string,
  pageId: unknown,
): Promise<{ error: string } | { parentId: string; descendants: string[] }> {
  if (typeof pageId !== "string") return { error: CANNOT_DELETE };
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { rootId: true, parentId: true } });
  if (!page) return { error: CANNOT_DELETE };
  const { pages, access, live } = await getTreeWithAccess(prisma, userId, page.rootId);
  if (!live.has(pageId) || !atLeast(access.get(pageId) ?? null, "EDIT")) return { error: CANNOT_DELETE };
  if (!page.parentId) return { error: "ナレッジルートのページは削除できません。" };
  const descendants = liveDescendants(pages, live, pageId);
  if (descendants.some((id) => !atLeast(access.get(id) ?? null, "EDIT"))) {
    return { error: "編集の権限がない子ページが含まれているため、削除できません。" };
  }
  return { parentId: page.parentId, descendants };
}

// Moves the page (and, implicitly, its subtree) to the trash.
export async function deletePage(pageId: string): Promise<{ parentId: string } | { error: string }> {
  const user = await requireUser();
  const target = await deletionTarget(user.id, pageId);
  if ("error" in target) return target;
  await prisma.page.update({ where: { id: pageId }, data: { deletedAt: new Date(), deletedById: user.id } });
  closeDocuments([pageId, ...target.descendants]);
  notifyChildrenChanged(target.parentId);
  return { parentId: target.parentId };
}


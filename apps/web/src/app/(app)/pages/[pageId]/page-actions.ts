"use server";

import { atLeast, getGroupAccessForPage, getPageAccess, getTreeWithAccess } from "shared";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { requireUser } from "@/lib/auth/session";
import { recordAudit, userLabel } from "@/lib/audit";
import { closeDocuments, notifyChildrenChanged, reconnectDocuments } from "@/lib/collab-events";
import { displayTitle } from "@/lib/page-title";

export type PageInfo = {
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  // Groups with MANAGE on this page (granted here or inherited).
  ownerGroups: string[];
};

const nameOf = (u: { name: string | null; emailEnc: Uint8Array | null } | null) => (u ? displayName(u) : null);

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
      createdBy: { select: { name: true, emailEnc: true } },
      updatedBy: { select: { name: true, emailEnc: true } },
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
    createdBy: (await nameOf(page.createdBy)) ?? "",
    createdAt: page.createdAt.toISOString(),
    // Not edited since it was created: the creator was the last to touch it.
    updatedBy: (await nameOf(page.updatedBy)) ?? (await nameOf(page.createdBy)),
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
  const { pages, access, live, locks } = await getTreeWithAccess(prisma, userId, page.rootId);
  if (!live.has(pageId) || !atLeast(access.get(pageId) ?? null, "EDIT")) return { error: CANNOT_DELETE };
  if (!page.parentId) return { error: "ナレッジルートのページは削除できません。" };
  const descendants = liveDescendants(pages, live, pageId);
  if (locks.has(pageId)) return { error: "このページはロックされているため、削除できません。先にロックを解除してください。" };
  if (descendants.some((id) => locks.has(id))) {
    return { error: "ロックされている子ページが含まれているため、削除できません。" };
  }
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

const CANNOT_LOCK = "このページはロックできません。";

// Locks the page: read-only for everyone, editors included, until unlocked.
// `withChildren` extends the lock to everything under it, now and later.
// Needs EDIT on the page — and, with child pages, on all of them, so a lock
// can't freeze pages the caller couldn't edit anyway.
export async function lockPage(pageId: string, withChildren: boolean): Promise<{ error?: string }> {
  const user = await requireUser();
  if (typeof pageId !== "string" || typeof withChildren !== "boolean") return { error: CANNOT_LOCK };
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { rootId: true, title: true } });
  if (!page) return { error: CANNOT_LOCK };
  const { pages, access, live, locks } = await getTreeWithAccess(prisma, user.id, page.rootId);
  if (!live.has(pageId) || !atLeast(access.get(pageId) ?? null, "EDIT")) return { error: CANNOT_LOCK };
  if (locks.has(pageId)) return { error: "このページはすでにロックされています。" };
  const descendants = liveDescendants(pages, live, pageId);
  if (withChildren && descendants.some((id) => !atLeast(access.get(id) ?? null, "EDIT"))) {
    return { error: "編集の権限がない子ページが含まれているため、子ページも含めたロックはできません。" };
  }
  // Written with SQL: a lock isn't an edit, so "updated at" must not change.
  await prisma.$executeRaw`
    UPDATE "Page" SET "lockedAt" = now(), "lockedById" = ${user.id}, "lockSubtree" = ${withChildren}
    WHERE "id" = ${pageId} AND "lockedAt" IS NULL`;
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.lock",
    `ページ「${displayTitle(page.title)}」をロック${withChildren ? "（子ページも含む）" : ""}`,
    { pageId, withChildren },
  );
  // Open editors reconnect and come back read-only.
  reconnectDocuments(withChildren ? [pageId, ...descendants] : [pageId]);
  return {};
}

// Unlocks the page. Needs EDIT on it; anyone with EDIT may, not only the
// person who locked it. Only works on the page that holds the lock: a page
// locked through a page above it is unlocked there.
export async function unlockPage(pageId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const CANNOT_UNLOCK = "このページのロックは解除できません。";
  if (typeof pageId !== "string") return { error: CANNOT_UNLOCK };
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { rootId: true, title: true, lockedAt: true, lockSubtree: true },
  });
  if (!page) return { error: CANNOT_UNLOCK };
  const { pages, access, live, locks } = await getTreeWithAccess(prisma, user.id, page.rootId);
  if (!live.has(pageId) || !atLeast(access.get(pageId) ?? null, "EDIT")) return { error: CANNOT_UNLOCK };
  if (!locks.has(pageId)) return { error: "このページはロックされていません。" };
  if (!page.lockedAt) {
    return { error: "上位のページのロックが効いています。ロックしているページで解除してください。" };
  }
  await prisma.$executeRaw`
    UPDATE "Page" SET "lockedAt" = NULL, "lockedById" = NULL, "lockSubtree" = false WHERE "id" = ${pageId}`;
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.unlock",
    `ページ「${displayTitle(page.title)}」のロックを解除`,
    { pageId, withChildren: page.lockSubtree },
  );
  reconnectDocuments(page.lockSubtree ? [pageId, ...liveDescendants(pages, live, pageId)] : [pageId]);
  return {};
}

import { MAX_PAGE_DEPTH, PAGE_ORDER, type PageAccess, type Prisma, atLeast, getGroupAccessForPage, isPersonalRoot } from "shared";
import { getTreeWithAccess } from "@/lib/page-access";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";

// Moving a page (with its subtree) under another parent, possibly in another
// knowledge root, and/or changing its position among its siblings.
//
// - Same parent (reorder only): EDIT on the parent. Nothing about access
//   changes.
// - New parent: EDIT on the page, on every live page under it, and on the new
//   parent. The subtree's access then comes from the new place, so the
//   caller records it in the audit log and reconnects open editors.
//
// Positions are renumbered for all of the new parent's children (deleted
// ones included, so restoring them keeps their place). Position and rootId
// are written with SQL so the pages' updatedAt — shown as "updated at" — stays
// the time of the last content edit.


export type AccessChange = { group: string; before: PageAccess | null; after: PageAccess | null };

export type MovePlan = {
  pageId: string;
  title: string;
  fromParentId: string;
  // Null when the user can't see the current parent (a page shared without it).
  fromParentTitle: string | null;
  toParentId: string;
  toParentTitle: string;
  // Insert before this sibling; null = at the end.
  beforeId: string | null;
  parentChanges: boolean;
  fromRootId: string;
  toRootId: string;
  // Title of the destination knowledge root's root page, for cross-root moves.
  toRootTitle: string | null;
  // The page and everything under it, deleted pages included (they move too).
  subtreeIds: string[];
  liveDescendantIds: string[];
  accessChanges: AccessChange[];
};

export async function planMove(
  userId: string,
  pageId: unknown,
  parentId: unknown,
  beforeId: unknown,
): Promise<MovePlan | { error: string }> {
  const t = await getTranslations("pageMove");
  const CANNOT_MOVE = t("cannotMove");
  const STALE = t("stale");
  if (typeof pageId !== "string" || typeof parentId !== "string") return { error: CANNOT_MOVE };
  if (beforeId !== null && typeof beforeId !== "string") return { error: CANNOT_MOVE };
  const [page, parent] = await Promise.all([
    prisma.page.findUnique({ where: { id: pageId }, select: { rootId: true, parentId: true, title: true } }),
    prisma.page.findUnique({ where: { id: parentId }, select: { rootId: true, title: true } }),
  ]);
  if (!page) return { error: CANNOT_MOVE };
  if (!page.parentId) return { error: t("rootPage") };

  const source = await getTreeWithAccess(prisma, userId, page.rootId);
  if (!source.live.has(pageId) || !source.access.has(pageId)) return { error: CANNOT_MOVE };
  const dest = !parent ? null : parent.rootId === page.rootId ? source : await getTreeWithAccess(prisma, userId, parent.rootId);
  // Same message for a missing page and one the user can't edit.
  if (!parent || !dest || !dest.live.has(parentId) || !atLeast(dest.access.get(parentId) ?? null, "EDIT")) {
    return { error: t("noEditDestination") };
  }
  if (beforeId !== null) {
    const before = dest.pages.find((p) => p.id === beforeId);
    if (!before || before.parentId !== parentId || !dest.live.has(beforeId) || beforeId === pageId) {
      return { error: STALE };
    }
  }

  // A personal root's pages stay in it, and nothing comes in from outside:
  // moving would share them, or take pages away from the people who could
  // see them.
  if (parent.rootId !== page.rootId && ((await isPersonalRoot(prisma, page.rootId)) || (await isPersonalRoot(prisma, parent.rootId)))) {
    return { error: t("personalBoundary") };
  }

  // A locked page stays where it is, also among its siblings. A page locked
  // on its own doesn't stop its child pages being reordered or others being
  // moved under it; a lock covering its child pages does.
  if (source.locks.has(pageId)) {
    return { error: t("locked") };
  }
  if (dest.locks.get(parentId)?.coversChildren) {
    return { error: t("destinationLocked") };
  }

  const childrenOf = new Map<string, string[]>();
  for (const p of source.pages) {
    if (p.parentId) childrenOf.set(p.parentId, [...(childrenOf.get(p.parentId) ?? []), p.id]);
  }
  const subtreeIds: string[] = [];
  let height = 0;
  const walk = (id: string, level: number) => {
    if (level > MAX_PAGE_DEPTH || subtreeIds.includes(id)) return;
    subtreeIds.push(id);
    height = Math.max(height, level);
    for (const child of childrenOf.get(id) ?? []) walk(child, level + 1);
  };
  walk(pageId, 0);
  const liveDescendantIds = subtreeIds.slice(1).filter((id) => source.live.has(id));
  const parentChanges = page.parentId !== parentId;

  if (parentChanges) {
    if (!atLeast(source.access.get(pageId) ?? null, "EDIT")) {
      return { error: t("noEdit") };
    }
    if (liveDescendantIds.some((id) => !atLeast(source.access.get(id) ?? null, "EDIT"))) {
      return { error: t("noEditChild") };
    }
    if (liveDescendantIds.some((id) => source.locks.has(id))) {
      return { error: t("lockedChild") };
    }
    if (subtreeIds.includes(parentId)) {
      return { error: t("intoItself") };
    }
    const parentOf = new Map(dest.pages.map((p) => [p.id, p.parentId]));
    let depth = 0;
    for (let cursor = parentOf.get(parentId) ?? null; cursor && depth <= MAX_PAGE_DEPTH; depth++) {
      cursor = parentOf.get(cursor) ?? null;
    }
    if (depth + 1 + height > MAX_PAGE_DEPTH) {
      return { error: t("tooDeep", { max: MAX_PAGE_DEPTH }) };
    }
  }

  const titleIn = (tree: typeof source, id: string | null | undefined) => {
    if (!id || !tree.access.has(id)) return null;
    return tree.pages.find((p) => p.id === id)?.title ?? null;
  };
  const destRootPageId = dest.pages.find((p) => p.parentId === null)?.id;
  return {
    pageId,
    title: page.title,
    fromParentId: page.parentId,
    fromParentTitle: titleIn(source, page.parentId),
    toParentId: parentId,
    toParentTitle: parent.title,
    beforeId,
    parentChanges,
    fromRootId: page.rootId,
    toRootId: parent.rootId,
    toRootTitle: parent.rootId !== page.rootId ? titleIn(dest, destRootPageId) : null,
    subtreeIds,
    liveDescendantIds,
    accessChanges: parentChanges ? await accessChangesOf(pageId, parentId) : [],
  };
}

// How each group's access to the moved page changes. Its own grants stay;
// everything else is inherited from the new parent instead of the old one.
// If the page itself is unchanged for every group, so is its whole subtree.
async function accessChangesOf(pageId: string, newParentId: string): Promise<AccessChange[]> {
  const [before, inherited, own] = await Promise.all([
    getGroupAccessForPage(prisma, pageId),
    getGroupAccessForPage(prisma, newParentId),
    prisma.pageGrant.findMany({ where: { pageId }, select: { groupId: true, access: true } }),
  ]);
  const after = new Map(inherited);
  for (const g of own) after.set(g.groupId, g.access);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((id) => before.get(id) !== after.get(id));
  if (changed.length === 0) return [];
  const groups = await prisma.group.findMany({
    where: { id: { in: changed } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return groups.map((g) => ({ group: g.name, before: before.get(g.id) ?? null, after: after.get(g.id) ?? null }));
}

export class MoveConflictError extends Error {
  constructor() {
    super("The page tree changed during the move");
  }
}

export async function executeMove(plan: MovePlan): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (plan.parentChanges) {
      // Re-check for a cycle against a concurrent move of an ancestor.
      for (let id: string | null = plan.toParentId, i = 0; id && i <= MAX_PAGE_DEPTH; i++) {
        if (id === plan.pageId) throw new MoveConflictError();
        id = (await tx.page.findUnique({ where: { id }, select: { parentId: true } }))?.parentId ?? null;
      }
      await tx.$executeRaw`UPDATE "Page" SET "parentId" = ${plan.toParentId} WHERE "id" = ${plan.pageId}`;
      if (plan.toRootId !== plan.fromRootId) {
        await tx.$executeRaw`UPDATE "Page" SET "rootId" = ${plan.toRootId} WHERE "id" = ANY(${plan.subtreeIds}::text[])`;
        await tx.fileObject.updateMany({ where: { pageId: { in: plan.subtreeIds } }, data: { rootId: plan.toRootId } });
      }
    }
    await placeAmongSiblings(tx, plan.toParentId, plan.pageId, plan.beforeId);
  });
}

// Puts `pageId` before `beforeId` (or last) among `parentId`'s children and
// renumbers them 0, 1, 2, …
async function placeAmongSiblings(
  tx: Prisma.TransactionClient,
  parentId: string,
  pageId: string,
  beforeId: string | null,
): Promise<void> {
  const siblings = await tx.page.findMany({
    where: { parentId, id: { not: pageId } },
    orderBy: PAGE_ORDER,
    select: { id: true, sortOrder: true },
  });
  const index = beforeId === null ? siblings.length : siblings.findIndex((s) => s.id === beforeId);
  if (index < 0) throw new MoveConflictError();
  const ordered = [...siblings.slice(0, index).map((s) => s.id), pageId, ...siblings.slice(index).map((s) => s.id)];
  const current = new Map(siblings.map((s) => [s.id, s.sortOrder]));
  const changed = ordered.map((id, i) => ({ id, i })).filter(({ id, i }) => current.get(id) !== i);
  if (changed.length === 0) return;
  await tx.$executeRaw`
    UPDATE "Page" AS p SET "sortOrder" = v.ord
    FROM unnest(${changed.map((c) => c.id)}::text[], ${changed.map((c) => c.i)}::int[]) AS v(id, ord)
    WHERE p."id" = v.id`;
}

// Position for a page newly placed under `parentId` (created or restored
// elsewhere): after its current children.
export async function nextSortOrder(parentId: string): Promise<number> {
  const last = await prisma.page.aggregate({ where: { parentId }, _max: { sortOrder: true } });
  return (last._max.sortOrder ?? -1) + 1;
}

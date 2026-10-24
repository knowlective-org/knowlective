"use server";

import { MAX_PAGE_DEPTH, atLeast } from "shared";
import { getVisibleTrees } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { recordAudit, userLabel } from "@/lib/audit";
import { notifyChildrenChanged, reconnectDocuments } from "@/lib/collab-events";
import { getTranslations } from "next-intl/server";
import { auditTranslator } from "@/i18n/audit";
import { displayTitleWith, getDisplayTitle } from "@/i18n/display-title";
import { type AccessChange, MoveConflictError, executeMove, planMove } from "@/lib/page-move";

// Page moves and reordering (lib/page-move.ts), from the sidebar's drag and
// drop and the page menu's "move".

export type MoveCheck = {
  parentChanges: boolean;
  toParentTitle: string;
  // Set when the page goes to another knowledge root.
  toRootTitle: string | null;
  descendants: number;
  accessChanges: AccessChange[];
};

// What a move would do, for the confirmation shown before a page changes
// parent. Nothing is changed.
export async function checkMovePage(
  pageId: string,
  parentId: string,
  beforeId: string | null,
): Promise<MoveCheck | { error: string }> {
  const user = await requireUser();
  const plan = await planMove(user.id, pageId, parentId, beforeId);
  if ("error" in plan) return plan;
  return {
    parentChanges: plan.parentChanges,
    toParentTitle: plan.toParentTitle,
    toRootTitle: plan.toRootTitle,
    descendants: plan.liveDescendantIds.length,
    accessChanges: plan.accessChanges,
  };
}

// Moves `pageId` under `parentId`, before `beforeId` (null = last). Checked
// again here: the confirmation may be stale.
export async function movePage(pageId: string, parentId: string, beforeId: string | null): Promise<{ error?: string }> {
  const user = await requireUser();
  const plan = await planMove(user.id, pageId, parentId, beforeId);
  if ("error" in plan) return plan;
  try {
    await executeMove(plan);
  } catch (err) {
    if (err instanceof MoveConflictError) {
      return { error: (await getTranslations("pageMove"))("stale") };
    }
    throw err;
  }

  if (plan.parentChanges) {
    const audit = await auditTranslator();
    const displayTitle = displayTitleWith(audit);
    await recordAudit(
      { userId: user.id, label: userLabel(user) },
      "page.move",
      audit("audit.pageMove", {
        title: displayTitle(plan.title),
        descendants: plan.liveDescendantIds.length,
        from: plan.fromParentTitle !== null ? audit("audit.pageMoveFrom", { title: displayTitle(plan.fromParentTitle) }) : "",
        to: displayTitle(plan.toParentTitle),
        root: plan.toRootTitle !== null ? audit("audit.pageMoveRoot", { root: displayTitle(plan.toRootTitle) }) : "",
      }),
      {
        pageId: plan.pageId,
        fromParentId: plan.fromParentId,
        toParentId: plan.toParentId,
        fromRootId: plan.fromRootId,
        toRootId: plan.toRootId,
        descendants: plan.liveDescendantIds.length,
        accessChanges: plan.accessChanges,
      },
    );
    // Access may have changed: open editors reconnect and are checked again.
    reconnectDocuments([plan.pageId, ...plan.liveDescendantIds]);
    notifyChildrenChanged(plan.fromParentId);
  }
  notifyChildrenChanged(plan.toParentId);
  return {};
}

export type MoveDestination = {
  id: string;
  title: string;
  depth: number;
  // EDIT on it (and not the page itself or under it).
  selectable: boolean;
  // The page's current parent.
  current: boolean;
};

export type MoveDestinationGroup = { label: string; pages: MoveDestination[] };

// Every page the user can see, per knowledge root in tree order, for the
// page menu's move dialog. The page and its subtree are left out.
export async function loadMoveDestinations(pageId: string): Promise<MoveDestinationGroup[] | { error: string }> {
  const user = await requireUser();
  const page = typeof pageId === "string"
    ? await prisma.page.findUnique({ where: { id: pageId }, select: { parentId: true } })
    : null;
  const trees = await getVisibleTrees(prisma, user.id);
  if (!page || !trees.some((t) => t.pages.some((p) => p.id === pageId))) {
    return { error: (await getTranslations("pageMove"))("cannotMove") };
  }

  const [t, displayTitle] = await Promise.all([getTranslations("moveDialog"), getDisplayTitle()]);
  const groups: MoveDestinationGroup[] = [];
  const shared: MoveDestination[] = [];
  // A page in a personal root can only move within it; others never into one.
  const fromPersonal = trees.find((t) => t.pages.some((p) => p.id === pageId))?.personal ?? false;
  for (const tree of trees) {
    if (tree.personal !== fromPersonal) continue;
    const childrenOf = new Map<string, typeof tree.pages>();
    for (const p of tree.pages) {
      if (p.parentId) childrenOf.set(p.parentId, [...(childrenOf.get(p.parentId) ?? []), p]);
    }
    const byId = new Map(tree.pages.map((p) => [p.id, p]));
    const visit = (id: string, depth: number, out: MoveDestination[]) => {
      const p = byId.get(id);
      // Skip the page being moved, with its subtree.
      if (!p || id === pageId || depth > MAX_PAGE_DEPTH) return;
      out.push({
        id,
        title: displayTitle(p.title),
        depth,
        selectable: atLeast(p.access, "EDIT"),
        current: id === page.parentId,
      });
      for (const child of childrenOf.get(id) ?? []) visit(child.id, depth + 1, out);
    };
    for (const entryId of tree.entryIds) {
      if (entryId === tree.rootPageId) {
        const pages: MoveDestination[] = [];
        visit(entryId, 0, pages);
        groups.push({ label: displayTitle(byId.get(entryId)?.title ?? ""), pages });
      } else {
        visit(entryId, 0, shared);
      }
    }
  }
  if (shared.length > 0) groups.push({ label: t("sharedPages"), pages: shared });
  return groups;
}

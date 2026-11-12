"use server";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getPageAccess, getVisibleTree, getVisibleTrees } from "@/lib/page-access";
import { resolveShortcuts } from "@/lib/shortcuts";

export type ChildListItem = {
  id: string;
  title: string;
  icon: string | null;
  // Where the link goes: the page, or a shortcut's target (null: a shortcut
  // the viewer can't open, listed without a title).
  href: string | null;
  shortcut: boolean;
};

// Every child page of `pageId` the viewer can open, in sibling order: the
// full list behind the sidebar's "N more pages" (DocTree, for a page with
// many children) and the page menu's "child pages". Someone not logged in
// gets the public ones. Null when the page can't be opened.
export async function loadChildList(pageId: string): Promise<ChildListItem[] | null> {
  const user = await getCurrentUser();
  const userId = user?.id ?? null;
  if (typeof pageId !== "string") return null;
  const access = await getPageAccess(prisma, userId, pageId);
  if (!access) return null;
  // Every tree the viewer sees, so shortcuts resolve to the targets they can
  // open (and the page's own tree, which isn't among them when it's someone
  // else's personal root opened by an auditor).
  const trees = await getVisibleTrees(prisma, userId);
  if (!trees.some((t) => t.rootId === access.rootId)) {
    const own = await getVisibleTree(prisma, userId, access.rootId);
    if (own) trees.push(own);
  }
  const tree = resolveShortcuts(trees).find((t) => t.rootId === access.rootId);
  return (tree?.pages ?? [])
    .filter((p) => p.parentId === pageId)
    .map((p) => ({
      id: p.id,
      title: p.title,
      icon: p.icon,
      href: p.shortcut ? (p.shortcut.targetId ? `/pages/${p.shortcut.targetId}` : null) : `/pages/${p.id}`,
      shortcut: p.shortcut !== null,
    }));
}

import { MAX_PAGE_DEPTH, atLeast, getVisibleTrees } from "shared";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/session";
import type { SidebarInfo } from "@/app/(app)/pages/[pageId]/page-view";

// The knowledge roots in the order the user chose (User.rootOrder); roots
// they haven't placed keep their creation order, after the placed ones.
function orderRoots<T extends { rootId: string }>(trees: T[], order: string[]): T[] {
  const position = new Map(order.map((id, i) => [id, i]));
  const rank = (t: T) => position.get(t.rootId) ?? Number.MAX_SAFE_INTEGER;
  // Array.prototype.sort is stable: creation order is kept among equals.
  return [...trees].sort((a, b) => rank(a) - rank(b));
}

// Everything the sidebar needs for a signed-in user.
export async function loadSidebar(user: CurrentUser): Promise<SidebarInfo> {
  const [visible, prefs] = await Promise.all([
    getVisibleTrees(prisma, user.id),
    prisma.user.findUnique({ where: { id: user.id }, select: { rootOrder: true } }),
  ]);
  const trees = orderRoots(visible, prefs?.rootOrder ?? []);
  const isManager = user.siteRole === "SITE_ADMIN" || user.siteRole === "CONTENT_MANAGER";
  return {
    trees: trees.map((t) => ({
      rootId: t.rootId,
      rootPageId: t.rootPageId,
      personal: t.personal,
      entryIds: t.entryIds,
      pages: t.pages.map((p) => ({
        id: p.id,
        title: p.title,
        icon: p.icon,
        parentId: p.parentId,
        canEdit: atLeast(p.access, "EDIT"),
        locked: p.lock !== null,
        canAddChild: atLeast(p.access, "EDIT") && !p.lock?.coversChildren,
      })),
    })),
    maxDepth: MAX_PAGE_DEPTH,
    userName: user.name ?? user.email,
    canCreateRoot: isManager,
    canOpenAdmin: isManager,
  };
}

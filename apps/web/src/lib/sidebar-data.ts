import { MAX_PAGE_DEPTH, atLeast, getVisibleTrees } from "shared";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/session";
import type { SidebarInfo } from "@/app/(app)/pages/[pageId]/page-view";

// Everything the sidebar needs for a signed-in user.
export async function loadSidebar(user: CurrentUser): Promise<SidebarInfo> {
  const trees = await getVisibleTrees(prisma, user.id);
  const isManager = user.siteRole === "SITE_ADMIN" || user.siteRole === "CONTENT_MANAGER";
  return {
    trees: trees.map((t) => ({
      rootId: t.rootId,
      rootPageId: t.rootPageId,
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

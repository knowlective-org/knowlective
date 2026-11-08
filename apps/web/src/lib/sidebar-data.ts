import { unreadNotificationPages } from "@/lib/notifications";
import { MAX_PAGE_DEPTH, atLeast } from "shared";
import { getVisibleTrees } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/brand";
import type { CurrentUser } from "@/lib/auth/session";
import type { SidebarInfo } from "@/app/(app)/pages/[pageId]/page-view";
import { orderRoots } from "@/lib/root-order";

// Everything the sidebar needs for a signed-in user.
export async function loadSidebar(user: CurrentUser): Promise<SidebarInfo> {
  const [visible, prefs, brand, unread] = await Promise.all([
    getVisibleTrees(prisma, user.id),
    prisma.user.findUnique({ where: { id: user.id }, select: { rootOrder: true } }),
    getBrand(),
    unreadNotificationPages(user.id),
  ]);
  // Counted like the list shows them: on pages the user can open now.
  const visibleIds = new Set(visible.flatMap((t) => t.pages.map((p) => p.id)));
  const unreadNotifications = unread.filter((pageId) => visibleIds.has(pageId)).length;
  const trees = orderRoots(visible, prefs?.rootOrder ?? []);
  const isManager = user.siteRole === "SITE_ADMIN" || user.siteRole === "CONTENT_MANAGER";
  return {
    trees: trees.map(sidebarTree),
    maxDepth: MAX_PAGE_DEPTH,
    userName: user.name ?? user.email,
    canCreateRoot: isManager,
    canOpenAdmin: isManager,
    guest: false,
    brand,
    unreadNotifications,
  };
}

// The sidebar of someone not logged in: the public pages only, their roots in
// the order set in the admin console (InstanceConfig.publicRootOrder).
export async function loadPublicSidebar(): Promise<SidebarInfo> {
  const [trees, brand] = await Promise.all([publicTrees(), getBrand()]);
  return {
    trees: trees.map(sidebarTree),
    maxDepth: MAX_PAGE_DEPTH,
    userName: "",
    canCreateRoot: false,
    canOpenAdmin: false,
    guest: true,
    brand,
    unreadNotifications: 0,
  };
}

// The knowledge roots with public pages, as someone not logged in sees them, in their order.
export async function publicTrees() {
  const [visible, config] = await Promise.all([
    getVisibleTrees(prisma, null),
    prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { publicRootOrder: true } }),
  ]);
  return orderRoots(visible, config?.publicRootOrder ?? []);
}

function sidebarTree(t: Awaited<ReturnType<typeof getVisibleTrees>>[number]) {
  return {
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
  };
}

import { unreadNotificationPages } from "@/lib/notifications";
import { MAX_PAGE_DEPTH, PUBLIC_GROUP, atLeast } from "shared";
import { getVisibleTrees } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/brand";
import type { CurrentUser } from "@/lib/auth/session";
import type { SidebarInfo } from "@/app/(app)/pages/[pageId]/page-view";
import { orderRoots } from "@/lib/root-order";
import { resolveShortcuts } from "@/lib/shortcuts";
import { rootFaviconUrls } from "@/lib/root-favicon";
import { avatarLook } from "@/lib/avatar-check";

// Everything the sidebar needs for a signed-in user.
export async function loadSidebar(user: CurrentUser): Promise<SidebarInfo> {
  const [visible, prefs, brand, unread, publicIds] = await Promise.all([
    getVisibleTrees(prisma, user.id),
    prisma.user.findUnique({ where: { id: user.id }, select: { rootOrder: true, sidebarChildLimit: true, avatarUpdatedAt: true, avatarColor: true, avatarSeed: true } }),
    getBrand(),
    unreadNotificationPages(user.id),
    publicPageIds(),
  ]);
  // Counted like the list shows them: on pages the user can open now.
  const visibleIds = new Set(visible.flatMap((t) => t.pages.map((p) => p.id)));
  const unreadNotifications = unread.filter((pageId) => visibleIds.has(pageId)).length;
  const trees = orderRoots(resolveShortcuts(visible), prefs?.rootOrder ?? []);
  const isManager = user.siteRole === "SITE_ADMIN" || user.siteRole === "CONTENT_MANAGER";
  const favicons = await rootFavicons(trees);
  return {
    trees: trees.map((t) => sidebarTree(t, favicons, publicIds)),
    maxDepth: MAX_PAGE_DEPTH,
    userName: user.name ?? user.email,
    userId: user.id,
    userAvatar: avatarLook({ id: user.id, ...prefs }),
    canCreateRoot: isManager,
    canOpenAdmin: isManager,
    guest: false,
    brand,
    unreadNotifications,
    childLimit: prefs?.sidebarChildLimit ?? null,
  };
}

// The sidebar of someone not logged in: the public pages only, their roots in
// the order set in the admin console (InstanceConfig.publicRootOrder).
export async function loadPublicSidebar(): Promise<SidebarInfo> {
  const [trees, brand] = await Promise.all([publicTrees(), getBrand()]);
  const favicons = await rootFavicons(trees);
  return {
    trees: trees.map((t) => sidebarTree(t, favicons)),
    maxDepth: MAX_PAGE_DEPTH,
    userName: "",
    canCreateRoot: false,
    canOpenAdmin: false,
    guest: true,
    brand,
    unreadNotifications: 0,
    childLimit: null,
  };
}

// The knowledge roots with public pages, as someone not logged in sees them, in their order.
export async function publicTrees() {
  const [visible, config] = await Promise.all([
    getVisibleTrees(prisma, null),
    prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { publicRootOrder: true } }),
  ]);
  return orderRoots(resolveShortcuts(visible), config?.publicRootOrder ?? []);
}

type VisibleTree = ReturnType<typeof resolveShortcuts>[number];

// The pages someone not logged in can open (marked in a signed-in user's
// sidebar). Only worked out when pages may be public and some page is.
async function publicPageIds(): Promise<Set<string>> {
  const [config, published] = await Promise.all([
    prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { publicPagesAllowed: true } }),
    prisma.pageGrant.findFirst({ where: { group: { builtIn: PUBLIC_GROUP }, access: { not: "NONE" }, page: { deletedAt: null } }, select: { pageId: true } }),
  ]);
  if (!config?.publicPagesAllowed || !published) return new Set();
  const trees = await getVisibleTrees(prisma, null);
  return new Set(trees.flatMap((t) => t.pages.map((p) => p.id)));
}

// The roots' favicons (lib/root-favicon.ts), of the roots whose root page
// the viewer can open (as for the root's name).
function rootFavicons(trees: VisibleTree[]) {
  return rootFaviconUrls(trees.filter((t) => t.rootPageId && t.entryIds.includes(t.rootPageId)).map((t) => t.rootId));
}

// publicIds: the pages to mark as public (none in the sidebar of someone not
// logged in, where every page is).
function sidebarTree(t: VisibleTree, favicons: Map<string, string>, publicIds: Set<string> = new Set()) {
  return {
    rootId: t.rootId,
    rootPageId: t.rootPageId,
    favicon: (t.rootPageId && t.entryIds.includes(t.rootPageId) && favicons.get(t.rootId)) || null,
    personal: t.personal,
    entryIds: t.entryIds,
    pages: t.pages.map((p) => ({
      id: p.id,
      title: p.title,
      icon: p.icon,
      parentId: p.parentId,
      updatedAt: p.updatedAt.getTime(),
      isPublic: publicIds.has(p.id),
      canEdit: atLeast(p.access, "EDIT"),
      locked: p.lock !== null,
      // A shortcut has no child pages.
      // (A presentation's slides are added on its own screen.)
      canAddChild: atLeast(p.access, "EDIT") && !p.lock?.coversChildren && !p.shortcut && p.kind !== "PRESENTATION",
      presentation: p.kind === "PRESENTATION",
      // A shortcut: the page it opens (null: one the viewer can't open).
      shortcut: p.shortcut,
    })),
  };
}

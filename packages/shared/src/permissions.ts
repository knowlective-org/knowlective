import type { PageAccess, Prisma, PrismaClient } from "@prisma/client";

// Page permissions. Access comes only from group grants (PageGrant):
//
// - A grant applies to its page and every descendant.
// - For one group, the grant nearest the page (walking up) wins, so a lower
//   grant can narrow access (EDIT on the root, VIEW on a subtree).
// - Across the user's groups, the strongest access wins.
// - No grant on the page or any ancestor (for any of the user's groups) means
//   no access at all. Site roles never grant page access.
// - Deleted pages, and everything under them, are inaccessible.
//
// Trees are evaluated per knowledge root in memory: every page carries
// rootId, so one query loads a root's whole tree.

export const ACCESS_RANK: Record<PageAccess, number> = { VIEW: 1, EDIT: 2, MANAGE: 3 };

export function atLeast(access: PageAccess | null, required: PageAccess): boolean {
  return access !== null && ACCESS_RANK[access] >= ACCESS_RANK[required];
}

type TreePage = { id: string; parentId: string | null };
type Grant = { pageId: string; groupId: string; access: PageAccess };

// Effective access of every reachable page in one tree, for a user in
// `groupIds`. Pages missing from the result are inaccessible.
export function computeTreeAccess(
  pages: TreePage[],
  grants: Grant[],
  groupIds: ReadonlySet<string>,
  maxDepth: number,
): Map<string, PageAccess> {
  const childrenOf = new Map<string | null, TreePage[]>();
  for (const p of pages) childrenOf.set(p.parentId, [...(childrenOf.get(p.parentId) ?? []), p]);
  const grantsOn = new Map<string, Grant[]>();
  for (const g of grants) {
    if (!groupIds.has(g.groupId)) continue;
    grantsOn.set(g.pageId, [...(grantsOn.get(g.pageId) ?? []), g]);
  }

  const result = new Map<string, PageAccess>();
  const visit = (page: TreePage, inherited: ReadonlyMap<string, PageAccess>, depth: number) => {
    if (depth > maxDepth || result.has(page.id)) return; // depth cap / cycle guard
    let perGroup = inherited;
    const own = grantsOn.get(page.id);
    if (own) {
      const next = new Map(inherited);
      for (const g of own) next.set(g.groupId, g.access);
      perGroup = next;
    }
    let best: PageAccess | null = null;
    for (const access of perGroup.values()) {
      if (best === null || ACCESS_RANK[access] > ACCESS_RANK[best]) best = access;
    }
    if (best) result.set(page.id, best);
    for (const child of childrenOf.get(page.id) ?? []) visit(child, perGroup, depth + 1);
  };
  for (const root of childrenOf.get(null) ?? []) visit(root, new Map(), 0);
  return result;
}

export const MAX_PAGE_DEPTH = 50;

// Built-in group every enabled user implicitly belongs to (no GroupMember rows).
export const ALL_USERS_GROUP = "all_users";

async function userGroupIds(prisma: PrismaClient, userId: string): Promise<Set<string>> {
  const [rows, user, allUsers] = await Promise.all([
    prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } }),
    prisma.group.findUnique({ where: { builtIn: ALL_USERS_GROUP }, select: { id: true } }),
  ]);
  const ids = new Set(rows.map((r) => r.groupId));
  if (allUsers && user && !user.disabledAt) ids.add(allUsers.id);
  return ids;
}

// Sibling order: the user-set position, then creation order for ties.
// Every tree is loaded in this order, so children come out sorted.
export const PAGE_ORDER = [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] satisfies Prisma.PageOrderByWithRelationInput[];

// Non-deleted pages of one knowledge root. Descendants of a deleted page
// are dropped too, because the tree walk starts from parentless pages and
// never passes through a deleted one.
async function loadTree(prisma: PrismaClient, rootId: string) {
  return prisma.page.findMany({
    where: { rootId, deletedAt: null },
    select: { id: true, parentId: true, title: true, icon: true, createdAt: true },
    orderBy: PAGE_ORDER,
  });
}

async function loadGrants(prisma: PrismaClient, rootId: string, groupIds: Set<string>) {
  if (groupIds.size === 0) return [];
  return prisma.pageGrant.findMany({
    where: { groupId: { in: [...groupIds] }, page: { rootId } },
    select: { pageId: true, groupId: true, access: true },
  });
}

// The user's access to one page, or null. Disabled users get null.
export async function getPageAccess(
  prisma: PrismaClient,
  userId: string,
  pageId: string,
): Promise<{ access: PageAccess; rootId: string } | null> {
  const [page, user] = await Promise.all([
    prisma.page.findUnique({ where: { id: pageId }, select: { rootId: true, deletedAt: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } }),
  ]);
  if (!page || page.deletedAt || !user || user.disabledAt) return null;
  const groupIds = await userGroupIds(prisma, userId);
  if (groupIds.size === 0) return null;
  const [tree, grants] = await Promise.all([loadTree(prisma, page.rootId), loadGrants(prisma, page.rootId, groupIds)]);
  if (grants.length === 0) return null;
  const access = computeTreeAccess(tree, grants, groupIds, MAX_PAGE_DEPTH).get(pageId);
  return access ? { access, rootId: page.rootId } : null;
}

// Each group's effective access to `pageId`: its grant nearest the page,
// walking up to the root. Empty for a missing or deleted page (or one under
// a deleted page).
export async function getGroupAccessForPage(
  prisma: PrismaClient,
  pageId: string,
): Promise<Map<string, PageAccess>> {
  const result = new Map<string, PageAccess>();
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { rootId: true, deletedAt: true } });
  if (!page || page.deletedAt) return result;
  const tree = await loadTree(prisma, page.rootId);
  const parentOf = new Map(tree.map((p) => [p.id, p.parentId]));
  if (!parentOf.has(pageId)) return result; // under a deleted page
  const chain: string[] = [];
  for (let id: string | null = pageId; id && chain.length <= MAX_PAGE_DEPTH; id = parentOf.get(id) ?? null) {
    chain.push(id);
  }
  const grants = await prisma.pageGrant.findMany({
    where: { pageId: { in: chain } },
    select: { pageId: true, groupId: true, access: true },
  });
  const depthOf = new Map(chain.map((id, i) => [id, i]));
  const nearest = new Map<string, number>();
  for (const g of grants) {
    const d = depthOf.get(g.pageId)!;
    if (!nearest.has(g.groupId) || d < nearest.get(g.groupId)!) {
      nearest.set(g.groupId, d);
      result.set(g.groupId, g.access);
    }
  }
  return result;
}

// Enabled users who can open `pageId`: the members of every group with
// access to it (any level allows viewing). Used to offer assignees without
// exposing the whole user directory.
export async function getUsersWithPageAccess(
  prisma: PrismaClient,
  pageId: string,
): Promise<{ id: string; name: string | null; email: string }[]> {
  const groupAccess = await getGroupAccessForPage(prisma, pageId);
  const groupIds = [...groupAccess.keys()];
  if (groupIds.length === 0) return [];
  const allUsers = await prisma.group.findUnique({ where: { builtIn: ALL_USERS_GROUP }, select: { id: true } });
  const everyone = allUsers !== null && groupAccess.has(allUsers.id);
  return prisma.user.findMany({
    where: { disabledAt: null, ...(everyone ? {} : { groups: { some: { groupId: { in: groupIds } } } }) },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
}

// One knowledge root's whole tree, deleted pages included, with the user's
// access to each page as if nothing were deleted. For the trash (listing and
// restoring) and for checking a subtree before deleting it. Callers decide
// what deletion means; pages missing from `access` are inaccessible anyway.
export async function getTreeWithAccess(prisma: PrismaClient, userId: string, rootId: string) {
  const [groupIds, user] = await Promise.all([
    userGroupIds(prisma, userId),
    prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } }),
  ]);
  const pages = await prisma.page.findMany({
    where: { rootId },
    select: {
      id: true,
      parentId: true,
      title: true,
      icon: true,
      createdAt: true,
      deletedAt: true,
      deletedById: true,
    },
    orderBy: PAGE_ORDER,
  });
  const grants = !user || user.disabledAt ? [] : await loadGrants(prisma, rootId, groupIds);
  const access = computeTreeAccess(pages, grants, groupIds, MAX_PAGE_DEPTH);
  // Live = not deleted and every ancestor live (what the app shows).
  const byId = new Map(pages.map((p) => [p.id, p]));
  const live = new Set<string>();
  const isLive = (id: string, depth = 0): boolean => {
    if (live.has(id)) return true;
    const page = byId.get(id);
    if (!page || page.deletedAt || depth > MAX_PAGE_DEPTH) return false;
    const ok = page.parentId === null || isLive(page.parentId, depth + 1);
    if (ok) live.add(id);
    return ok;
  };
  for (const p of pages) isLive(p.id);
  return { pages, access, live };
}

export type TrashItem = {
  id: string;
  rootId: string;
  title: string;
  icon: string | null;
  deletedAt: Date;
  deletedById: string | null;
  // The page it was under, if the user can see it (or could, before it was
  // deleted too).
  parent: { id: string; title: string } | null;
  // The original parent is in the trash too (or under a page that is), so
  // this page can only come back under another page — see
  // `suggestedParentId` and getTrash()'s `destinations`.
  parentInTrash: boolean;
  // For parentInTrash items: the nearest live ancestor the user can edit.
  suggestedParentId: string | null;
};

// A live page the user may restore something under (EDIT), in tree order.
export type RestoreDestination = { id: string; title: string; depth: number };

// Pages in the trash the user may restore (EDIT on them), newest first.
// A page deleted together with an ancestor comes back with it and isn't
// listed; a page deleted on its own is, even if its parent was deleted later
// (parentInTrash). `destinations` lists, per knowledge root with such items,
// where they can be restored instead.
export async function getTrash(
  prisma: PrismaClient,
  userId: string,
): Promise<{ items: TrashItem[]; destinations: Record<string, RestoreDestination[]> }> {
  const groupIds = await userGroupIds(prisma, userId);
  if (groupIds.size === 0) return { items: [], destinations: {} };
  const granted = await prisma.page.findMany({
    where: { grants: { some: { groupId: { in: [...groupIds] } } } },
    select: { rootId: true },
    distinct: ["rootId"],
  });
  const withDeleted = await prisma.page.findMany({
    where: { rootId: { in: granted.map((g) => g.rootId) }, deletedAt: { not: null } },
    select: { rootId: true },
    distinct: ["rootId"],
  });

  const items: TrashItem[] = [];
  const destinations: Record<string, RestoreDestination[]> = {};
  for (const { rootId } of withDeleted) {
    const tree = await getTreeWithAccess(prisma, userId, rootId);
    const { pages, access, live } = tree;
    const byId = new Map(pages.map((p) => [p.id, p]));
    const editable = (id: string) => atLeast(access.get(id) ?? null, "EDIT");
    let needsDestinations = false;
    for (const p of pages) {
      if (!p.deletedAt || !p.parentId || !editable(p.id)) continue;
      const parent = byId.get(p.parentId);
      const parentInTrash = !live.has(p.parentId);
      let suggestedParentId: string | null = null;
      if (parentInTrash) {
        needsDestinations = true;
        for (let id = byId.get(p.parentId)?.parentId ?? null, i = 0; id && i <= MAX_PAGE_DEPTH; i++) {
          if (live.has(id) && editable(id)) {
            suggestedParentId = id;
            break;
          }
          id = byId.get(id)?.parentId ?? null;
        }
      }
      items.push({
        id: p.id,
        rootId,
        title: p.title,
        icon: p.icon,
        deletedAt: p.deletedAt,
        deletedById: p.deletedById,
        parent: parent && access.has(parent.id) ? { id: parent.id, title: parent.title } : null,
        parentInTrash,
        suggestedParentId,
      });
    }
    if (needsDestinations) destinations[rootId] = restoreDestinations(tree);
  }
  items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  return { items, destinations };
}

// Live pages the user can edit, depth-first in sibling order, with their
// depth below the root page (for an indented picker).
export function restoreDestinations(tree: Awaited<ReturnType<typeof getTreeWithAccess>>): RestoreDestination[] {
  const { pages, access, live } = tree;
  const result: RestoreDestination[] = [];
  const visit = (parentId: string | null, depth: number) => {
    if (depth > MAX_PAGE_DEPTH) return;
    for (const p of pages) {
      if (p.parentId !== parentId || !live.has(p.id)) continue;
      if (atLeast(access.get(p.id) ?? null, "EDIT")) result.push({ id: p.id, title: p.title, depth });
      visit(p.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

export type VisiblePage = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  access: PageAccess;
};

export type VisibleTree = {
  rootId: string;
  rootPageId: string | null;
  // Pages the user can open, in sibling order (PAGE_ORDER).
  pages: VisiblePage[];
  // Visible pages whose parent isn't visible: where the user's view of this
  // tree starts. The root page, if visible, is always one of them.
  entryIds: string[];
};

// Every page the user can open, grouped by knowledge root.
export async function getVisibleTrees(prisma: PrismaClient, userId: string): Promise<VisibleTree[]> {
  const groupIds = await userGroupIds(prisma, userId);
  if (groupIds.size === 0) return [];
  const rootIds = await prisma.page.findMany({
    where: { grants: { some: { groupId: { in: [...groupIds] } } }, deletedAt: null },
    select: { rootId: true },
    distinct: ["rootId"],
  });
  const roots = await prisma.knowledgeRoot.findMany({
    where: { id: { in: rootIds.map((r) => r.rootId) } },
    select: { id: true, rootPageId: true },
    orderBy: { createdAt: "asc" },
  });

  const trees: VisibleTree[] = [];
  for (const root of roots) {
    const tree = await buildVisibleTree(prisma, root, groupIds);
    if (tree) trees.push(tree);
  }
  return trees;
}

// The user's visible part of one knowledge root (for the page sidebar).
export async function getVisibleTree(
  prisma: PrismaClient,
  userId: string,
  rootId: string,
): Promise<VisibleTree | null> {
  const [groupIds, root] = await Promise.all([
    userGroupIds(prisma, userId),
    prisma.knowledgeRoot.findUnique({ where: { id: rootId }, select: { id: true, rootPageId: true } }),
  ]);
  if (!root || groupIds.size === 0) return null;
  return buildVisibleTree(prisma, root, groupIds);
}

async function buildVisibleTree(
  prisma: PrismaClient,
  root: { id: string; rootPageId: string | null },
  groupIds: Set<string>,
): Promise<VisibleTree | null> {
  const [tree, grants] = await Promise.all([loadTree(prisma, root.id), loadGrants(prisma, root.id, groupIds)]);
  const access = computeTreeAccess(tree, grants, groupIds, MAX_PAGE_DEPTH);
  const pages = tree
    .filter((p) => access.has(p.id))
    .map((p) => ({ id: p.id, parentId: p.parentId, title: p.title, icon: p.icon, access: access.get(p.id)! }));
  if (pages.length === 0) return null;
  const visible = new Set(pages.map((p) => p.id));
  return {
    rootId: root.id,
    rootPageId: root.rootPageId,
    pages,
    entryIds: pages.filter((p) => !p.parentId || !visible.has(p.parentId)).map((p) => p.id),
  };
}

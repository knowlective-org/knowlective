import type { PageAccess, PrismaClient } from "@prisma/client";

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

// Non-deleted pages of one knowledge root. Descendants of a deleted page
// are dropped too, because the tree walk starts from parentless pages and
// never passes through a deleted one.
async function loadTree(prisma: PrismaClient, rootId: string) {
  return prisma.page.findMany({
    where: { rootId, deletedAt: null },
    select: { id: true, parentId: true, title: true, icon: true, createdAt: true },
    orderBy: { createdAt: "asc" },
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

// Enabled users who can open `pageId`: the members of every group whose
// nearest grant (walking up from the page) gives access. Used to offer
// assignees without exposing the whole user directory.
export async function getUsersWithPageAccess(
  prisma: PrismaClient,
  pageId: string,
): Promise<{ id: string; name: string | null; email: string }[]> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { rootId: true, deletedAt: true } });
  if (!page || page.deletedAt) return [];
  const tree = await loadTree(prisma, page.rootId);
  const parentOf = new Map(tree.map((p) => [p.id, p.parentId]));
  if (!parentOf.has(pageId)) return []; // under a deleted page
  const chain: string[] = [];
  for (let id: string | null = pageId; id && chain.length <= MAX_PAGE_DEPTH; id = parentOf.get(id) ?? null) {
    chain.push(id);
  }
  const grants = await prisma.pageGrant.findMany({
    where: { pageId: { in: chain } },
    select: { pageId: true, groupId: true, access: true },
  });
  // Nearest grant per group decides; every PageAccess level allows viewing.
  const depthOf = new Map(chain.map((id, i) => [id, i]));
  const nearest = new Map<string, number>();
  for (const g of grants) {
    const d = depthOf.get(g.pageId)!;
    if (!nearest.has(g.groupId) || d < nearest.get(g.groupId)!) nearest.set(g.groupId, d);
  }
  const groupIds = [...nearest.keys()];
  if (groupIds.length === 0) return [];
  const allUsers = await prisma.group.findUnique({ where: { builtIn: ALL_USERS_GROUP }, select: { id: true } });
  const everyone = allUsers !== null && nearest.has(allUsers.id);
  return prisma.user.findMany({
    where: { disabledAt: null, ...(everyone ? {} : { groups: { some: { groupId: { in: groupIds } } } }) },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
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
  // Pages the user can open, in creation order.
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

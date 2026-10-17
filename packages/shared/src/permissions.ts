import type { PageAccess, Prisma, PrismaClient } from "@prisma/client";
import { loadDataKey } from "./instance";
import { openEmail } from "./personal-data";

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

// Page locks (Page.lockedAt / lockSubtree). A locked page is read-only for
// everyone — editors included — until someone with EDIT on the page holding
// the lock unlocks it. A lock set "with child pages" applies to everything
// under that page too, pages created or moved there later included.
export type PageLockState = {
  // The page whose lock applies: the outermost one, so unlocking it is what
  // makes a difference first.
  holderId: string;
  // The lock is on this very page (it can be unlocked here).
  own: boolean;
  // The pages under this one are locked as well.
  coversChildren: boolean;
};

type LockPage = TreePage & { lockedAt: Date | null; lockSubtree: boolean };

// The lock applying to each locked page of one tree. Pages missing from the
// result aren't locked.
export function computeLocks(pages: LockPage[]): Map<string, PageLockState> {
  const childrenOf = new Map<string | null, LockPage[]>();
  for (const p of pages) childrenOf.set(p.parentId, [...(childrenOf.get(p.parentId) ?? []), p]);
  const result = new Map<string, PageLockState>();
  const seen = new Set<string>();
  // `inherited`: the nearest-to-root ancestor whose lock covers this page.
  const visit = (page: LockPage, inherited: string | null, depth: number) => {
    if (depth > MAX_PAGE_DEPTH || seen.has(page.id)) return; // depth cap / cycle guard
    seen.add(page.id);
    const own = page.lockedAt !== null;
    const passedDown = inherited ?? (own && page.lockSubtree ? page.id : null);
    if (inherited !== null || own) {
      result.set(page.id, {
        holderId: inherited ?? page.id,
        own: inherited === null,
        coversChildren: passedDown !== null,
      });
    }
    for (const child of childrenOf.get(page.id) ?? []) visit(child, passedDown, depth + 1);
  };
  for (const root of childrenOf.get(null) ?? []) visit(root, null, 0);
  return result;
}

// EDIT access to a page that isn't locked: what changing the page needs.
// (Things that aren't changes to the page's content — its grants, unlocking —
// check the access alone.)
export function canEditPage(page: { access: PageAccess; lock: PageLockState | null } | null): boolean {
  return page !== null && atLeast(page.access, "EDIT") && page.lock === null;
}

// Built-in group every enabled user implicitly belongs to (no GroupMember rows).
export const ALL_USERS_GROUP = "all_users";
// Built-in group everyone belongs to, logged in or not (public pages). Only
// while a site admin allows public pages (InstanceConfig.publicPagesAllowed);
// its grants are VIEW, whatever they say (loadGrants).
export const PUBLIC_GROUP = "public";

// The public group's id while public pages are allowed, otherwise null.
export async function publicGroupId(prisma: PrismaClient): Promise<string | null> {
  const [config, group] = await Promise.all([
    prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { publicPagesAllowed: true } }),
    prisma.group.findUnique({ where: { builtIn: PUBLIC_GROUP }, select: { id: true } }),
  ]);
  return config?.publicPagesAllowed && group ? group.id : null;
}

// The groups whose grants count for this viewer. null = someone not logged
// in: the public group alone.
async function userGroupIds(prisma: PrismaClient, userId: string | null): Promise<Set<string>> {
  const publicId = await publicGroupId(prisma);
  const ids = new Set<string>(publicId ? [publicId] : []);
  if (userId === null) return ids;
  const [rows, user, allUsers] = await Promise.all([
    prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } }),
    prisma.group.findUnique({ where: { builtIn: ALL_USERS_GROUP }, select: { id: true } }),
  ]);
  for (const r of rows) ids.add(r.groupId);
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
    select: { id: true, parentId: true, title: true, icon: true, createdAt: true, lockedAt: true, lockSubtree: true },
    orderBy: PAGE_ORDER,
  });
}

async function loadGrants(prisma: PrismaClient, rootId: string, groupIds: Set<string>): Promise<Grant[]> {
  if (groupIds.size === 0) return [];
  const grants = await prisma.pageGrant.findMany({
    where: { groupId: { in: [...groupIds] }, page: { rootId } },
    select: { pageId: true, groupId: true, access: true, group: { select: { builtIn: true } } },
  });
  // Public pages are read-only for everyone, however the grant was made.
  return grants.map((g) => ({ pageId: g.pageId, groupId: g.groupId, access: g.group.builtIn === PUBLIC_GROUP ? "VIEW" : g.access }));
}

// Personal knowledge roots (KnowledgeRoot.ownerId): the owner can edit every
// page in it, nobody else can open any, and grants are never consulted —
// there is no way to share one. Expressed as a grant to a group only the
// owner is in, so the tree walk is the same as for any other root.
const OWNER_GROUP = "__owner__";

// The grants and groups that decide `userId`'s access to one root (null:
// someone not logged in).
async function accessRules(
  prisma: PrismaClient,
  rootId: string,
  userId: string | null,
  groupIds: Set<string>,
): Promise<{ grants: Grant[]; groupIds: Set<string> }> {
  const root = await prisma.knowledgeRoot.findUnique({ where: { id: rootId }, select: { ownerId: true, rootPageId: true } });
  if (root?.ownerId) {
    if (root.ownerId !== userId || !root.rootPageId) return { grants: [], groupIds: new Set() };
    return { grants: [{ pageId: root.rootPageId, groupId: OWNER_GROUP, access: "EDIT" }], groupIds: new Set([OWNER_GROUP]) };
  }
  return { grants: await loadGrants(prisma, rootId, groupIds), groupIds };
}

// The personal root this user owns, if any (its id).
async function personalRootOf(prisma: PrismaClient, userId: string): Promise<string | null> {
  const root = await prisma.knowledgeRoot.findUnique({ where: { ownerId: userId }, select: { id: true } });
  return root?.id ?? null;
}

// Whether the root is someone's personal root.
export async function isPersonalRoot(prisma: PrismaClient, rootId: string): Promise<boolean> {
  const root = await prisma.knowledgeRoot.findUnique({ where: { id: rootId }, select: { ownerId: true } });
  return !!root?.ownerId;
}

// The user's access to one page (and the lock on it, if any), or null.
// Disabled users get null. userId null: someone not logged in (public pages
// only, VIEW).
export async function getPageAccess(
  prisma: PrismaClient,
  userId: string | null,
  pageId: string,
): Promise<{ access: PageAccess; rootId: string; lock: PageLockState | null } | null> {
  const [page, user] = await Promise.all([
    prisma.page.findUnique({ where: { id: pageId }, select: { rootId: true, deletedAt: true } }),
    userId === null ? null : prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } }),
  ]);
  if (!page || page.deletedAt) return null;
  if (userId !== null && (!user || user.disabledAt)) return null;
  const rules = await accessRules(prisma, page.rootId, userId, await userGroupIds(prisma, userId));
  if (rules.grants.length === 0) return null;
  const tree = await loadTree(prisma, page.rootId);
  const access = computeTreeAccess(tree, rules.grants, rules.groupIds, MAX_PAGE_DEPTH).get(pageId);
  return access ? { access, rootId: page.rootId, lock: computeLocks(tree).get(pageId) ?? null } : null;
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
  // A personal root has no group access at all.
  if (await isPersonalRoot(prisma, page.rootId)) return result;
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
  // A personal root: its owner alone.
  const owner = await prisma.page.findUnique({
    where: { id: pageId },
    select: { root: { select: { owner: { select: { id: true, name: true, emailEnc: true, disabledAt: true } } } } },
  });
  const personal = owner?.root.owner;
  let users: { id: string; name: string | null; emailEnc: Uint8Array | null }[];
  if (personal) {
    users = personal.disabledAt ? [] : [personal];
  } else {
    const groupAccess = await getGroupAccessForPage(prisma, pageId);
    const groupIds = [...groupAccess.keys()];
    if (groupIds.length === 0) return [];
    const [allUsers, publicId] = await Promise.all([
      prisma.group.findUnique({ where: { builtIn: ALL_USERS_GROUP }, select: { id: true } }),
      publicGroupId(prisma),
    ]);
    const everyone = (allUsers !== null && groupAccess.has(allUsers.id)) || (publicId !== null && groupAccess.has(publicId));
    users = await prisma.user.findMany({
      where: { disabledAt: null, ...(everyone ? {} : { groups: { some: { groupId: { in: groupIds } } } }) },
      select: { id: true, name: true, emailEnc: true },
    });
  }
  if (users.length === 0) return [];
  // Addresses are encrypted, so sorted here: by name (none last), then address.
  const key = await loadDataKey(prisma);
  return users
    .map((u) => ({ id: u.id, name: u.name, email: u.emailEnc ? openEmail(key, u.emailEnc) : "" }))
    .sort(
      (a, b) =>
        Number(a.name === null) - Number(b.name === null) ||
        (a.name ?? "").localeCompare(b.name ?? "") ||
        a.email.localeCompare(b.email),
    );
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
      lockedAt: true,
      lockSubtree: true,
    },
    orderBy: PAGE_ORDER,
  });
  const rules = !user || user.disabledAt ? { grants: [], groupIds } : await accessRules(prisma, rootId, userId, groupIds);
  const access = computeTreeAccess(pages, rules.grants, rules.groupIds, MAX_PAGE_DEPTH);
  const locks = computeLocks(pages);
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
  return { pages, access, live, locks };
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
  const granted =
    groupIds.size === 0
      ? []
      : await prisma.page.findMany({
          where: { grants: { some: { groupId: { in: [...groupIds] } } } },
          select: { rootId: true },
          distinct: ["rootId"],
        });
  const personal = await personalRootOf(prisma, userId);
  const rootIds = [...granted.map((g) => g.rootId), ...(personal ? [personal] : [])];
  if (rootIds.length === 0) return { items: [], destinations: {} };
  const withDeleted = await prisma.page.findMany({
    where: { rootId: { in: rootIds }, deletedAt: { not: null } },
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
  // The lock applying to the page, if it's locked.
  lock: PageLockState | null;
};

export type VisibleTree = {
  rootId: string;
  rootPageId: string | null;
  // The user's own personal root.
  personal: boolean;
  // Pages the user can open, in sibling order (PAGE_ORDER).
  pages: VisiblePage[];
  // Visible pages whose parent isn't visible: where the user's view of this
  // tree starts. The root page, if visible, is always one of them.
  entryIds: string[];
};

// Every page the user can open, grouped by knowledge root. userId null:
// someone not logged in (the public pages).
export async function getVisibleTrees(prisma: PrismaClient, userId: string | null): Promise<VisibleTree[]> {
  const groupIds = await userGroupIds(prisma, userId);
  const rootIds =
    groupIds.size === 0
      ? []
      : await prisma.page.findMany({
          where: { grants: { some: { groupId: { in: [...groupIds] } } }, deletedAt: null },
          select: { rootId: true },
          distinct: ["rootId"],
        });
  const roots = await prisma.knowledgeRoot.findMany({
    // The user's own personal root, and the roots their groups reach.
    where: { OR: [{ id: { in: rootIds.map((r) => r.rootId) } }, ...(userId ? [{ ownerId: userId }] : [])] },
    select: { id: true, rootPageId: true },
    orderBy: { createdAt: "asc" },
  });

  const trees: VisibleTree[] = [];
  for (const root of roots) {
    const tree = await buildVisibleTree(prisma, root, userId, groupIds);
    if (tree) trees.push(tree);
  }
  return trees;
}

// The user's visible part of one knowledge root (for the page sidebar).
export async function getVisibleTree(
  prisma: PrismaClient,
  userId: string | null,
  rootId: string,
): Promise<VisibleTree | null> {
  const [groupIds, root] = await Promise.all([
    userGroupIds(prisma, userId),
    prisma.knowledgeRoot.findUnique({ where: { id: rootId }, select: { id: true, rootPageId: true } }),
  ]);
  if (!root) return null;
  return buildVisibleTree(prisma, root, userId, groupIds);
}

async function buildVisibleTree(
  prisma: PrismaClient,
  root: { id: string; rootPageId: string | null },
  userId: string | null,
  groupIds: Set<string>,
): Promise<VisibleTree | null> {
  const [tree, rules] = await Promise.all([loadTree(prisma, root.id), accessRules(prisma, root.id, userId, groupIds)]);
  const access = computeTreeAccess(tree, rules.grants, rules.groupIds, MAX_PAGE_DEPTH);
  const locks = computeLocks(tree);
  const pages = tree
    .filter((p) => access.has(p.id))
    .map((p) => ({
      id: p.id,
      parentId: p.parentId,
      title: p.title,
      icon: p.icon,
      access: access.get(p.id)!,
      lock: locks.get(p.id) ?? null,
    }));
  if (pages.length === 0) return null;
  const visible = new Set(pages.map((p) => p.id));
  return {
    rootId: root.id,
    rootPageId: root.rootPageId,
    personal: rules.groupIds.has(OWNER_GROUP),
    pages,
    entryIds: pages.filter((p) => !p.parentId || !visible.has(p.parentId)).map((p) => p.id),
  };
}

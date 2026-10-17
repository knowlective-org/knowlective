import { MAX_PAGE_DEPTH, PUBLIC_GROUP, computeTreeAccess } from "shared";
import { prisma } from "@/lib/db";

// Public pages: pages viewable without logging in, through a VIEW grant to
// the built-in "public" group (see packages/shared/src/permissions.ts). They
// count only while a site admin allows them (InstanceConfig.publicPagesAllowed).

export async function publicPagesAllowed(): Promise<boolean> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { publicPagesAllowed: true } });
  return config?.publicPagesAllowed ?? false;
}

export async function publicGroup(): Promise<{ id: string; name: string } | null> {
  return prisma.group.findUnique({ where: { builtIn: PUBLIC_GROUP }, select: { id: true, name: true } });
}

// Every live page a public grant reaches (whether or not public pages are
// allowed right now).
export async function publicPageIds(): Promise<string[]> {
  const group = await prisma.group.findUnique({
    where: { builtIn: PUBLIC_GROUP },
    select: { id: true, grants: { select: { pageId: true, page: { select: { rootId: true } } } } },
  });
  if (!group || group.grants.length === 0) return [];
  const grants = group.grants.map((g) => ({ pageId: g.pageId, groupId: group.id, access: "VIEW" as const }));
  const ids: string[] = [];
  for (const rootId of new Set(group.grants.map((g) => g.page.rootId))) {
    const pages = await prisma.page.findMany({ where: { rootId, deletedAt: null }, select: { id: true, parentId: true } });
    ids.push(...computeTreeAccess(pages, grants, new Set([group.id]), MAX_PAGE_DEPTH).keys());
  }
  return ids;
}

// The page and every live page under it.
export async function subtreeIds(pageId: string): Promise<string[]> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { rootId: true } });
  if (!page) return [];
  const pages = await prisma.page.findMany({ where: { rootId: page.rootId, deletedAt: null }, select: { id: true, parentId: true } });
  const childrenOf = new Map<string, string[]>();
  for (const p of pages) if (p.parentId) childrenOf.set(p.parentId, [...(childrenOf.get(p.parentId) ?? []), p.id]);
  const ids: string[] = [];
  const visit = (id: string, depth: number) => {
    if (depth > MAX_PAGE_DEPTH) return;
    ids.push(id);
    for (const child of childrenOf.get(id) ?? []) visit(child, depth + 1);
  };
  visit(pageId, 0);
  return ids;
}

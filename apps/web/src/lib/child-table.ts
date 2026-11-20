import { PAGE_ORDER, atLeast, getUsersWithPageAccess, loadDataKey } from "shared";
import { getVisibleTree } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { openColumn, openValue } from "@/lib/page-properties";
import type { ChildTableData, ChildTableRow } from "@/lib/page-property-types";

// A page's child page table (its columns, and its visible child pages with
// their values), as `userId` sees it: for the editor's child page blocks
// (child-pages-actions.ts), the public API and MCP. Null when they can't open
// the page. userId null: someone not logged in (public pages), who gets no
// names.

// The caller's visible pages in the tree containing `pageId`, or null if
// they can't open `pageId` itself. userId null: someone not logged in
// (public pages). Shortcuts (lib/shortcuts.ts) are left out: the child page
// blocks show pages with content and values, which a shortcut doesn't have.
export async function visibleTreeOf(userId: string | null, pageId: unknown) {
  if (typeof pageId !== "string") return null;
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { rootId: true } });
  if (!page) return null;
  const tree = await getVisibleTree(prisma, userId, page.rootId);
  if (!tree) return null;
  const pages = tree.pages.filter((p) => p.kind !== "SHORTCUT");
  return pages.some((p) => p.id === pageId) ? { ...tree, pages } : null;
}

const nameOf = (u: { name: string | null; email: string }) => u.name || u.email;

export async function childTableFor(userId: string | null, pageId: string): Promise<ChildTableData | null> {
  const tree = await visibleTreeOf(userId, pageId);
  if (!tree) return null;
  const access = new Map(tree.pages.map((p) => [p.id, p.access]));
  // Locked pages: their cells (and, for this page, its columns) can't be changed.
  const locked = new Set(tree.pages.filter((p) => p.lock).map((p) => p.id));
  const childIds = tree.pages.filter((p) => p.parentId === pageId).map((p) => p.id);

  const [defs, children, values, assignees] = await Promise.all([
    prisma.pagePropertyDef.findMany({ where: { pageId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    prisma.page.findMany({
      where: { id: { in: childIds } },
      orderBy: PAGE_ORDER,
      select: { id: true, title: true, icon: true, createdAt: true, updatedAt: true, createdById: true, updatedById: true },
    }),
    prisma.pagePropertyValue.findMany({ where: { pageId: { in: childIds }, def: { pageId } } }),
    userId ? getUsersWithPageAccess(prisma, pageId) : [],
  ]);
  const key = await loadDataKey(prisma);
  const columns = defs.map((d) => openColumn(key, d));

  const valuesOf = new Map<string, Record<string, string>>();
  for (const v of values) {
    const row = valuesOf.get(v.pageId) ?? {};
    row[v.defId] = openValue(key, v);
    valuesOf.set(v.pageId, row);
  }
  const rows: ChildTableRow[] = children.map((c) => ({
    id: c.id,
    title: c.title,
    icon: c.icon,
    canEdit: atLeast(access.get(c.id) ?? null, "EDIT") && !locked.has(c.id),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    createdById: c.createdById,
    // Not edited since it was created: the creator was the last to touch it.
    updatedById: c.updatedById ?? c.createdById,
    values: valuesOf.get(c.id) ?? {},
  }));

  // Names for creators, editors and assignees, including users who have
  // since lost access (their id is still in the data).
  const userColumns = new Set(columns.filter((c) => c.type === "USER").map((c) => c.id));
  const referenced = new Set<string>();
  for (const r of rows) {
    referenced.add(r.createdById);
    if (r.updatedById) referenced.add(r.updatedById);
    for (const [defId, v] of Object.entries(r.values)) if (userColumns.has(defId)) referenced.add(v);
  }
  const userNames: Record<string, string> = {};
  for (const u of assignees) userNames[u.id] = nameOf(u);
  const missing = [...referenced].filter((id) => !(id in userNames));
  // Someone not logged in (a public page) gets no names: people's names and
  // addresses aren't public.
  if (userId && missing.length > 0) {
    const others = await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true, emailEnc: true } });
    for (const u of others) userNames[u.id] = await displayName(u);
  }

  const self = tree.pages.find((p) => p.id === pageId);
  return {
    page: { title: self?.title ?? "", icon: self?.icon ?? null },
    canEditColumns: atLeast(access.get(pageId) ?? null, "EDIT") && !locked.has(pageId),
    columns,
    rows,
    assignees: assignees.map((u) => ({ id: u.id, name: nameOf(u) })),
    userNames,
  };
}


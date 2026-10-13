"use server";

import { randomUUID } from "node:crypto";
import { PAGE_ORDER, atLeast, canEditPage, getPageAccess, getUsersWithPageAccess, getVisibleTree, loadDataKey } from "shared";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { notifyChildrenChanged } from "@/lib/collab-events";
import {
  MAX_COLUMNS,
  normalizeColumnName,
  normalizeOptions,
  openColumn,
  openValue,
  sealColumnName,
  sealOptions,
  sealValue,
  validateValue,
} from "@/lib/page-properties";
import type {
  ChildPageItem,
  ChildTableData,
  ChildTableRow,
  PropertyType,
  SelectOption,
} from "@/lib/page-property-types";

// Data for the editor's child-page blocks (子ページ一覧 / 子ページテーブル).
// Only pages the caller can open are returned; unknown and forbidden ids get
// the same answer. Every change notifies the parent page's collaborators
// (lib/collab-events.ts) so their blocks refetch.

type Result = { error?: string };
const NOT_ALLOWED = "この操作を行う権限がありません。";
const PROPERTY_TYPES: PropertyType[] = ["TEXT", "DATE", "USER", "SELECT"];

// The caller's visible pages in the tree containing `pageId`, or null if
// they can't open `pageId` itself.
async function visibleTreeOf(userId: string, pageId: unknown) {
  if (typeof pageId !== "string") return null;
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { rootId: true } });
  if (!page) return null;
  const tree = await getVisibleTree(prisma, userId, page.rootId);
  return tree?.pages.some((p) => p.id === pageId) ? tree : null;
}

// Every visible page below `pageId` that is reached through visible pages,
// in creation order. The block decides how many levels to show.
export async function loadChildPages(pageId: string): Promise<ChildPageItem[] | null> {
  const user = await requireUser();
  const tree = await visibleTreeOf(user.id, pageId);
  if (!tree) return null;
  const below = new Set([pageId]);
  const result: Omit<ChildPageItem, "updatedAt">[] = [];
  // Creation order puts parents first except after moves; loop until stable.
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of tree.pages) {
      if (p.parentId && below.has(p.parentId) && !below.has(p.id)) {
        below.add(p.id);
        result.push({ id: p.id, parentId: p.parentId, title: p.title, icon: p.icon });
        changed = true;
      }
    }
  }
  const times = await prisma.page.findMany({
    where: { id: { in: result.map((p) => p.id) } },
    select: { id: true, updatedAt: true },
  });
  const updatedAt = new Map(times.map((t) => [t.id, t.updatedAt.toISOString()]));
  return result.map((p) => ({ ...p, updatedAt: updatedAt.get(p.id) ?? "" }));
}

const displayName = (u: { name: string | null; email: string }) => u.name || u.email;

export async function loadChildTable(pageId: string): Promise<ChildTableData | null> {
  const user = await requireUser();
  const tree = await visibleTreeOf(user.id, pageId);
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
    getUsersWithPageAccess(prisma, pageId),
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
  for (const u of assignees) userNames[u.id] = displayName(u);
  const missing = [...referenced].filter((id) => !(id in userNames));
  if (missing.length > 0) {
    const others = await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true, email: true } });
    for (const u of others) userNames[u.id] = displayName(u);
  }

  return {
    canEditColumns: atLeast(access.get(pageId) ?? null, "EDIT") && !locked.has(pageId),
    columns,
    rows,
    assignees: assignees.map((u) => ({ id: u.id, name: displayName(u) })),
    userNames,
  };
}

// A column definition the caller may change (EDIT on the page it belongs to).
async function editableColumn(userId: string, defId: unknown) {
  if (typeof defId !== "string") return null;
  const def = await prisma.pagePropertyDef.findUnique({ where: { id: defId } });
  if (!def) return null;
  const access = await getPageAccess(prisma, userId, def.pageId);
  return canEditPage(access) ? def : null;
}

export async function addColumn(pageId: string, rawName: string, type: PropertyType): Promise<Result> {
  const user = await requireUser();
  const access = typeof pageId === "string" ? await getPageAccess(prisma, user.id, pageId) : null;
  if (!canEditPage(access)) return { error: NOT_ALLOWED };
  const name = normalizeColumnName(rawName);
  if (!name) return { error: "列名を入力してください（50文字以内）。" };
  if (!PROPERTY_TYPES.includes(type)) return { error: "列の種類が不正です。" };
  const existing = await prisma.pagePropertyDef.aggregate({ where: { pageId }, _count: true, _max: { position: true } });
  if (existing._count >= MAX_COLUMNS) return { error: `列は${MAX_COLUMNS}個までです。` };

  const id = randomUUID();
  const key = await loadDataKey(prisma);
  await prisma.pagePropertyDef.create({
    data: {
      id,
      pageId,
      type,
      name: sealColumnName(key, id, name),
      options: type === "SELECT" ? sealOptions(key, id, []) : null,
      position: (existing._max.position ?? -1) + 1,
    },
  });
  notifyChildrenChanged(pageId);
  return {};
}

export async function renameColumn(defId: string, rawName: string): Promise<Result> {
  const user = await requireUser();
  const def = await editableColumn(user.id, defId);
  if (!def) return { error: NOT_ALLOWED };
  const name = normalizeColumnName(rawName);
  if (!name) return { error: "列名を入力してください（50文字以内）。" };
  const key = await loadDataKey(prisma);
  await prisma.pagePropertyDef.update({ where: { id: def.id }, data: { name: sealColumnName(key, def.id, name) } });
  notifyChildrenChanged(def.pageId);
  return {};
}

export async function setColumnOptions(defId: string, rawOptions: SelectOption[]): Promise<Result> {
  const user = await requireUser();
  const def = await editableColumn(user.id, defId);
  if (!def || def.type !== "SELECT") return { error: NOT_ALLOWED };
  const options = normalizeOptions(rawOptions);
  if (!options) return { error: "選択肢が不正です（名前は50文字以内、50個まで）。" };
  const key = await loadDataKey(prisma);
  await prisma.pagePropertyDef.update({ where: { id: def.id }, data: { options: sealOptions(key, def.id, options) } });
  notifyChildrenChanged(def.pageId);
  return {};
}

// Also deletes every value in the column.
export async function deleteColumn(defId: string): Promise<Result> {
  const user = await requireUser();
  const def = await editableColumn(user.id, defId);
  if (!def) return { error: NOT_ALLOWED };
  await prisma.pagePropertyDef.delete({ where: { id: def.id } });
  notifyChildrenChanged(def.pageId);
  return {};
}

// Sets one cell; "" clears it. Needs EDIT on the child page itself, and
// counts as an edit of it (更新日時 / 更新者).
export async function setCellValue(childId: string, defId: string, value: string): Promise<Result> {
  const user = await requireUser();
  if (typeof childId !== "string" || typeof defId !== "string" || typeof value !== "string") {
    return { error: NOT_ALLOWED };
  }
  const [access, child, def] = await Promise.all([
    getPageAccess(prisma, user.id, childId),
    prisma.page.findUnique({ where: { id: childId }, select: { parentId: true } }),
    prisma.pagePropertyDef.findUnique({ where: { id: defId } }),
  ]);
  if (!canEditPage(access) || !child || !def || def.pageId !== child.parentId) {
    return { error: NOT_ALLOWED };
  }
  const key = await loadDataKey(prisma);
  const column = openColumn(key, def);
  const trimmed = column.type === "TEXT" ? value.trim() : value;
  const assignees = column.type === "USER" && trimmed ? await getUsersWithPageAccess(prisma, def.pageId) : [];
  if (!validateValue(column, trimmed, (id) => assignees.some((u) => u.id === id))) {
    return { error: "値が不正です。" };
  }

  await prisma.$transaction([
    trimmed === ""
      ? prisma.pagePropertyValue.deleteMany({ where: { pageId: childId, defId } })
      : prisma.pagePropertyValue.upsert({
          where: { pageId_defId: { pageId: childId, defId } },
          create: { pageId: childId, defId, value: sealValue(key, childId, defId, trimmed) },
          update: { value: sealValue(key, childId, defId, trimmed) },
        }),
    prisma.page.update({ where: { id: childId }, data: { updatedAt: new Date(), updatedById: user.id } }),
  ]);
  notifyChildrenChanged(def.pageId);
  return {};
}


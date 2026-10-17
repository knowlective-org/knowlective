"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PUBLIC_GROUP, atLeast, getPageAccess, type PageAccess } from "shared";
import { reconnectDocuments } from "@/lib/collab-events";
import { publicGroup, publicPagesAllowed, subtreeIds } from "@/lib/public-pages";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { recordAudit, userLabel } from "@/lib/audit";
import { ACCESS_LABELS } from "@/lib/admin/format";
import { displayTitle } from "@/lib/page-title";

// Group grants on one page. Only users with MANAGE on the page may change
// them, and a root page must always keep at least one MANAGE grant — otherwise
// nobody could ever manage the tree again (not even a site admin, who can't
// see pages without a grant).

const ACCESS_VALUES: PageAccess[] = ["VIEW", "EDIT", "MANAGE"];

function back(pageId: string, error?: string): never {
  redirect(`/pages/${pageId}/share${error ? `?error=${error}` : ""}`);
}

async function requireManager(pageId: string) {
  const user = await requireUser(`/pages/${encodeURIComponent(pageId)}/share`);
  const result = await getPageAccess(prisma, user.id, pageId);
  if (!result || !atLeast(result.access, "MANAGE")) redirect(`/pages/${pageId}`);
  const page = await prisma.page.findUniqueOrThrow({
    where: { id: pageId },
    select: { title: true, root: { select: { rootPageId: true } } },
  });
  return { user, page, isRootPage: page.root.rootPageId === pageId };
}

// Refuse a change that would leave a root page without any MANAGE grant.
async function keepsRootManager(pageId: string, change: { groupId: string; access: PageAccess | null }) {
  const grants = await prisma.pageGrant.findMany({ where: { pageId }, select: { groupId: true, access: true } });
  const after = grants
    .filter((g) => g.groupId !== change.groupId)
    .concat(change.access ? [{ groupId: change.groupId, access: change.access }] : []);
  return after.some((g) => g.access === "MANAGE");
}

export async function setGrant(formData: FormData): Promise<void> {
  const pageId = String(formData.get("pageId") ?? "");
  const groupId = formData.get("groupId");
  const access = formData.get("access");
  const { user, page, isRootPage } = await requireManager(pageId);
  if (typeof groupId !== "string" || !ACCESS_VALUES.includes(access as PageAccess)) back(pageId, "invalid");
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true, builtIn: true } });
  // Made public with publishPage, never with another access level.
  if (!group || group.builtIn === PUBLIC_GROUP) back(pageId, "invalid");
  if (isRootPage && !(await keepsRootManager(pageId, { groupId, access: access as PageAccess }))) {
    back(pageId, "last-manager");
  }

  const before = await prisma.pageGrant.findUnique({
    where: { pageId_groupId: { pageId, groupId } },
    select: { access: true },
  });
  if (before?.access === access) back(pageId);
  await prisma.pageGrant.upsert({
    where: { pageId_groupId: { pageId, groupId } },
    create: { pageId, groupId, access: access as PageAccess },
    update: { access: access as PageAccess },
  });
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.grant.set",
    `ページ「${displayTitle(page.title)}」のグループ「${group.name}」の権限を` +
      (before ? `「${ACCESS_LABELS[before.access]}」から` : "") +
      `「${ACCESS_LABELS[access as PageAccess]}」に設定`,
    { pageId, groupId, from: before?.access ?? null, to: access as PageAccess },
  );
  revalidatePath(`/pages/${pageId}`, "layout");
  back(pageId);
}

export async function removeGrant(formData: FormData): Promise<void> {
  const pageId = String(formData.get("pageId") ?? "");
  const groupId = formData.get("groupId");
  const { user, page, isRootPage } = await requireManager(pageId);
  if (typeof groupId !== "string") back(pageId, "invalid");
  if (isRootPage && !(await keepsRootManager(pageId, { groupId, access: null }))) back(pageId, "last-manager");

  const grant = await prisma.pageGrant.findUnique({
    where: { pageId_groupId: { pageId, groupId } },
    select: { access: true, group: { select: { name: true, builtIn: true } } },
  });
  if (!grant) back(pageId);
  if (grant.group.builtIn === PUBLIC_GROUP) back(pageId, "invalid");
  await prisma.pageGrant.delete({ where: { pageId_groupId: { pageId, groupId } } });
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.grant.remove",
    `ページ「${displayTitle(page.title)}」からグループ「${grant.group.name}」の権限（${ACCESS_LABELS[grant.access]}）を削除`,
    { pageId, groupId, from: grant.access },
  );
  revalidatePath(`/pages/${pageId}`, "layout");
  // The actor may have just removed their own access to this page.
  const still = await getPageAccess(prisma, user.id, pageId);
  if (!still || !atLeast(still.access, "MANAGE")) redirect(still ? `/pages/${pageId}` : "/");
  back(pageId);
}

// Makes the page, and every page under it, viewable without logging in (a
// VIEW grant to the built-in public group). Only while a site admin allows
// public pages, and never in a personal knowledge root.
export async function publishPage(formData: FormData): Promise<void> {
  const pageId = String(formData.get("pageId") ?? "");
  const { user, page } = await requireManager(pageId);
  const [allowed, group, root] = await Promise.all([
    publicPagesAllowed(),
    publicGroup(),
    prisma.page.findUnique({ where: { id: pageId }, select: { root: { select: { ownerId: true } } } }),
  ]);
  if (!allowed || !group || root?.root.ownerId) back(pageId, "public-not-allowed");
  const existing = await prisma.pageGrant.findUnique({ where: { pageId_groupId: { pageId, groupId: group.id } } });
  if (existing) back(pageId);
  await prisma.pageGrant.create({ data: { pageId, groupId: group.id, access: "VIEW" } });
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.public.set",
    `ページ「${displayTitle(page.title)}」（とその下のページ）をインターネットに公開`,
    { pageId },
  );
  revalidatePath(`/pages/${pageId}`, "layout");
  back(pageId);
}

// Stops the page being public (the grant on this page; one inherited from
// above has to be removed there). Editors open on it reconnect, so visitors
// who aren't logged in stop receiving it at once.
export async function unpublishPage(formData: FormData): Promise<void> {
  const pageId = String(formData.get("pageId") ?? "");
  const { user, page } = await requireManager(pageId);
  const group = await publicGroup();
  if (!group) back(pageId);
  const { count } = await prisma.pageGrant.deleteMany({ where: { pageId, groupId: group.id } });
  if (count === 0) back(pageId);
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.public.remove",
    `ページ「${displayTitle(page.title)}」（とその下のページ）のインターネットへの公開をやめる`,
    { pageId },
  );
  reconnectDocuments(await subtreeIds(pageId));
  revalidatePath(`/pages/${pageId}`, "layout");
  back(pageId);
}
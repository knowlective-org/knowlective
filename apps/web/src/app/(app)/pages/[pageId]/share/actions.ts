"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { atLeast, getPageAccess, type PageAccess } from "shared";
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
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true } });
  if (!group) back(pageId, "invalid");
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
    select: { access: true, group: { select: { name: true } } },
  });
  if (!grant) back(pageId);
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

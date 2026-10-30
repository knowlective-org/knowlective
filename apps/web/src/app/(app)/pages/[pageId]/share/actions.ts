"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACCESS_RANK, PUBLIC_GROUP, atLeast, getInheritedGroupAccess, type PageAccess } from "shared";
import { getPageAccess } from "@/lib/page-access";
import { reconnectDocuments } from "@/lib/collab-events";
import { publicGroup, publicPagesAllowed, subtreeIds } from "@/lib/public-pages";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { recordAudit, userLabel } from "@/lib/audit";
import { auditTranslator } from "@/i18n/audit";
import { displayTitleWith } from "@/i18n/display-title";
import { groupName } from "@/i18n/group-name";

// The audit log's translator and the page's title in its language.
async function auditFor(title: string) {
  const audit = await auditTranslator();
  return { audit, title: displayTitleWith(audit)(title) };
}

// Group grants on one page. Only users with MANAGE on the page may change
// them, and a root page must always keep at least one MANAGE grant — otherwise
// nobody could ever manage the tree again (not even a site admin, who can't
// see pages without a grant).
//
// A group that already has access from the pages above (an inherited grant)
// can only be narrowed here: EDIT to VIEW or NONE ("no access"), VIEW to
// NONE. Never raised, and a group managing the pages above can't be changed
// here at all. Choosing the inherited level again removes this page's grant
// (back to inheriting).

const ACCESS_VALUES: PageAccess[] = ["VIEW", "EDIT", "MANAGE", "NONE"];

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

// After a change: open editors of the page and the pages below reconnect, so
// access that was narrowed or taken away applies at once (collab decides
// read-only at connection). Then back to the share screen — or away from it,
// if the manager no longer manages the page.
async function afterGrantChange(pageId: string, userId: string): Promise<never> {
  reconnectDocuments(await subtreeIds(pageId));
  revalidatePath(`/pages/${pageId}`, "layout");
  const still = await getPageAccess(prisma, userId, pageId);
  if (!still || !atLeast(still.access, "MANAGE")) redirect(still ? `/pages/${pageId}` : "/");
  back(pageId);
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
  const inherited = (await getInheritedGroupAccess(prisma, pageId)).get(groupId);
  if (inherited) {
    if (inherited.access === "MANAGE") back(pageId, "inherited-manage");
    if (ACCESS_RANK[access as PageAccess] > ACCESS_RANK[inherited.access]) back(pageId, "raise");
    // The inherited level itself: inherit again.
    if (access === inherited.access) return revertGrant(pageId, groupId);
  } else if (access === "NONE") {
    // Nothing inherited to take away.
    back(pageId, "invalid");
  }
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
  const { audit, title } = await auditFor(page.title);
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.grant.set",
    audit("audit.grantSet", {
      title,
      group: groupName(audit, group),
      before: before ? audit(`access.${before.access}`) : "none",
      after: audit(`access.${access as PageAccess}`),
    }),
    { pageId, groupId, from: before?.access ?? null, to: access as PageAccess },
  );
  return afterGrantChange(pageId, user.id);
}

// Removes this page's grant for the group: no access from here, or — for a
// group with an inherited grant — back to what it inherits.
export async function removeGrant(formData: FormData): Promise<void> {
  const pageId = String(formData.get("pageId") ?? "");
  const groupId = formData.get("groupId");
  if (typeof groupId !== "string") back(pageId, "invalid");
  return revertGrant(pageId, groupId);
}

async function revertGrant(pageId: string, groupId: string): Promise<never> {
  const { user, page, isRootPage } = await requireManager(pageId);
  if (isRootPage && !(await keepsRootManager(pageId, { groupId, access: null }))) back(pageId, "last-manager");

  const grant = await prisma.pageGrant.findUnique({
    where: { pageId_groupId: { pageId, groupId } },
    select: { access: true, group: { select: { name: true, builtIn: true } } },
  });
  if (!grant) back(pageId);
  if (grant.group.builtIn === PUBLIC_GROUP) back(pageId, "invalid");
  await prisma.pageGrant.delete({ where: { pageId_groupId: { pageId, groupId } } });
  const { audit, title } = await auditFor(page.title);
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.grant.remove",
    audit("audit.grantRemove", { title, group: groupName(audit, grant.group), access: audit(`access.${grant.access}`) }),
    { pageId, groupId, from: grant.access },
  );
  // The actor may have just removed their own access to this page.
  return afterGrantChange(pageId, user.id);
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
  const { audit, title } = await auditFor(page.title);
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.public.set",
    audit("audit.publicSet", { title }),
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
  const { audit, title } = await auditFor(page.title);
  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "page.public.remove",
    audit("audit.publicRemove", { title }),
    { pageId },
  );
  reconnectDocuments(await subtreeIds(pageId));
  revalidatePath(`/pages/${pageId}`, "layout");
  back(pageId);
}
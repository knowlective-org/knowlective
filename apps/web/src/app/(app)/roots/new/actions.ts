"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auditTranslator } from "@/i18n/audit";
import { ALL_USERS_GROUP, createKnowledgeRoot } from "shared";
import { prisma } from "@/lib/db";
import { reindexPage } from "@/lib/search-index";
import { requireUser } from "@/lib/auth/session";
import { requestNetworkCaps } from "@/lib/page-access";
import { recordAudit, userLabel } from "@/lib/audit";
import { canManageGroup } from "@/lib/group-access";
import { MAX_TITLE_LENGTH, normalizeTitle } from "@/lib/page-title";

export type CreateRootState = { error?: string };

const CREATOR_ROLES = ["SITE_ADMIN", "CONTENT_MANAGER"];

// Creates a knowledge root and grants MANAGE on its root page to a group —
// never to the creator personally. With a new group, the creator joins it.
export async function createRoot(_prev: CreateRootState, formData: FormData): Promise<CreateRootState> {
  const user = await requireUser("/roots/new");
  const t = await getTranslations("newRoot.errors");
  if (!CREATOR_ROLES.includes(user.siteRole)) {
    return { error: t("notAllowed") };
  }
  // A change, like any page change (lib/network-policy.ts).
  if (!(await requestNetworkCaps()).write) return { error: t("network") };

  const rawTitle = formData.get("title");
  const title = typeof rawTitle === "string" ? normalizeTitle(rawTitle) : "";
  if (!title) return { error: t("nameRequired") };
  if (title.length > MAX_TITLE_LENGTH) return { error: t("nameTooLong", { max: MAX_TITLE_LENGTH }) };

  const shareWithAll = formData.get("shareWithAll") === "on";
  const mode = formData.get("groupMode");
  let groupId: string | null = null;
  let newGroupName: string | null = null;
  if (mode === "existing") {
    const id = formData.get("groupId");
    if (typeof id !== "string" || !id) return { error: t("groupRequired") };
    // Same rule as /admin: a content manager can only use groups within
    // trees it already manages.
    if (!(await canManageGroup({ userId: user.id, role: user.siteRole }, id))) {
      return { error: t("groupNotAllowed") };
    }
    const chosen = await prisma.group.findUnique({ where: { id }, select: { builtIn: true } });
    if (!chosen || chosen.builtIn) return { error: t("groupNotAllowed") };
    groupId = id;
  } else {
    const raw = formData.get("newGroupName");
    newGroupName = typeof raw === "string" ? raw.trim() : "";
    if (!newGroupName) return { error: t("newGroupRequired") };
    if (newGroupName.length > 100) return { error: t("groupNameTooLong") };
    if (await prisma.group.findUnique({ where: { name: newGroupName }, select: { id: true } })) {
      return { error: t("groupExists") };
    }
  }

  // In the site's default language: group details are shared by every admin.
  const audit = await auditTranslator();
  const { rootPageId, groupName } = await prisma.$transaction(async (tx) => {
    const { rootPageId } = await createKnowledgeRoot(tx, { title, createdById: user.id });
    let gid = groupId;
    let gname: string;
    if (gid) {
      gname = (await tx.group.findUniqueOrThrow({ where: { id: gid }, select: { name: true } })).name;
    } else {
      const group = await tx.group.create({
        // No root title here: group details are visible to site admins, who
        // must not learn the names of pages they can't see.
        data: { name: newGroupName!, description: audit("newRoot.managerGroupDescription") },
      });
      gid = group.id;
      gname = group.name;
      await tx.groupMember.create({ data: { groupId: gid, userId: user.id } });
    }
    await tx.pageGrant.create({ data: { pageId: rootPageId, groupId: gid, access: "MANAGE" } });
    // Optional: every registered user can read the whole tree.
    if (shareWithAll) {
      const all = await tx.group.findUniqueOrThrow({ where: { builtIn: ALL_USERS_GROUP }, select: { id: true } });
      await tx.pageGrant.create({ data: { pageId: rootPageId, groupId: all.id, access: "VIEW" } });
    }
    return { rootPageId, groupName: gname };
  });

  await recordAudit(
    { userId: user.id, label: userLabel(user) },
    "root.create",
    audit("audit.rootCreate", { title, group: groupName, newGroup: String(newGroupName !== null), shareWithAll: String(shareWithAll) }),
    { rootPageId },
  );
  await reindexPage(prisma, rootPageId);
  redirect(`/pages/${rootPageId}`);
}

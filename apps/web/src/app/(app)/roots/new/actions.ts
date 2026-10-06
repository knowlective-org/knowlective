"use server";

import { redirect } from "next/navigation";
import { ALL_USERS_GROUP, createKnowledgeRoot } from "shared";
import { prisma } from "@/lib/db";
import { reindexPage } from "@/lib/search-index";
import { requireUser } from "@/lib/auth/session";
import { recordAudit, userLabel } from "@/lib/audit";
import { canManageGroup } from "@/lib/group-access";
import { MAX_TITLE_LENGTH, normalizeTitle } from "@/lib/page-title";

export type CreateRootState = { error?: string };

const CREATOR_ROLES = ["SITE_ADMIN", "CONTENT_MANAGER"];

// Creates a knowledge root and grants MANAGE on its root page to a group —
// never to the creator personally. With a new group, the creator joins it.
export async function createRoot(_prev: CreateRootState, formData: FormData): Promise<CreateRootState> {
  const user = await requireUser("/roots/new");
  if (!CREATOR_ROLES.includes(user.siteRole)) {
    return { error: "ナレッジルートを作成できるのは、コンテンツ管理者とサイト管理者だけです。" };
  }

  const rawTitle = formData.get("title");
  const title = typeof rawTitle === "string" ? normalizeTitle(rawTitle) : "";
  if (!title) return { error: "ナレッジルートの名前を入力してください。" };
  if (title.length > MAX_TITLE_LENGTH) return { error: `名前は${MAX_TITLE_LENGTH}文字以内にしてください。` };

  const shareWithAll = formData.get("shareWithAll") === "on";
  const mode = formData.get("groupMode");
  let groupId: string | null = null;
  let newGroupName: string | null = null;
  if (mode === "existing") {
    const id = formData.get("groupId");
    if (typeof id !== "string" || !id) return { error: "管理するグループを選んでください。" };
    // Same rule as /admin: a content manager can only use groups within
    // trees it already manages.
    if (!(await canManageGroup({ userId: user.id, role: user.siteRole }, id))) {
      return { error: "このグループは選べません。" };
    }
    const chosen = await prisma.group.findUnique({ where: { id }, select: { builtIn: true } });
    if (!chosen || chosen.builtIn) return { error: "このグループは選べません。" };
    groupId = id;
  } else {
    const raw = formData.get("newGroupName");
    newGroupName = typeof raw === "string" ? raw.trim() : "";
    if (!newGroupName) return { error: "新しいグループの名前を入力してください。" };
    if (newGroupName.length > 100) return { error: "グループ名は100文字以内にしてください。" };
    if (await prisma.group.findUnique({ where: { name: newGroupName }, select: { id: true } })) {
      return { error: "同じ名前のグループがすでにあります。" };
    }
  }

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
        data: { name: newGroupName!, description: "ナレッジルート作成時に作られた管理グループ" },
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
    `ナレッジルート「${title}」を作成し、グループ「${groupName}」に管理権限を付与` +
      (newGroupName ? "（グループを新規作成し、作成者が参加）" : "") +
      (shareWithAll ? "。全ユーザーに閲覧権限を付与" : ""),
    { rootPageId },
  );
  await reindexPage(prisma, rootPageId);
  redirect(`/pages/${rootPageId}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { normalizeEmail } from "@/lib/auth/session";
import { recordAudit, userLabel } from "@/lib/audit";
import { canManageGroup } from "@/lib/group-access";

// Content managers may only touch groups within trees they manage
// (lib/group-access.ts); every action re-checks that server-side.

export type GroupFormState = { error?: string; saved?: boolean };

const MAX_NAME_LENGTH = 100;
const NOT_ALLOWED = "このグループを編集する権限がありません。";

function readGroupFields(formData: FormData): { name: string; description: string | null } | string {
  const name = formData.get("name");
  const description = formData.get("description");
  if (typeof name !== "string" || name.trim() === "") return "グループ名を入力してください。";
  if (name.trim().length > MAX_NAME_LENGTH) return `グループ名は${MAX_NAME_LENGTH}文字以内にしてください。`;
  const desc = typeof description === "string" ? description.trim() : "";
  return { name: name.trim(), description: desc || null };
}

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === "P2002";

export async function createGroup(_prev: GroupFormState, formData: FormData): Promise<GroupFormState> {
  const { actor } = await requireAdmin();
  const fields = readGroupFields(formData);
  if (typeof fields === "string") return { error: fields };
  let id: string;
  try {
    ({ id } = await prisma.group.create({ data: fields, select: { id: true } }));
  } catch (err) {
    if (isUniqueViolation(err)) return { error: "同じ名前のグループがすでにあります。" };
    throw err;
  }
  await recordAudit(actor, "group.create", `グループ「${fields.name}」を作成`, { groupId: id });
  revalidatePath("/admin", "layout");
  redirect(`/admin/groups/${id}`);
}

export async function updateGroup(_prev: GroupFormState, formData: FormData): Promise<GroupFormState> {
  const { actor } = await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string") return { error: "入力内容が不正です。" };
  if (!(await canManageGroup(actor, id))) return { error: NOT_ALLOWED };
  const fields = readGroupFields(formData);
  if (typeof fields === "string") return { error: fields };
  const before = await prisma.group.findUnique({ where: { id }, select: { name: true } });
  if (!before) return { error: "グループが見つかりません。" };
  try {
    await prisma.group.update({ where: { id }, data: fields });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: "同じ名前のグループがすでにあります。" };
    throw err;
  }
  if (before.name !== fields.name) {
    await recordAudit(actor, "group.rename", `グループ「${before.name}」を「${fields.name}」に名前変更`, { groupId: id });
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export async function deleteGroup(formData: FormData): Promise<void> {
  const { actor } = await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string" || !(await canManageGroup(actor, id))) return;
  const group = await prisma.group.findUnique({ where: { id }, select: { name: true, builtIn: true } });
  // Built-in groups (e.g. 全ユーザー) can't be deleted.
  if (!group || group.builtIn) return;
  await prisma.group.delete({ where: { id } });
  await recordAudit(actor, "group.delete", `グループ「${group.name}」を削除（付いていた権限も削除）`, { groupId: id });
  revalidatePath("/admin", "layout");
  redirect("/admin/groups");
}

export type AddMemberState = { error?: string; added?: string };

export async function addGroupMember(_prev: AddMemberState, formData: FormData): Promise<AddMemberState> {
  const { actor } = await requireAdmin();
  const groupId = formData.get("groupId");
  const rawEmail = formData.get("email");
  if (typeof groupId !== "string" || typeof rawEmail !== "string" || rawEmail.trim() === "") {
    return { error: "メールアドレスを入力してください。" };
  }
  if (!(await canManageGroup(actor, groupId))) return { error: NOT_ALLOWED };
  const email = normalizeEmail(rawEmail);
  const [group, user] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, builtIn: true } }),
    prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } }),
  ]);
  if (!group) return { error: "グループが見つかりません。" };
  if (group.builtIn) return { error: "このグループのメンバーは自動で決まるため、追加できません。" };
  if (!user) {
    return { error: "このメールアドレスのユーザーはいません。先に「ユーザー」から招待してください。" };
  }
  const existing = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
    select: { userId: true },
  });
  if (!existing) {
    await prisma.groupMember.create({ data: { groupId, userId: user.id } });
    await recordAudit(actor, "group.member.add", `${userLabel(user)} をグループ「${group.name}」に追加`, {
      groupId,
      userId: user.id,
    });
  }
  revalidatePath("/admin", "layout");
  return { added: email };
}

export async function removeGroupMember(formData: FormData): Promise<void> {
  const { actor } = await requireAdmin();
  const groupId = formData.get("groupId");
  const userId = formData.get("userId");
  if (typeof groupId !== "string" || typeof userId !== "string") return;
  if (!(await canManageGroup(actor, groupId))) return;
  const [group, user] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId }, select: { name: true, builtIn: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
  ]);
  if (group?.builtIn) return;
  const { count } = await prisma.groupMember.deleteMany({ where: { groupId, userId } });
  if (count > 0 && group && user) {
    await recordAudit(actor, "group.member.remove", `${userLabel(user)} をグループ「${group.name}」から削除`, {
      groupId,
      userId,
    });
  }
  revalidatePath("/admin", "layout");
}

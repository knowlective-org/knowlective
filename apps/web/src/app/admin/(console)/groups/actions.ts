"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { normalizeEmail } from "@/lib/auth/session";
import { SITE_ADMINS } from "@/lib/groups";

export type GroupFormState = { error?: string; saved?: boolean };

const MAX_NAME_LENGTH = 100;

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
  await requireAdmin();
  const fields = readGroupFields(formData);
  if (typeof fields === "string") return { error: fields };
  let id: string;
  try {
    ({ id } = await prisma.group.create({ data: fields, select: { id: true } }));
  } catch (err) {
    if (isUniqueViolation(err)) return { error: "同じ名前のグループがすでにあります。" };
    throw err;
  }
  revalidatePath("/admin", "layout");
  redirect(`/admin/groups/${id}`);
}

export async function updateGroup(_prev: GroupFormState, formData: FormData): Promise<GroupFormState> {
  await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string") return { error: "入力内容が不正です。" };
  const fields = readGroupFields(formData);
  if (typeof fields === "string") return { error: fields };
  try {
    await prisma.group.update({ where: { id }, data: fields });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: "同じ名前のグループがすでにあります。" };
    throw err;
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export async function deleteGroup(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string") return;
  // Built-in groups (systemKey set) can't be deleted.
  await prisma.group.deleteMany({ where: { id, systemKey: null } });
  revalidatePath("/admin", "layout");
  redirect("/admin/groups");
}

export type AddMemberState = { error?: string; added?: string };

export async function addGroupMember(_prev: AddMemberState, formData: FormData): Promise<AddMemberState> {
  await requireAdmin();
  const groupId = formData.get("groupId");
  const rawEmail = formData.get("email");
  if (typeof groupId !== "string" || typeof rawEmail !== "string" || rawEmail.trim() === "") {
    return { error: "メールアドレスを入力してください。" };
  }
  const email = normalizeEmail(rawEmail);
  const [group, user] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId }, select: { id: true } }),
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (!group) return { error: "グループが見つかりません。" };
  if (!user) {
    return { error: "このメールアドレスのユーザーはいません。先に「ユーザー」から招待してください。" };
  }
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId, userId: user.id } },
    create: { groupId, userId: user.id },
    update: {},
  });
  revalidatePath("/admin", "layout");
  return { added: email };
}

export async function removeGroupMember(formData: FormData): Promise<void> {
  const { session } = await requireAdmin();
  const groupId = formData.get("groupId");
  const userId = formData.get("userId");
  if (typeof groupId !== "string" || typeof userId !== "string") return;

  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { systemKey: true } });
  if (!group) return;
  const isSiteAdminsGroup = group.systemKey === SITE_ADMINS;
  // Removing yourself from site admins would end your own session mid-change;
  // ask another admin (or use the master password) instead.
  if (isSiteAdminsGroup && userId === session.userId) return;

  await prisma.groupMember.deleteMany({ where: { groupId, userId } });
  if (isSiteAdminsGroup) {
    // Takes effect immediately anyway (requireAdmin re-checks membership),
    // but don't leave dead sessions listed.
    await prisma.adminSession.deleteMany({ where: { userId } });
  }
  revalidatePath("/admin", "layout");
}

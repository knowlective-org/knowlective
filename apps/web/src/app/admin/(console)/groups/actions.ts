"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auditTranslator } from "@/i18n/audit";
import { prisma } from "@/lib/db";
import { emailWhere, withEmail } from "@/lib/emails";
import { requireAdmin } from "@/lib/admin/auth";
import { normalizeEmail } from "@/lib/auth/session";
import { recordAudit, userLabel } from "@/lib/audit";
import { canManageGroup } from "@/lib/group-access";

// Content managers may only touch groups within trees they manage
// (lib/group-access.ts); every action re-checks that server-side.

export type GroupFormState = { error?: string; saved?: boolean };

const MAX_NAME_LENGTH = 100;
// Error messages, in the admin's language.
const errors = () => getTranslations("admin.groups.errors");

async function readGroupFields(formData: FormData): Promise<{ name: string; description: string | null } | string> {
  const name = formData.get("name");
  const description = formData.get("description");
  const t = await errors();
  if (typeof name !== "string" || name.trim() === "") return t("nameRequired");
  if (name.trim().length > MAX_NAME_LENGTH) return t("nameTooLong", { max: MAX_NAME_LENGTH });
  const desc = typeof description === "string" ? description.trim() : "";
  return { name: name.trim(), description: desc || null };
}

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === "P2002";

export async function createGroup(_prev: GroupFormState, formData: FormData): Promise<GroupFormState> {
  const { actor } = await requireAdmin();
  const fields = await readGroupFields(formData);
  if (typeof fields === "string") return { error: fields };
  let id: string;
  try {
    ({ id } = await prisma.group.create({ data: fields, select: { id: true } }));
  } catch (err) {
    if (isUniqueViolation(err)) return { error: (await errors())("exists") };
    throw err;
  }
  await recordAudit(actor, "group.create", (await auditTranslator())("audit.groupCreate", { name: fields.name }), { groupId: id });
  revalidatePath("/admin", "layout");
  redirect(`/admin/groups/${id}`);
}

export async function updateGroup(_prev: GroupFormState, formData: FormData): Promise<GroupFormState> {
  const { actor } = await requireAdmin();
  const id = formData.get("id");
  const t = await errors();
  if (typeof id !== "string") return { error: (await getTranslations())("common.errors.invalidInput") };
  if (!(await canManageGroup(actor, id))) return { error: t("notAllowed") };
  const fields = await readGroupFields(formData);
  if (typeof fields === "string") return { error: fields };
  const before = await prisma.group.findUnique({ where: { id }, select: { name: true } });
  if (!before) return { error: t("notFound") };
  try {
    await prisma.group.update({ where: { id }, data: fields });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: t("exists") };
    throw err;
  }
  if (before.name !== fields.name) {
    const audit = await auditTranslator();
    await recordAudit(actor, "group.rename", audit("audit.groupRename", { from: before.name, to: fields.name }), { groupId: id });
  }
  revalidatePath("/admin", "layout");
  return { saved: true };
}

export async function deleteGroup(formData: FormData): Promise<void> {
  const { actor } = await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string" || !(await canManageGroup(actor, id))) return;
  const group = await prisma.group.findUnique({ where: { id }, select: { name: true, builtIn: true } });
  // Built-in groups (e.g. all users) can't be deleted.
  if (!group || group.builtIn) return;
  await prisma.group.delete({ where: { id } });
  await recordAudit(actor, "group.delete", (await auditTranslator())("audit.groupDelete", { name: group.name }), { groupId: id });
  revalidatePath("/admin", "layout");
  redirect("/admin/groups");
}

export type AddMemberState = { error?: string; added?: string };

export async function addGroupMember(_prev: AddMemberState, formData: FormData): Promise<AddMemberState> {
  const { actor } = await requireAdmin();
  const groupId = formData.get("groupId");
  const rawEmail = formData.get("email");
  const t = await errors();
  if (typeof groupId !== "string" || typeof rawEmail !== "string" || rawEmail.trim() === "") {
    return { error: t("emailRequired") };
  }
  if (!(await canManageGroup(actor, groupId))) return { error: t("notAllowed") };
  const email = normalizeEmail(rawEmail);
  const [group, user] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, builtIn: true } }),
    prisma.user.findUnique({ where: await emailWhere(email), select: { id: true, name: true, emailEnc: true } }),
  ]);
  if (!group) return { error: t("notFound") };
  if (group.builtIn) return { error: t("builtIn") };
  if (!user) {
    return { error: t("noUser") };
  }
  const existing = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
    select: { userId: true },
  });
  if (!existing) {
    await prisma.groupMember.create({ data: { groupId, userId: user.id } });
    const audit = await auditTranslator();
    await recordAudit(actor, "group.member.add", audit("audit.groupMemberAdd", { who: userLabel(await withEmail(user)), group: group.name }), {
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
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, emailEnc: true } }),
  ]);
  if (group?.builtIn) return;
  const { count } = await prisma.groupMember.deleteMany({ where: { groupId, userId } });
  if (count > 0 && group && user) {
    const audit = await auditTranslator();
    await recordAudit(actor, "group.member.remove", audit("audit.groupMemberRemove", { who: userLabel(await withEmail(user)), group: group.name }), {
      groupId,
      userId,
    });
  }
  revalidatePath("/admin", "layout");
}

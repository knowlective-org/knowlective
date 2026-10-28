"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auditTranslator } from "@/i18n/audit";
import { prisma } from "@/lib/db";
import { withEmail, withEmails } from "@/lib/emails";
import { requireAdmin } from "@/lib/admin/auth";
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

// ---- Adding members ---------------------------------------------------------
// The form searches as the admin types (searchMemberCandidates), collects the
// people picked, and adds them all at once (addGroupMembers).

export type MemberCandidate = { id: string; name: string | null; email: string; disabled: boolean };

const MAX_CANDIDATES = 10;
const MAX_QUERY_LENGTH = 100;
// People added in one go.
const MAX_MEMBERS_PER_ADD = 100;

// Matching ignores case and full-/half-width differences.
const fold = (text: string) => text.normalize("NFKC").toLowerCase();

// Users matching `query` by display name or email address (every word must
// match one of them), who aren't in the group yet. Email addresses are
// stored encrypted, so they're opened and matched here rather than in SQL.
export async function searchMemberCandidates(groupId: string, query: string): Promise<MemberCandidate[]> {
  const { actor } = await requireAdmin();
  if (typeof groupId !== "string" || typeof query !== "string") return [];
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || query.length > MAX_QUERY_LENGTH) return [];
  if (!(await canManageGroup(actor, groupId))) return [];
  const [users, members] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, emailEnc: true, disabledAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.groupMember.findMany({ where: { groupId }, select: { userId: true } }),
  ]);
  const inGroup = new Set(members.map((m) => m.userId));
  const scored: { candidate: MemberCandidate; score: number }[] = [];
  for (const user of await withEmails(users.filter((u) => !inGroup.has(u.id) && u.emailEnc))) {
    const name = fold(user.name ?? "");
    const email = fold(user.email);
    if (!words.every((w) => name.includes(w) || email.includes(w))) continue;
    // Names or addresses that start with the first word come first.
    const score = name.startsWith(words[0]) || email.startsWith(words[0]) ? 0 : 1;
    scored.push({ candidate: { id: user.id, name: user.name, email: user.email, disabled: user.disabledAt !== null }, score });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_CANDIDATES)
    .map((s) => s.candidate);
}

export type AddMembersResult = { error?: string; added?: number };

// Adds the picked people (each recorded in the audit log). People already in
// the group are skipped.
export async function addGroupMembers(groupId: string, userIds: string[]): Promise<AddMembersResult> {
  const { actor } = await requireAdmin();
  const t = await errors();
  if (typeof groupId !== "string" || !Array.isArray(userIds) || !userIds.every((id) => typeof id === "string")) {
    return { error: (await getTranslations())("common.errors.invalidInput") };
  }
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return { error: t("pickSomeone") };
  if (ids.length > MAX_MEMBERS_PER_ADD) return { error: t("tooMany", { max: MAX_MEMBERS_PER_ADD }) };
  if (!(await canManageGroup(actor, groupId))) return { error: t("notAllowed") };
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, builtIn: true } });
  if (!group) return { error: t("notFound") };
  if (group.builtIn) return { error: t("builtIn") };
  const [users, existing] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, emailEnc: true } }),
    prisma.groupMember.findMany({ where: { groupId, userId: { in: ids } }, select: { userId: true } }),
  ]);
  if (users.length !== ids.length) return { error: t("noUser") };
  const already = new Set(existing.map((m) => m.userId));
  const adding = users.filter((u) => !already.has(u.id));
  if (adding.length > 0) {
    await prisma.groupMember.createMany({ data: adding.map((u) => ({ groupId, userId: u.id })), skipDuplicates: true });
    const audit = await auditTranslator();
    for (const user of await withEmails(adding)) {
      await recordAudit(actor, "group.member.add", audit("audit.groupMemberAdd", { who: userLabel(user), group: group.name }), {
        groupId,
        userId: user.id,
      });
    }
  }
  revalidatePath("/admin", "layout");
  return { added: adding.length };
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

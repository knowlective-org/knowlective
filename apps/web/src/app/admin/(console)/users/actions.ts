"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SiteRole } from "shared";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { ADMIN_CONSOLE_ROLES, SITE_ROLES, SITE_ROLE_LABELS, countOtherActiveSiteAdmins } from "@/lib/roles";
import { type AuditActor, recordAudit, userLabel } from "@/lib/audit";

async function audit(actor: AuditActor, action: string, userId: string, summary: (who: string) => string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  if (user) await recordAudit(actor, action, summary(userLabel(user)), { userId });
}

// Site admins only. Never leave the instance without an enabled site admin:
// demoting or disabling the last one is refused (the master password could
// still recover, but that's a server-side task).
async function refuseIfLastSiteAdmin(userId: string): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { siteRole: true, disabledAt: true },
  });
  if (target?.siteRole === "SITE_ADMIN" && !target.disabledAt && (await countOtherActiveSiteAdmins(userId)) === 0) {
    redirect("/admin/users?error=last-site-admin");
  }
}

// Disabling keeps the account and its knowledge root/group memberships, so
// re-enabling restores access as it was. It takes effect immediately: every
// session is deleted, and getCurrentUser / requireAdmin / the collab server
// all refuse disabled accounts on their own as well.
export async function disableUser(formData: FormData): Promise<void> {
  const { session, actor } = await requireAdmin(["SITE_ADMIN"]);
  const userId = formData.get("userId");
  if (typeof userId !== "string") return;
  // Disabling yourself would lock you out mid-change.
  if (userId === session.userId) return;
  await refuseIfLastSiteAdmin(userId);

  await prisma.$transaction([
    prisma.user.updateMany({
      where: { id: userId, disabledAt: null },
      data: { disabledAt: new Date() },
    }),
    prisma.userSession.deleteMany({ where: { userId } }),
    prisma.adminSession.deleteMany({ where: { userId } }),
  ]);
  await audit(actor, "user.disable", userId, (who) => `${who} を無効化`);
  revalidatePath("/admin", "layout");
}

export async function enableUser(formData: FormData): Promise<void> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const userId = formData.get("userId");
  if (typeof userId !== "string") return;
  await prisma.user.updateMany({ where: { id: userId }, data: { disabledAt: null } });
  await audit(actor, "user.enable", userId, (who) => `${who} を有効化`);
  revalidatePath("/admin", "layout");
}

export async function changeSiteRole(formData: FormData): Promise<void> {
  const { session, actor } = await requireAdmin(["SITE_ADMIN"]);
  const userId = formData.get("userId");
  const siteRole = formData.get("siteRole");
  if (typeof userId !== "string" || !SITE_ROLES.includes(siteRole as SiteRole)) return;
  // Changing your own role could drop you out of this screen mid-change.
  if (userId === session.userId) return;
  if (siteRole !== "SITE_ADMIN") await refuseIfLastSiteAdmin(userId);

  const before = await prisma.user.findUnique({ where: { id: userId }, select: { siteRole: true } });
  if (!before || before.siteRole === siteRole) return;
  await prisma.user.update({ where: { id: userId }, data: { siteRole: siteRole as SiteRole } });
  await audit(
    actor,
    "user.role",
    userId,
    (who) => `${who} のロールを「${SITE_ROLE_LABELS[before.siteRole]}」から「${SITE_ROLE_LABELS[siteRole as SiteRole]}」に変更`,
  );
  // Losing /admin access ends any admin session now (requireAdmin would
  // refuse it on the next request anyway).
  if (!ADMIN_CONSOLE_ROLES.includes(siteRole as SiteRole)) {
    await prisma.adminSession.deleteMany({ where: { userId } });
  }
  revalidatePath("/admin", "layout");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auditTranslator } from "@/i18n/audit";
import type { SiteRole } from "shared";
import { prisma } from "@/lib/db";
import { withEmail } from "@/lib/emails";
import { requireAdmin } from "@/lib/admin/auth";
import { ADMIN_CONSOLE_ROLES, SITE_ROLES, countOtherActiveSiteAdmins } from "@/lib/roles";
import { type AuditActor, recordAudit, userLabel } from "@/lib/audit";
import { ADMIN_PASSWORD_RESET_TTL_HOURS, createPasswordReset } from "@/lib/auth/password-reset";
import { passwordLoginAllowed } from "@/lib/auth/oidc";
import { sendMail } from "@/lib/mail";
import { passwordResetMail } from "@/lib/mail-templates";
import { userLocale } from "@/i18n/locale";
import { getPublicUrl } from "@/lib/site-url";

type AuditText = Awaited<ReturnType<typeof auditTranslator>>;

async function audit(actor: AuditActor, action: string, userId: string, summary: (t: AuditText, who: string) => string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, emailEnc: true } });
  if (user) await recordAudit(actor, action, summary(await auditTranslator(), userLabel(await withEmail(user))), { userId });
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
  await audit(actor, "user.disable", userId, (t, who) => t("audit.userDisable", { who }));
  revalidatePath("/admin", "layout");
}

export async function enableUser(formData: FormData): Promise<void> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const userId = formData.get("userId");
  if (typeof userId !== "string") return;
  await prisma.user.updateMany({ where: { id: userId }, data: { disabledAt: null } });
  await audit(actor, "user.enable", userId, (t, who) => t("audit.userEnable", { who }));
  revalidatePath("/admin", "layout");
}

// For someone who lost their passkeys (where the site requires them, the
// only way back in): removes them all and ends the account's sessions, so it
// signs in with its password again and registers a new one.
export async function resetPasskeys(formData: FormData): Promise<void> {
  const { actor } = await requireAdmin(["SITE_ADMIN"]);
  const userId = formData.get("userId");
  if (typeof userId !== "string") return;
  const [{ count }] = await prisma.$transaction([
    prisma.userPasskey.deleteMany({ where: { userId } }),
    prisma.userSession.deleteMany({ where: { userId } }),
  ]);
  if (count > 0) {
    await audit(actor, "user.passkeys.reset", userId, (t, who) => t("audit.passkeysReset", { who, count }));
  }
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
    (t, who) => t("audit.userRole", { who, from: t(`roles.${before.siteRole}`), to: t(`roles.${siteRole as SiteRole}`) }),
  );
  // Losing /admin access ends any admin session now (requireAdmin would
  // refuse it on the next request anyway).
  if (!ADMIN_CONSOLE_ROLES.includes(siteRole as SiteRole)) {
    await prisma.adminSession.deleteMany({ where: { userId } });
  }
  revalidatePath("/admin", "layout");
}

// From the user list's "⋯" menu: the link is issued on its own page so it
// can be shown once (a menu item can't display a result).
export async function openPasswordReset(formData: FormData): Promise<void> {
  await requireAdmin(["SITE_ADMIN"]);
  const userId = formData.get("userId");
  if (typeof userId !== "string") return;
  redirect(`/admin/users/${encodeURIComponent(userId)}/password-reset`);
}

export type PasswordResetIssueState = { error?: string; link?: string; mailSentTo?: string; mailError?: string };

// Site admins only. Issues a reset link for another user, shown once and
// optionally mailed. Any earlier link for the user stops working. The
// password itself only changes when the user opens the link.
export async function issuePasswordReset(
  _prev: PasswordResetIssueState,
  formData: FormData,
): Promise<PasswordResetIssueState> {
  const { session, actor } = await requireAdmin(["SITE_ADMIN"]);
  const userId = formData.get("userId");
  const t = await getTranslations();
  if (typeof userId !== "string") return { error: t("common.errors.invalidInput") };
  if (userId === session.userId) return { error: t("admin.users.errors.ownReset") };
  const found = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailEnc: true, name: true, siteRole: true, disabledAt: true },
  });
  const user = found && (await withEmail(found));
  if (!user) return { error: t("admin.users.errors.notFound") };
  if (user.disabledAt) return { error: t("admin.users.errors.disabled") };
  if (!(await passwordLoginAllowed(user.siteRole))) {
    return { error: t("admin.users.errors.ssoOnly") };
  }

  const token = await createPasswordReset(userId, { byAdmin: true });
  const who = userLabel(user);
  await recordAudit(actor, "user.password.reset.issue", (await auditTranslator())("audit.userResetIssue", { who }), { userId });
  const link = `${await getPublicUrl()}/reset-password/${token}`;
  if (formData.get("sendEmail") !== "on") return { link };

  // The link stays valid even if sending fails; it is still shown on screen.
  try {
    await sendMail({
      to: user.email,
      ...passwordResetMail(await userLocale(userId), { link, ttlMinutes: ADMIN_PASSWORD_RESET_TTL_HOURS * 60, byAdmin: true }),
    });
    return { link, mailSentTo: user.email };
  } catch (err) {
    return { link, mailError: err instanceof Error ? err.message : String(err) };
  }
}

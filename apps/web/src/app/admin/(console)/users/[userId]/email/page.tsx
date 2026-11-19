import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { withEmail } from "@/lib/emails";
import { requireAdmin } from "@/lib/admin/auth";
import { userLabel } from "@/lib/audit";
import { ADMIN_EMAIL_CHANGE_TTL_HOURS, pendingAdminEmailChange } from "@/lib/auth/admin-email-change";
import { isMailConfigured } from "@/lib/mail";
import styles from "@/styles/ui.module.css";
import { AdminEmailChangeForm, CancelEmailChangeForm } from "./email-change-form";

// Site admins only: change another user's email address. A code is mailed to
// the new address and the user confirms it on their account screen.
export default async function AdminEmailChangePage({ params }: PageProps<"/admin/users/[userId]/email">) {
  const { session } = await requireAdmin(["SITE_ADMIN"]);
  const { userId } = await params;
  const found = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, emailEnc: true, name: true, disabledAt: true },
  });
  const user = found && (await withEmail(found));
  if (!user || user.id === session.userId) notFound();
  const [mailConfigured, pending, t, format] = await Promise.all([
    isMailConfigured(),
    pendingAdminEmailChange(user.id),
    getTranslations("admin.emailChange"),
    getFormatter(),
  ]);

  return (
    <>
      <p className={styles.note} style={{ marginBottom: 16 }}>
        <Link data-ui="AdminEmailChangePage.backLink" href="/admin/users" style={{ textDecoration: "underline" }}>
          {t("back")}
        </Link>
      </p>
      <section className={styles.section} data-ui="AdminEmailChangePage">
        <h2 className={styles.sectionTitle}>{t("heading", { user: userLabel(user) })}</h2>
        <p className={styles.note}>{t("current")}</p>
        <p style={{ margin: "4px 0 16px" }} data-ui="AdminEmailChangePage.currentEmail">
          {user.email}
        </p>
        {user.disabledAt ? (
          <p className={styles.note} data-ui="AdminEmailChangePage.disabledNote">
            {t("disabled")}
          </p>
        ) : !mailConfigured ? (
          <p className={styles.note} data-ui="AdminEmailChangePage.mailNote">
            {t("mailNotConfigured")}
          </p>
        ) : (
          <>
            {pending && (
              <div style={{ marginBottom: 16 }}>
                <p className={styles.success} data-ui="AdminEmailChangePage.pendingStatus">
                  {t("pending", {
                    email: pending.newEmail,
                    expires: format.dateTime(pending.expiresAt, { dateStyle: "medium", timeStyle: "short" }),
                  })}
                </p>
                <p className={styles.note}>{t("pendingNote")}</p>
                <CancelEmailChangeForm userId={user.id} email={pending.newEmail} />
              </div>
            )}
            <p className={styles.note} style={{ marginBottom: 12 }}>
              {t("lead", { hours: ADMIN_EMAIL_CHANGE_TTL_HOURS })}
            </p>
            <AdminEmailChangeForm userId={user.id} />
          </>
        )}
      </section>
    </>
  );
}

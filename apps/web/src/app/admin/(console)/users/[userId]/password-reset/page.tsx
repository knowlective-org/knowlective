import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { withEmail } from "@/lib/emails";
import { requireAdmin } from "@/lib/admin/auth";
import { userLabel } from "@/lib/audit";
import { ADMIN_PASSWORD_RESET_TTL_HOURS } from "@/lib/auth/password-reset";
import { passwordLoginAllowed } from "@/lib/auth/oidc";
import { isMailConfigured } from "@/lib/mail";
import styles from "@/styles/ui.module.css";
import { PasswordResetIssueForm } from "./password-reset-form";

// Site admins only: issue a password reset link for another user.
export default async function AdminPasswordResetPage({ params }: PageProps<"/admin/users/[userId]/password-reset">) {
  const { session } = await requireAdmin(["SITE_ADMIN"]);
  const { userId } = await params;
  const found = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, emailEnc: true, name: true, siteRole: true, disabledAt: true },
  });
  const user = found && (await withEmail(found));
  if (!user || user.id === session.userId) notFound();
  const [mailConfigured, passwordAllowed, t] = await Promise.all([
    isMailConfigured(),
    passwordLoginAllowed(user.siteRole),
    getTranslations("admin.passwordReset"),
  ]);

  return (
    <>
      <p className={styles.note} style={{ marginBottom: 16 }}>
        <Link data-ui="AdminPasswordResetPage.backLink" href="/admin/users" style={{ textDecoration: "underline" }}>
          {t("back")}
        </Link>
      </p>
      <section className={styles.section} data-ui="AdminPasswordResetPage">
        <h2 className={styles.sectionTitle}>{t("heading", { user: userLabel(user) })}</h2>
        {user.disabledAt ? (
          <p className={styles.note} data-ui="AdminPasswordResetPage.disabledNote">
            {t("disabled")}
          </p>
        ) : !passwordAllowed ? (
          <p className={styles.note} data-ui="AdminPasswordResetPage.ssoOnlyNote">
            {t("ssoOnly")}
          </p>
        ) : (
          <>
            <p className={styles.note} style={{ marginBottom: 12 }}>
              {t("lead")} {t("lead2")}
            </p>
            <PasswordResetIssueForm
              userId={user.id}
              email={user.email}
              ttlHours={ADMIN_PASSWORD_RESET_TTL_HOURS}
              mailConfigured={mailConfigured}
            />
          </>
        )}
      </section>
    </>
  );
}

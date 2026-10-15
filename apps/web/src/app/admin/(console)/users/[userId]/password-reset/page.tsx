import Link from "next/link";
import { notFound } from "next/navigation";
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
  const [mailConfigured, passwordAllowed] = await Promise.all([
    isMailConfigured(),
    passwordLoginAllowed(user.siteRole),
  ]);

  return (
    <>
      <p className={styles.note} style={{ marginBottom: 16 }}>
        <Link data-ui="AdminPasswordResetPage.backLink" href="/admin/users" style={{ textDecoration: "underline" }}>
          ← ユーザー一覧
        </Link>
      </p>
      <section className={styles.section} data-ui="AdminPasswordResetPage">
        <h2 className={styles.sectionTitle}>パスワードの再設定: {userLabel(user)}</h2>
        {user.disabledAt ? (
          <p className={styles.note} data-ui="AdminPasswordResetPage.disabledNote">
            このユーザーは無効になっています。再設定リンクを発行するには、先に有効にしてください。
          </p>
        ) : !passwordAllowed ? (
          <p className={styles.note} data-ui="AdminPasswordResetPage.ssoOnlyNote">
            シングルサインオンのみの設定のため、このユーザーはパスワードでログインできません。
          </p>
        ) : (
          <>
            <p className={styles.note} style={{ marginBottom: 12 }}>
              本人が新しいパスワードを設定するためのリンクを発行します。パスワードはリンクを開いて設定するまで変わりません。
              設定すると、ログイン中の端末はすべてログアウトします。以前に発行したリンクは使えなくなります。
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

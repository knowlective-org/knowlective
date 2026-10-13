import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MIN_PASSWORD_LENGTH, isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { findValidPasswordReset } from "@/lib/auth/password-reset";
import { passwordLoginAllowed } from "@/lib/auth/oidc";
import styles from "@/styles/ui.module.css";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "パスワードの再設定 | YOSUGA",
  robots: { index: false, follow: false },
};

// Opened from a reset link (lib/auth/password-reset.ts). Works whether or not
// someone is logged in in this browser: the link alone decides the account.
export default async function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  if (!(await isSetupComplete(prisma))) redirect("/setup");
  const { token } = await params;
  const reset = await findValidPasswordReset(token);
  const ssoOnly = reset !== null && !(await passwordLoginAllowed(reset.user.siteRole));

  if (!reset || ssoOnly) {
    return (
      <main className={styles.narrow} data-ui="ResetPasswordPage">
        <h1 className={styles.title}>再設定用のリンクが無効です</h1>
        <p className={styles.lead} data-ui="ResetPasswordPage.invalid">
          {ssoOnly
            ? "パスワードでのログインは無効になっています。シングルサインオンでログインしてください。"
            : "このリンクは使用済みか、期限が切れています。新しいリンクを発行した場合は、最後に届いたリンクだけが使えます。"}
        </p>
        <p className={styles.note}>
          {!ssoOnly && (
            <>
              <Link href="/forgot-password" data-ui="ResetPasswordPage.forgotPasswordLink">もう一度申し込む</Link>
              {" ／ "}
            </>
          )}
          <Link href="/login" data-ui="ResetPasswordPage.loginLink">ログイン画面へ</Link>
        </p>
      </main>
    );
  }

  return (
    <main className={styles.narrow} data-ui="ResetPasswordPage">
      <h1 className={styles.title}>パスワードの再設定</h1>
      <p className={styles.lead}>
        新しいパスワードを設定してください。設定すると、ログイン中の端末はすべてログアウトします。
      </p>
      <ResetPasswordForm token={token} email={reset.user.email} minLength={MIN_PASSWORD_LENGTH} />
    </main>
  );
}

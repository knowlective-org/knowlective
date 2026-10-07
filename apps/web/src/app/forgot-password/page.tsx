import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { PASSWORD_RESET_TTL_MINUTES } from "@/lib/auth/password-reset";
import { isMailConfigured } from "@/lib/mail";
import styles from "@/styles/ui.module.css";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "パスワードの再設定 | yosuga" };

// Asks for an email address and mails a reset link (lib/auth/password-reset.ts).
export default async function ForgotPasswordPage() {
  await connection();
  if (!(await isSetupComplete(prisma))) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const mailConfigured = await isMailConfigured();

  return (
    <main className={styles.narrow} data-ui="ForgotPasswordPage">
      <h1 className={styles.title}>パスワードの再設定</h1>
      {mailConfigured ? (
        <>
          <p className={styles.lead}>
            登録したメールアドレスを入力してください。パスワードを再設定するためのリンクをお送りします。
          </p>
          <ForgotPasswordForm ttlMinutes={PASSWORD_RESET_TTL_MINUTES} />
        </>
      ) : (
        <p className={styles.lead} data-ui="ForgotPasswordPage.mailNotConfigured">
          メールでの再設定は利用できません。管理者に連絡して、再設定用のリンクを発行してもらってください。
        </p>
      )}
      <p className={styles.note} style={{ marginTop: 24 }}>
        <Link href="/login" data-ui="ForgotPasswordPage.loginLink">ログイン画面へ戻る</Link>
      </p>
    </main>
  );
}

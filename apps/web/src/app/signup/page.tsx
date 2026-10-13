import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isSetupComplete } from "shared";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { SIGNUP_TTL_HOURS, getSignupSettings } from "@/lib/auth/signup";
import styles from "@/styles/ui.module.css";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "アカウント登録 | YOSUGA" };

// Self-registration: asks for an email address and mails a registration link
// (lib/auth/signup.ts). Only when an admin has turned it on.
export default async function SignupPage() {
  await connection();
  if (!(await isSetupComplete(prisma))) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const settings = await getSignupSettings();

  return (
    <main className={styles.narrow} data-ui="SignupPage">
      <h1 className={styles.title}>アカウント登録</h1>
      {settings.enabled ? (
        <>
          <p className={styles.lead}>メールアドレスを入力してください。登録用のリンクをお送りします。</p>
          <SignupForm allowedDomains={settings.allowedDomains} ttlHours={SIGNUP_TTL_HOURS} />
        </>
      ) : (
        <p className={styles.lead} data-ui="SignupPage.closed">
          アカウントは招待制です。管理者から届いた招待リンクから登録してください。
        </p>
      )}
      <p className={styles.note} style={{ marginTop: 24 }}>
        すでにアカウントをお持ちの場合は<Link href="/login">ログイン</Link>してください。
      </p>
    </main>
  );
}

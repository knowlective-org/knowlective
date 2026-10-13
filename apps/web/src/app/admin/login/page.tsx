import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { assertIpAllowed, getAdminConfig, getAdminSession } from "@/lib/admin/auth";
import { getRequestContext } from "@/lib/request";
import styles from "@/styles/ui.module.css";
import { AccountLoginForm, MasterLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "管理画面ログイン | YOSUGA",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const ctx = await getRequestContext();
  const config = await getAdminConfig();
  assertIpAllowed(ctx.ip, config.adminIpAllowlist);

  const session = await getAdminSession();
  if (session?.stage === "ACTIVE") redirect("/admin");
  if (session?.stage === "ENROLL_TOTP") redirect("/admin/enroll");
  if (session?.stage === "VERIFY_TOTP") redirect("/admin/login/verify");

  const master = (await searchParams).mode === "master";
  if (master) {
    const enrolled = config.totpSecret !== null;
    return (
      <main className={styles.narrow} data-ui="AdminLoginPage">
        <h1 className={styles.title}>マスターパスワードでログイン</h1>
        <p className={styles.lead}>
          最初のサイト管理者を登録するときや、管理者全員がログインできなくなったときに使います。
          {!enrolled && " 初回は、マスターパスワードを確認したあとに認証アプリを登録します。"}
        </p>
        <MasterLoginForm needsCode={enrolled} />
        <p className={styles.note} style={{ marginTop: 24 }}>
          <Link href="/admin/login" data-ui="AdminLoginPage.accountLoginLink" style={{ textDecoration: "underline" }}>
            アカウントでログインする
          </Link>
        </p>
        <p className={styles.note} style={{ marginTop: 8 }}>
          <Link href="/" data-ui="AdminLoginPage.appLink" style={{ textDecoration: "underline" }}>
            アプリに戻る
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className={styles.narrow} data-ui="AdminLoginPage">
      <h1 className={styles.title}>管理画面ログイン</h1>
      <p className={styles.lead}>
        「サイト管理者」または「コンテンツ管理者」のロールを持つアカウントでログインします。
        パスワードを確認したあと、認証アプリのコードを入力します。初めてログインするときは、ここで認証アプリを登録します。
      </p>
      <AccountLoginForm />
      <p className={styles.note} style={{ marginTop: 24 }}>
        <Link href="/admin/login?mode=master" data-ui="AdminLoginPage.masterLoginLink" style={{ textDecoration: "underline" }}>
          マスターパスワードでログインする（初期設定・復旧用）
        </Link>
      </p>
      <p className={styles.note} style={{ marginTop: 8 }}>
        <Link href="/" data-ui="AdminLoginPage.appLink" style={{ textDecoration: "underline" }}>
          アプリに戻る
        </Link>
      </p>
    </main>
  );
}

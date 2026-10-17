import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { assertIpAllowed, getAdminConfig, getAdminSession } from "@/lib/admin/auth";
import { getRequestContext } from "@/lib/request";
import styles from "@/styles/ui.module.css";
import { cancelAccountLogin } from "../actions";
import { VerifyCodeForm } from "../login-form";

export const metadata: Metadata = {
  title: "認証コードの入力 | KNOWLECTIVE",
  robots: { index: false, follow: false },
};

// Second step of the account sign-in: the password is verified, the
// authenticator code is not yet.
export default async function AdminLoginVerifyPage() {
  const ctx = await getRequestContext();
  const config = await getAdminConfig();
  assertIpAllowed(ctx.ip, config.adminIpAllowlist);

  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (session.stage === "ACTIVE") redirect("/admin");
  if (session.stage === "ENROLL_TOTP") redirect("/admin/enroll");
  if (!session.user) redirect("/admin/login");

  return (
    <main className={styles.narrow} data-ui="AdminLoginVerifyPage">
      <h1 className={styles.title}>認証コードの入力</h1>
      <p className={styles.lead}>
        {session.user.email} でログインします。認証アプリに表示されている6桁のコードを入力してください。
      </p>
      <VerifyCodeForm />
      <p className={styles.note} style={{ margin: "16px 0" }}>
        この画面は10分で無効になります。期限が切れたら、もう一度ログインしてください。
      </p>
      <form action={cancelAccountLogin} data-ui="AdminLoginVerifyPage.cancelForm">
        <button
          type="submit"
          className={styles.note}
          style={{ textDecoration: "underline", background: "none", border: "none", padding: 0, cursor: "pointer" }}
          data-ui="AdminLoginVerifyPage.cancelButton"
        >
          別のアカウントでログインする
        </button>
      </form>
    </main>
  );
}

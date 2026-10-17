import type { Metadata } from "next";
import { connection } from "next/server";
import { ownPasswordResetAvailability } from "@/lib/auth/own-password-reset";
import { PASSWORD_RESET_TTL_MINUTES } from "@/lib/auth/password-reset";
import { requireUser } from "@/lib/auth/session";
import { SITE_ROLE_LABELS } from "@/lib/roles";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import { OwnPasswordResetForm } from "./password-reset-form";

export const metadata: Metadata = { title: "アカウント | KNOWLECTIVE" };

// The signed-in user's own account: who they are, and resetting their
// password.
export default async function AccountPage() {
  await connection();
  const user = await requireUser("/account");
  const [sidebar, reset] = await Promise.all([loadSidebar(user), ownPasswordResetAvailability(user.id)]);

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} />}>
      <div className={`${styles.pane} ${styles.paneNarrow}`} data-ui="AccountPage">
        <h1 className={styles.title}>アカウント</h1>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>登録内容</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: 0 }}>
            <dt className={styles.note}>名前</dt>
            <dd style={{ margin: 0 }}>{user.name ?? "—"}</dd>
            <dt className={styles.note}>メールアドレス</dt>
            <dd style={{ margin: 0 }} data-ui="AccountPage.email">
              {user.email}
            </dd>
            <dt className={styles.note}>ロール</dt>
            <dd style={{ margin: 0 }}>{SITE_ROLE_LABELS[user.siteRole]}</dd>
          </dl>
        </section>

        <section className={styles.section} data-ui="AccountPage.passwordSection">
          <h2 className={styles.sectionTitle}>パスワードの再設定</h2>
          {reset.available ? (
            <OwnPasswordResetForm email={user.email} ttlMinutes={PASSWORD_RESET_TTL_MINUTES} />
          ) : (
            <p className={styles.note} data-ui="AccountPage.passwordUnavailable" data-reason={reset.reason}>
              {reset.reason === "sso"
                ? "このアカウントはシングルサインオンでログインするため、ここではパスワードを再設定できません。"
                : "メール送信が設定されていないため、ここではパスワードを再設定できません。再設定が必要な場合は、管理者に連絡してください（管理者が再設定用のリンクを発行できます）。"}
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}

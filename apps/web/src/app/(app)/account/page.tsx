import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/locales";
import { prisma } from "@/lib/db";
import { ownPasswordResetAvailability } from "@/lib/auth/own-password-reset";
import { PASSWORD_RESET_TTL_MINUTES } from "@/lib/auth/password-reset";
import { requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import { LocaleForm } from "./locale-form";
import { OwnPasswordResetForm } from "./password-reset-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("account.title") }) };
}

// The signed-in user's own account: who they are, their display language,
// and resetting their password.
export default async function AccountPage() {
  await connection();
  const user = await requireUser("/account");
  const [sidebar, reset, t, { locale }] = await Promise.all([
    loadSidebar(user),
    ownPasswordResetAvailability(user.id),
    getTranslations(),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { locale: true } }),
  ]);

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} />}>
      <div className={`${styles.pane} ${styles.paneNarrow}`} data-ui="AccountPage">
        <h1 className={styles.title}>{t("account.title")}</h1>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t("account.details")}</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: 0 }}>
            <dt className={styles.note}>{t("account.name")}</dt>
            <dd style={{ margin: 0 }}>{user.name ?? "—"}</dd>
            <dt className={styles.note}>{t("account.email")}</dt>
            <dd style={{ margin: 0 }} data-ui="AccountPage.email">
              {user.email}
            </dd>
            <dt className={styles.note}>{t("account.role")}</dt>
            <dd style={{ margin: 0 }}>{t(`roles.${user.siteRole}`)}</dd>
          </dl>
        </section>

        <section className={styles.section} data-ui="AccountPage.languageSection">
          <h2 className={styles.sectionTitle}>{t("account.language.heading")}</h2>
          <LocaleForm current={isLocale(locale) ? locale : null} />
        </section>

        <section className={styles.section} data-ui="AccountPage.passwordSection">
          <h2 className={styles.sectionTitle}>{t("account.passwordReset.heading")}</h2>
          {reset.available ? (
            <OwnPasswordResetForm email={user.email} ttlMinutes={PASSWORD_RESET_TTL_MINUTES} />
          ) : (
            <p className={styles.note} data-ui="AccountPage.passwordUnavailable" data-reason={reset.reason}>
              {reset.reason === "sso" ? t("account.passwordReset.ssoUnavailable") : t("account.passwordReset.mailUnavailable")}
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}

import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/locales";
import { prisma } from "@/lib/db";
import { ownPasswordResetAvailability } from "@/lib/auth/own-password-reset";
import { PASSWORD_RESET_TTL_MINUTES } from "@/lib/auth/password-reset";
import { canIssueApiKeys, getApiSettings, listApiKeys } from "@/lib/api/keys";
import { listPasskeys, passkeyRequiredSetting } from "@/lib/auth/passkeys";
import { reauthMethod } from "@/lib/auth/reauth";
import { getPublicUrl } from "@/lib/site-url";
import { getSessionUser, requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import { LocaleForm } from "./locale-form";
import { ApiKeySection } from "./api-key-section";
import { PasskeySection } from "./passkey-section";
import { ProfileSection } from "./profile-section";
import { MAX_NAME_LENGTH, profileRules } from "@/lib/auth/profile";
import { OwnPasswordResetForm } from "./password-reset-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("account.title") }) };
}

// The signed-in user's own account: who they are, their display language,
// their passkeys and API keys, and resetting their password.
export default async function AccountPage() {
  await connection();
  const user = await requireUser("/account");
  const [sidebar, reset, t, { locale }, passkeys, passkeyRequired, session] = await Promise.all([
    loadSidebar(user),
    ownPasswordResetAvailability(user.id),
    getTranslations(),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { locale: true } }),
    listPasskeys(user.id),
    passkeyRequiredSetting(),
    getSessionUser(),
  ]);
  const [apiKeys, canIssue, apiSettings, method, publicUrl, rules] = await Promise.all([
    listApiKeys(user.id),
    canIssueApiKeys(user.siteRole),
    getApiSettings(),
    reauthMethod(user.id),
    getPublicUrl(),
    profileRules(user.id),
  ]);
  const now = new Date();

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} />}>
      <div className={`${styles.pane} ${styles.paneNarrow}`} data-ui="AccountPage">
        <h1 className={styles.title}>{t("account.title")}</h1>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t("account.details")}</h2>
          <ProfileSection
            name={user.name}
            email={user.email}
            rules={rules}
            method={method}
            maxNameLength={MAX_NAME_LENGTH}
          />
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: "24px 0 0" }}>
            <dt className={styles.note}>{t("account.role")}</dt>
            <dd style={{ margin: 0 }}>{t(`roles.${user.siteRole}`)}</dd>
          </dl>
        </section>

        <section className={styles.section} data-ui="AccountPage.languageSection">
          <h2 className={styles.sectionTitle}>{t("account.language.heading")}</h2>
          <LocaleForm current={isLocale(locale) ? locale : null} />
        </section>

        <section className={styles.section} data-ui="AccountPage.passkeySection">
          <h2 className={styles.sectionTitle}>{t("account.passkeys.heading")}</h2>
          <PasskeySection
            passkeys={passkeys.map((p) => ({
              id: p.id,
              name: p.name,
              createdAt: p.createdAt.toISOString(),
              lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
            }))}
            required={passkeyRequired && !session?.passkeyExempt}
          />
        </section>

        {(canIssue || apiKeys.length > 0) && (
          <section className={styles.section} data-ui="AccountPage.apiKeySection">
            <h2 className={styles.sectionTitle}>{t("account.apiKeys.heading")}</h2>
            <ApiKeySection
              keys={apiKeys.map((k) => ({
                id: k.id,
                name: k.name,
                prefix: k.prefix,
                scope: k.scope,
                createdAt: k.createdAt.toISOString(),
                expiresAt: k.expiresAt?.toISOString() ?? null,
                expired: k.expiresAt !== null && k.expiresAt <= now,
                lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
              }))}
              method={method}
              apiUrl={`${publicUrl}/api/v1`}
              canIssue={canIssue && apiSettings.enabled}
            />
          </section>
        )}

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

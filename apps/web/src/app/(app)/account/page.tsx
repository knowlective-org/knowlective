import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/locales";
import { prisma } from "@/lib/db";
import { ownPasswordResetAvailability } from "@/lib/auth/own-password-reset";
import { signsInThroughIdpOnly } from "@/lib/auth/oidc";
import { PASSWORD_RESET_TTL_MINUTES } from "@/lib/auth/password-reset";
import { canIssueApiKeys, getApiSettings, listApiKeys } from "@/lib/api/keys";
import { listPasskeys, passkeyRequiredSetting } from "@/lib/auth/passkeys";
import { reauthMethod } from "@/lib/auth/reauth";
import { pendingAdminEmailChange } from "@/lib/auth/admin-email-change";
import { getPublicUrl } from "@/lib/site-url";
import { getSessionUser, requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import { LocaleForm } from "./locale-form";
import { SidebarForm } from "./sidebar-form";
import { AvatarSection } from "./avatar-section";
import { avatarLook } from "@/lib/avatar-check";
import { ApiKeySection } from "./api-key-section";
import { McpSection } from "./mcp-section";
import { listGrants, oauthAllowedFor } from "@/lib/oauth/tokens";
import { PasskeySection } from "./passkey-section";
import { ProfileSection } from "./profile-section";
import { MAX_NAME_LENGTH, profileRules } from "@/lib/auth/profile";
import { OwnPasswordResetForm } from "./password-reset-form";
import { NotificationSection } from "./notification-section";
import { parseNotificationPrefs } from "@/lib/notification-prefs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("account.title") };
}

// The signed-in user's own account: who they are, their display language,
// their passkeys and API keys, and resetting their password.
export default async function AccountPage() {
  await connection();
  const user = await requireUser("/account");
  const [sidebar, reset, t, { siteRole, oidcSubject, locale, notificationPrefs, sidebarChildLimit, avatarUpdatedAt, avatarColor, avatarSeed }, passkeys, passkeyRequired, session] = await Promise.all([
    loadSidebar(user),
    ownPasswordResetAvailability(user.id),
    getTranslations(),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { siteRole: true, oidcSubject: true, locale: true, notificationPrefs: true, sidebarChildLimit: true, avatarUpdatedAt: true, avatarColor: true, avatarSeed: true } }),
    listPasskeys(user.id),
    passkeyRequiredSetting(),
    getSessionUser(),
  ]);
  const [apiKeys, canIssue, apiSettings, method, publicUrl, rules, grants, canConnect, adminChange] = await Promise.all([
    listApiKeys(user.id),
    canIssueApiKeys(user.siteRole),
    getApiSettings(),
    reauthMethod(user.id),
    getPublicUrl(),
    profileRules(user.id),
    listGrants(user.id),
    oauthAllowedFor(user.siteRole),
    pendingAdminEmailChange(user.id),
  ]);
  const now = new Date();

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} />}>
      <div className={`${styles.pane} ${styles.paneNarrow}`} data-ui="AccountPage">
        <h1 className={styles.title}>{t("account.title")}</h1>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t("account.details")}</h2>
          <AvatarSection userId={user.id} name={user.name} look={avatarLook({ id: user.id, avatarUpdatedAt, avatarColor, avatarSeed })} />
          <ProfileSection
            name={user.name}
            email={user.email}
            rules={rules}
            method={method}
            maxNameLength={MAX_NAME_LENGTH}
            adminChange={
              adminChange && {
                newEmail: adminChange.newEmail,
                expiresAt: adminChange.expiresAt.toISOString(),
                canResend: adminChange.canResend,
              }
            }
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

        <section className={styles.section} data-ui="AccountPage.sidebarSection">
          <h2 className={styles.sectionTitle}>{t("account.sidebar.heading")}</h2>
          <SidebarForm limit={sidebarChildLimit} />
        </section>

        <section className={styles.section} data-ui="AccountPage.notificationSection">
          <h2 className={styles.sectionTitle}>{t("notifications.settings.heading")}</h2>
          <NotificationSection prefs={parseNotificationPrefs(notificationPrefs)} />
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
            idpOnly={signsInThroughIdpOnly({ siteRole, oidcSubject })}
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

        {(canConnect || grants.length > 0) && (
          <section className={styles.section} data-ui="AccountPage.mcpSection">
            <h2 className={styles.sectionTitle}>{t("account.mcp.heading")}</h2>
            <McpSection
              url={`${publicUrl}/api/mcp`}
              available={canConnect}
              apps={grants.map((g) => ({
                id: g.id,
                name: g.clientName,
                scope: g.scope,
                createdAt: g.createdAt.toISOString(),
                lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
              }))}
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

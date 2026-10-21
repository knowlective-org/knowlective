import { getFormatter, getTranslations } from "next-intl/server";
import type { SiteRole } from "shared";
import { prisma } from "@/lib/db";
import { withEmails } from "@/lib/emails";
import { requireAdmin } from "@/lib/admin/auth";
import { INVITATION_TTL_DAYS, listPendingInvitations } from "@/lib/auth/invitations";
import { isMailConfigured } from "@/lib/mail";
import { getSignupSettings } from "@/lib/auth/signup";
import { getOidcSettings, oidcCallbackUrl } from "@/lib/auth/oidc";
import { SITE_ROLES, invitableRoles } from "@/lib/roles";
import { manageableGroupIds } from "@/lib/group-access";
import styles from "@/styles/ui.module.css";
import { revokeInvitation } from "../actions";
import { InvitationForm } from "../invitation-form";
import { RowMenu, type RowMenuItem } from "../row-menu";
import { SignupSettingsForm } from "../signup-settings-form";
import { OidcSettingsForm } from "../oidc-settings-form";
import { PasskeySettingsForm } from "../passkey-settings-form";
import { changeSiteRole, disableUser, enableUser, openPasswordReset, resetPasskeys } from "./actions";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  siteRole: SiteRole;
  disabledAt: Date | null;
  _count: { passkeys: number };
};

// The menu's text, in the viewer's language.
type UserMenuText = {
  role: (role: SiteRole) => string;
  makeRole: (role: SiteRole) => string;
  roleConfirm: (who: string, role: SiteRole) => string;
  issueReset: string;
  enable: string;
  disable: string;
  disableConfirm: (who: string) => string;
  resetPasskeys: string;
  resetPasskeysConfirm: (who: string, count: number) => string;
};

// Site admins only: change role, password reset link, remove passkeys,
// disable / enable.
function userMenu(u: UserRow, text: UserMenuText): RowMenuItem[] {
  const who = u.name ?? u.email;
  const roleItems: RowMenuItem[] = SITE_ROLES.filter((r) => r !== u.siteRole).map((r) => ({
    label: text.makeRole(r),
    action: changeSiteRole,
    fields: { userId: u.id, siteRole: r },
    confirm: text.roleConfirm(who, r),
  }));
  return [
    ...roleItems,
    ...(u.disabledAt ? [] : [{ label: text.issueReset, action: openPasswordReset, fields: { userId: u.id } }]),
    ...(u._count.passkeys > 0
      ? [
          {
            label: text.resetPasskeys,
            action: resetPasskeys,
            fields: { userId: u.id },
            danger: true,
            confirm: text.resetPasskeysConfirm(who, u._count.passkeys),
          },
        ]
      : []),
    u.disabledAt
      ? { label: text.enable, action: enableUser, fields: { userId: u.id } }
      : {
          label: text.disable,
          action: disableUser,
          fields: { userId: u.id },
          danger: true,
          confirm: text.disableConfirm(who),
        },
  ];
}

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const { session, role, actor } = await requireAdmin();
  const allowedGroups = await manageableGroupIds(actor);
  const isSiteAdmin = role === "SITE_ADMIN";
  const [groups, invitations, users, mailConfigured, signup, oidc, callbackUrl, t, format, passkeys] = await Promise.all([
    // Content managers can only hand out groups within trees they manage.
    prisma.group.findMany({
      // Built-in groups (all users) need no invitation: everyone is in them.
      where: { builtIn: null, ...(allowedGroups === "all" ? {} : { id: { in: [...allowedGroups] } }) },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, description: true },
    }),
    listPendingInvitations(),
    // The user list (roles, disabling) is for site admins only.
    isSiteAdmin
      ? prisma.user
          .findMany({
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              emailEnc: true,
              name: true,
              siteRole: true,
              createdAt: true,
              disabledAt: true,
              groups: { select: { group: { select: { name: true } } } },
              _count: { select: { passkeys: true } },
            },
          })
          .then(withEmails)
      : Promise.resolve([]),
    isMailConfigured(),
    getSignupSettings(),
    getOidcSettings(),
    oidcCallbackUrl(),
    getTranslations(),
    getFormatter(),
    // The setting, and how many enabled accounts have no passkey yet (they'd
    // be asked to register one), for site admins.
    isSiteAdmin
      ? Promise.all([
          prisma.instanceConfig.findUniqueOrThrow({ where: { id: 1 }, select: { passkeyRequired: true } }),
          prisma.user.count({ where: { disabledAt: null, passkeys: { none: {} } } }),
        ]).then(([config, withoutPasskey]) => ({ required: config.passkeyRequired, withoutPasskey }))
      : Promise.resolve(null),
  ]);
  const error = (await searchParams).error;
  const roleLabel = (r: SiteRole) => t(`roles.${r}`);
  const formatDate = (d: Date) => format.dateTime(d, { dateStyle: "short", timeStyle: "medium" });
  const separator = t("common.listSeparator");
  const menuText: UserMenuText = {
    role: roleLabel,
    makeRole: (r) => t("admin.users.makeRole", { role: roleLabel(r) }),
    roleConfirm: (who, r) => t("admin.users.roleConfirm", { who, role: roleLabel(r) }),
    issueReset: t("admin.users.issueReset"),
    enable: t("admin.users.enable"),
    disable: t("admin.users.disable"),
    disableConfirm: (who) => t("admin.users.disableConfirm", { who }),
    resetPasskeys: t("admin.users.resetPasskeys"),
    resetPasskeysConfirm: (who, count) => t("admin.users.resetPasskeysConfirm", { who, count }),
  };
  const signupRoleLabels = { USER: roleLabel("USER"), CONTENT_MANAGER: roleLabel("CONTENT_MANAGER") };

  return (
    <>
      {isSiteAdmin && (
        <section className={styles.section} data-ui="AdminUsersPage.signupSection">
          <h2 className={styles.sectionTitle}>{t("admin.users.signup")}</h2>
          <SignupSettingsForm
            mode={signup.mode}
            allowedDomains={signup.allowedDomains}
            siteRole={signup.siteRole}
            roleLabels={signupRoleLabels}
            mailConfigured={signup.mailConfigured}
          />
        </section>
      )}

      {isSiteAdmin && (
        <section className={styles.section} data-ui="AdminUsersPage.oidcSection">
          <h2 className={styles.sectionTitle}>{t("admin.users.oidc")}</h2>
          <OidcSettingsForm values={oidc} callbackUrl={callbackUrl} roleLabels={signupRoleLabels} />
        </section>
      )}

      {isSiteAdmin && passkeys && (
        <section className={styles.section} data-ui="AdminUsersPage.passkeySection">
          <h2 className={styles.sectionTitle}>{t("admin.users.passkeys")}</h2>
          <PasskeySettingsForm required={passkeys.required} withoutPasskey={passkeys.withoutPasskey} />
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("admin.users.invite")}</h2>
        <InvitationForm
          groups={groups}
          ttlDays={INVITATION_TTL_DAYS}
          mailConfigured={mailConfigured}
          siteRoles={invitableRoles(role).map((r) => ({ value: r, label: roleLabel(r) }))}
        />
        {invitations.length > 0 && (
          <div className={styles.tableWrap} style={{ marginTop: 24 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("admin.users.role")}</th>
                  <th>{t("admin.users.joinGroups")}</th>
                  <th>{t("admin.users.to")}</th>
                  <th>{t("admin.users.expires")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr data-ui="AdminUsersPage.invitationRow" data-id={inv.id} key={inv.id}>
                    <td>{roleLabel(inv.siteRole)}</td>
                    <td>{inv.groups.map((g) => g.group.name).join(separator) || "-"}</td>
                    <td>{inv.email ?? t("admin.users.noAddress")}</td>
                    <td>{formatDate(inv.expiresAt)}</td>
                    <td>
                      <form data-ui="AdminUsersPage.revokeInvitationForm" action={revokeInvitation}>
                        <input type="hidden" name="id" value={inv.id} />
                        <button data-ui="AdminUsersPage.revokeInvitationButton" type="submit" className={styles.danger}>
                          {t("admin.users.revoke")}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isSiteAdmin && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t("admin.users.users")}</h2>
          {error === "last-site-admin" && (
            <p data-ui="AdminUsersPage.lastSiteAdminError" className={styles.error} style={{ marginBottom: 12 }}>
              {t("admin.users.lastSiteAdmin")}
            </p>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("admin.users.name")}</th>
                  <th>{t("admin.users.email")}</th>
                  <th>{t("admin.users.role")}</th>
                  <th>{t("admin.users.groups")}</th>
                  <th>{t("admin.users.registered")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr data-ui="AdminUsersPage.userRow" data-id={u.id} key={u.id} className={u.disabledAt ? styles.disabledRow : undefined}>
                    <td>
                      {u.name ?? "-"}
                      {u.disabledAt && <span className={styles.badge}>{t("admin.common.disabled")}</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>{roleLabel(u.siteRole)}</td>
                    <td>{u.groups.map((g) => g.group.name).join(separator) || "-"}</td>
                    <td>{formatDate(u.createdAt)}</td>
                    <td>
                      {u.id === session.userId ? (
                        <span className={styles.note}>{t("admin.common.you")}</span>
                      ) : (
                        <RowMenu label={t("admin.common.actionsFor", { name: u.name ?? u.email })} items={userMenu(u, menuText)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

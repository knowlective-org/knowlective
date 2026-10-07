import type { SiteRole } from "shared";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { dateFormat } from "@/lib/admin/format";
import { INVITATION_TTL_DAYS, listPendingInvitations } from "@/lib/auth/invitations";
import { isMailConfigured } from "@/lib/mail";
import { getSignupSettings } from "@/lib/auth/signup";
import { getOidcSettings, oidcCallbackUrl } from "@/lib/auth/oidc";
import { SITE_ROLES, SITE_ROLE_LABELS, invitableRoles } from "@/lib/roles";
import { manageableGroupIds } from "@/lib/group-access";
import styles from "@/styles/ui.module.css";
import { revokeInvitation } from "../actions";
import { InvitationForm } from "../invitation-form";
import { RowMenu, type RowMenuItem } from "../row-menu";
import { SignupSettingsForm } from "../signup-settings-form";
import { OidcSettingsForm } from "../oidc-settings-form";
import { changeSiteRole, disableUser, enableUser, openPasswordReset } from "./actions";

type UserRow = { id: string; email: string; name: string | null; siteRole: SiteRole; disabledAt: Date | null };

// Site admins only: change role, password reset link, disable / enable.
function userMenu(u: UserRow): RowMenuItem[] {
  const who = u.name ?? u.email;
  const roleItems: RowMenuItem[] = SITE_ROLES.filter((r) => r !== u.siteRole).map((r) => ({
    label: `${SITE_ROLE_LABELS[r]}にする`,
    action: changeSiteRole,
    fields: { userId: u.id, siteRole: r },
    confirm: `${who} のロールを「${SITE_ROLE_LABELS[r]}」に変更しますか？`,
  }));
  return [
    ...roleItems,
    ...(u.disabledAt
      ? []
      : [{ label: "パスワード再設定リンクを発行", action: openPasswordReset, fields: { userId: u.id } }]),
    u.disabledAt
      ? { label: "有効にする", action: enableUser, fields: { userId: u.id } }
      : {
          label: "無効にする",
          action: disableUser,
          fields: { userId: u.id },
          danger: true,
          confirm: `${who} を無効にしますか？\nログイン中のセッションはすべて終了し、ログインできなくなります。`,
        },
  ];
}

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const { session, role, actor } = await requireAdmin();
  const allowedGroups = await manageableGroupIds(actor);
  const isSiteAdmin = role === "SITE_ADMIN";
  const [groups, invitations, users, mailConfigured, signup, oidc, callbackUrl] = await Promise.all([
    // Content managers can only hand out groups within trees they manage.
    prisma.group.findMany({
      // Built-in groups (全ユーザー) need no invitation: everyone is in them.
      where: { builtIn: null, ...(allowedGroups === "all" ? {} : { id: { in: [...allowedGroups] } }) },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, description: true },
    }),
    listPendingInvitations(),
    // The user list (roles, disabling) is for site admins only.
    isSiteAdmin
      ? prisma.user.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            email: true,
            name: true,
            siteRole: true,
            createdAt: true,
            disabledAt: true,
            groups: { select: { group: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
    isMailConfigured(),
    getSignupSettings(),
    getOidcSettings(),
    oidcCallbackUrl(),
  ]);
  const error = (await searchParams).error;

  return (
    <>
      {isSiteAdmin && (
        <section className={styles.section} data-ui="AdminUsersPage.signupSection">
          <h2 className={styles.sectionTitle}>アカウント登録</h2>
          <SignupSettingsForm
            mode={signup.mode}
            allowedDomains={signup.allowedDomains}
            siteRole={signup.siteRole}
            roleLabels={{ USER: SITE_ROLE_LABELS.USER, CONTENT_MANAGER: SITE_ROLE_LABELS.CONTENT_MANAGER }}
            mailConfigured={signup.mailConfigured}
          />
        </section>
      )}

      {isSiteAdmin && (
        <section className={styles.section} data-ui="AdminUsersPage.oidcSection">
          <h2 className={styles.sectionTitle}>シングルサインオン（OpenID Connect）</h2>
          <OidcSettingsForm
            values={oidc}
            callbackUrl={callbackUrl}
            roleLabels={{ USER: SITE_ROLE_LABELS.USER, CONTENT_MANAGER: SITE_ROLE_LABELS.CONTENT_MANAGER }}
          />
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ユーザーの招待</h2>
        <InvitationForm
          groups={groups}
          ttlDays={INVITATION_TTL_DAYS}
          mailConfigured={mailConfigured}
          siteRoles={invitableRoles(role).map((r) => ({ value: r, label: SITE_ROLE_LABELS[r] }))}
        />
        {invitations.length > 0 && (
          <div className={styles.tableWrap} style={{ marginTop: 24 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ロール</th>
                  <th>参加するグループ</th>
                  <th>宛先</th>
                  <th>期限</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr data-ui="AdminUsersPage.invitationRow" data-id={inv.id} key={inv.id}>
                    <td>{SITE_ROLE_LABELS[inv.siteRole]}</td>
                    <td>{inv.groups.map((g) => g.group.name).join("、") || "-"}</td>
                    <td>{inv.email ?? "指定なし"}</td>
                    <td>{dateFormat.format(inv.expiresAt)}</td>
                    <td>
                      <form data-ui="AdminUsersPage.revokeInvitationForm" action={revokeInvitation}>
                        <input type="hidden" name="id" value={inv.id} />
                        <button data-ui="AdminUsersPage.revokeInvitationButton" type="submit" className={styles.danger}>
                          取り消す
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
          <h2 className={styles.sectionTitle}>ユーザー</h2>
          {error === "last-site-admin" && (
            <p data-ui="AdminUsersPage.lastSiteAdminError" className={styles.error} style={{ marginBottom: 12 }}>
              最後のサイト管理者は、降格・無効化できません。先に別のユーザーをサイト管理者にしてください。
            </p>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>表示名</th>
                  <th>メールアドレス</th>
                  <th>ロール</th>
                  <th>グループ</th>
                  <th>登録日</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr data-ui="AdminUsersPage.userRow" data-id={u.id} key={u.id} className={u.disabledAt ? styles.disabledRow : undefined}>
                    <td>
                      {u.name ?? "-"}
                      {u.disabledAt && <span className={styles.badge}>無効</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>{SITE_ROLE_LABELS[u.siteRole]}</td>
                    <td>{u.groups.map((g) => g.group.name).join("、") || "-"}</td>
                    <td>{dateFormat.format(u.createdAt)}</td>
                    <td>
                      {u.id === session.userId ? (
                        <span className={styles.note}>自分</span>
                      ) : (
                        <RowMenu label={`${u.name ?? u.email} の操作`} items={userMenu(u)} />
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

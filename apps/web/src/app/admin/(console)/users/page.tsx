import type { SiteRole } from "shared";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { ROLE_LABELS, dateFormat } from "@/lib/admin/format";
import { INVITATION_TTL_DAYS, listPendingInvitations } from "@/lib/auth/invitations";
import { isMailConfigured } from "@/lib/mail";
import { listKnowledgeRoots, rootName, rootNameSelect } from "@/lib/knowledge-roots";
import { SITE_ROLES, SITE_ROLE_LABELS, invitableRoles } from "@/lib/roles";
import styles from "@/styles/ui.module.css";
import { revokeInvitation } from "../actions";
import { InvitationForm } from "../invitation-form";
import { RowMenu, type RowMenuItem } from "../row-menu";
import { changeSiteRole, disableUser, enableUser } from "./actions";

type UserRow = { id: string; email: string; name: string | null; siteRole: SiteRole; disabledAt: Date | null };

// Site admins only: change role, disable / enable.
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
  const { session, role } = await requireAdmin();
  const isSiteAdmin = role === "SITE_ADMIN";
  const [roots, invitations, users, mailConfigured] = await Promise.all([
    listKnowledgeRoots(),
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
            memberships: { select: { role: true, root: { select: rootNameSelect } } },
            groups: { select: { group: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
    isMailConfigured(),
  ]);
  const error = (await searchParams).error;

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ユーザーの招待</h2>
        <InvitationForm
          roots={roots}
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
                  <th>招待先</th>
                  <th>権限</th>
                  <th>宛先</th>
                  <th>期限</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id}>
                    <td>{SITE_ROLE_LABELS[inv.siteRole]}</td>
                    <td>{inv.root ? rootName(inv.root) : `（新規）${inv.newRootName}`}</td>
                    <td>{ROLE_LABELS[inv.role]}</td>
                    <td>{inv.email ?? "指定なし"}</td>
                    <td>{dateFormat.format(inv.expiresAt)}</td>
                    <td>
                      <form action={revokeInvitation}>
                        <input type="hidden" name="id" value={inv.id} />
                        <button type="submit" className={styles.danger}>
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
            <p className={styles.error} style={{ marginBottom: 12 }}>
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
                  <th>ナレッジルート</th>
                  <th>グループ</th>
                  <th>登録日</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.disabledAt ? styles.disabledRow : undefined}>
                    <td>
                      {u.name ?? "-"}
                      {u.disabledAt && <span className={styles.badge}>無効</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>{SITE_ROLE_LABELS[u.siteRole]}</td>
                    <td>
                      {u.memberships
                        .map((m) => `${rootName(m.root)}（${ROLE_LABELS[m.role]}）`)
                        .join("、") || "-"}
                    </td>
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

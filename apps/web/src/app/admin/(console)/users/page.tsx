import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { ROLE_LABELS, dateFormat } from "@/lib/admin/format";
import { INVITATION_TTL_DAYS, listPendingInvitations } from "@/lib/auth/invitations";
import styles from "@/styles/ui.module.css";
import { revokeInvitation } from "../actions";
import { InvitationForm } from "../invitation-form";
import { RowMenu } from "../row-menu";
import { disableUser, enableUser } from "./actions";

export default async function AdminUsersPage() {
  const { session } = await requireAdmin();
  const [workspaces, invitations, users] = await Promise.all([
    prisma.workspace.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    listPendingInvitations(),
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        disabledAt: true,
        memberships: { select: { role: true, workspace: { select: { name: true } } } },
        groups: { select: { group: { select: { name: true } } } },
      },
    }),
  ]);

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ユーザーの招待</h2>
        <InvitationForm workspaces={workspaces} ttlDays={INVITATION_TTL_DAYS} />
        {invitations.length > 0 && (
          <div className={styles.tableWrap} style={{ marginTop: 24 }}>
            <table className={styles.table}>
              <thead>
                <tr>
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
                    <td>{inv.workspace?.name ?? `（新規）${inv.newWorkspaceName}`}</td>
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

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ユーザー</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>表示名</th>
                <th>メールアドレス</th>
                <th>ワークスペース</th>
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
                  <td>
                    {u.memberships
                      .map((m) => `${m.workspace.name}（${ROLE_LABELS[m.role]}）`)
                      .join("、") || "-"}
                  </td>
                  <td>{u.groups.map((g) => g.group.name).join("、") || "-"}</td>
                  <td>{dateFormat.format(u.createdAt)}</td>
                  <td>
                    {u.id === session.userId ? (
                      <span className={styles.note}>自分</span>
                    ) : (
                      <RowMenu
                        label={`${u.name ?? u.email} の操作`}
                        items={[
                          u.disabledAt
                            ? { label: "有効にする", action: enableUser, fields: { userId: u.id } }
                            : {
                                label: "無効にする",
                                action: disableUser,
                                fields: { userId: u.id },
                                danger: true,
                                confirm: `${u.name ?? u.email} を無効にしますか？\nログイン中のセッションはすべて終了し、ログインできなくなります。`,
                              },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

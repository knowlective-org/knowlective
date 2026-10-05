import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { dateFormat } from "@/lib/admin/format";
import { SITE_ADMINS } from "@/lib/groups";
import styles from "@/styles/ui.module.css";
import { deleteGroup, removeGroupMember } from "../actions";
import { AddMemberForm, EditGroupForm } from "../group-forms";

export default async function AdminGroupPage({ params }: PageProps<"/admin/groups/[groupId]">) {
  const { session } = await requireAdmin();
  const { groupId } = await params;
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, email: true, name: true, totpSecret: true } } },
      },
    },
  });
  if (!group) notFound();
  const isSiteAdmins = group.systemKey === SITE_ADMINS;

  return (
    <>
      <p className={styles.note} style={{ marginBottom: 16 }}>
        <Link href="/admin/groups" style={{ textDecoration: "underline" }}>
          ← グループ一覧
        </Link>
      </p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {group.name}
          {group.systemKey && "（組み込み）"}
        </h2>
        {isSiteAdmins && (
          <p className={styles.lead}>
            このグループのメンバーは、自分のアカウント（パスワード＋認証アプリ）で管理画面にログインできます。
            初回ログイン時に認証アプリを登録します。外すと、ログイン中のセッションもすぐに終了します。
          </p>
        )}
        <EditGroupForm id={group.id} name={group.name} description={group.description} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>メンバー（{group.members.length}人）</h2>
        {group.members.length > 0 && (
          <div className={styles.tableWrap} style={{ marginBottom: 24 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>表示名</th>
                  <th>メールアドレス</th>
                  {isSiteAdmins && <th>認証アプリ</th>}
                  <th>追加日</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {group.members.map(({ user, createdAt }) => (
                  <tr key={user.id}>
                    <td>{user.name ?? "-"}</td>
                    <td>{user.email}</td>
                    {isSiteAdmins && <td>{user.totpSecret ? "登録済み" : "未登録（初回ログイン時に登録）"}</td>}
                    <td>{dateFormat.format(createdAt)}</td>
                    <td>
                      {isSiteAdmins && user.id === session.userId ? (
                        <span className={styles.note}>自分自身は外せません</span>
                      ) : (
                        <form action={removeGroupMember}>
                          <input type="hidden" name="groupId" value={group.id} />
                          <input type="hidden" name="userId" value={user.id} />
                          <button type="submit" className={styles.danger}>
                            外す
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AddMemberForm groupId={group.id} />
      </section>

      {!group.systemKey && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>グループの削除</h2>
          <p className={styles.note} style={{ marginBottom: 12 }}>
            グループを削除しても、メンバーのアカウントは削除されません。
          </p>
          <form action={deleteGroup}>
            <input type="hidden" name="id" value={group.id} />
            <button type="submit" className={styles.danger}>
              このグループを削除
            </button>
          </form>
        </section>
      )}
    </>
  );
}

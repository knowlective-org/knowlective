import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { dateFormat } from "@/lib/admin/format";
import styles from "@/styles/ui.module.css";
import { deleteGroup, removeGroupMember } from "../actions";
import { AddMemberForm, EditGroupForm } from "../group-forms";
import { RowMenu, type RowMenuItem } from "../../row-menu";
import { disableUser, enableUser } from "../../users/actions";

export default async function AdminGroupPage({ params }: PageProps<"/admin/groups/[groupId]">) {
  const { session, role } = await requireAdmin();
  const { groupId } = await params;
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, email: true, name: true, disabledAt: true } } },
      },
    },
  });
  if (!group) notFound();

  return (
    <>
      <p className={styles.note} style={{ marginBottom: 16 }}>
        <Link href="/admin/groups" style={{ textDecoration: "underline" }}>
          ← グループ一覧
        </Link>
      </p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{group.name}</h2>
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
                  <th>追加日</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {group.members.map(({ user, createdAt }) => (
                  <tr key={user.id} className={user.disabledAt ? styles.disabledRow : undefined}>
                    <td>
                      {user.name ?? "-"}
                      {user.disabledAt && <span className={styles.badge}>無効</span>}
                    </td>
                    <td>{user.email}</td>
                    <td>{dateFormat.format(createdAt)}</td>
                    <td>
                      <RowMenu
                        label={`${user.name ?? user.email} の操作`}
                        items={memberMenu(group.id, group.name, user, {
                          // Disabling accounts is a site admin task, and never yourself.
                          canDisable: role === "SITE_ADMIN" && user.id !== session.userId,
                        })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AddMemberForm groupId={group.id} />
      </section>

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
    </>
  );
}

function memberMenu(
  groupId: string,
  groupName: string,
  user: { id: string; email: string; name: string | null; disabledAt: Date | null },
  { canDisable }: { canDisable: boolean },
): RowMenuItem[] {
  const who = user.name ?? user.email;
  const items: RowMenuItem[] = [
    {
      label: "グループから外す",
      action: removeGroupMember,
      fields: { groupId, userId: user.id },
      confirm: `${who} を「${groupName}」から外しますか？`,
    },
  ];
  if (canDisable) {
    items.push(
      user.disabledAt
        ? { label: "ユーザーを有効にする", action: enableUser, fields: { userId: user.id } }
        : {
            label: "ユーザーを無効にする",
            action: disableUser,
            fields: { userId: user.id },
            danger: true,
            confirm: `${who} を無効にしますか？\nログイン中のセッションはすべて終了し、ログインできなくなります。`,
          },
    );
  }
  return items;
}

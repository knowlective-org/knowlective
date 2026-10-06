import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { getVisibleTrees } from "shared";
import { ACCESS_LABELS, dateFormat } from "@/lib/admin/format";
import { canManageGroup } from "@/lib/group-access";
import { displayTitle } from "@/lib/page-title";
import styles from "@/styles/ui.module.css";
import { deleteGroup, removeGroupMember } from "../actions";
import { AddMemberForm, EditGroupForm } from "../group-forms";
import { RowMenu, type RowMenuItem } from "../../row-menu";
import { disableUser, enableUser } from "../../users/actions";

export default async function AdminGroupPage({ params }: PageProps<"/admin/groups/[groupId]">) {
  const { session, role, actor } = await requireAdmin();
  const { groupId } = await params;
  if (!(await canManageGroup(actor, groupId))) notFound();
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, email: true, name: true, disabledAt: true } } },
      },
      grants: { include: { page: { select: { id: true, title: true, deletedAt: true } } } },
    },
  });
  if (!group) notFound();
  // Page titles are only shown for pages the viewer itself can see: a site
  // admin manages groups without being able to read their pages.
  const visible = new Set(
    session.userId ? (await getVisibleTrees(prisma, session.userId)).flatMap((t) => t.pages.map((p) => p.id)) : [],
  );

  return (
    <>
      <p className={styles.note} style={{ marginBottom: 16 }}>
        <Link data-ui="AdminGroupPage.backLink" href="/admin/groups" style={{ textDecoration: "underline" }}>
          ← グループ一覧
        </Link>
      </p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{group.name}</h2>
        <EditGroupForm id={group.id} name={group.name} description={group.description} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>このグループの権限（{group.grants.length}件）</h2>
        {group.grants.length === 0 ? (
          <p className={styles.note}>
            まだ権限が付いていません。ページの「⋯」メニューの「権限設定」から、このグループに権限を付けられます。
          </p>
        ) : (
          <ul className={styles.note} style={{ paddingLeft: 20, lineHeight: 1.9 }}>
            {group.grants.map((g) => (
              <li data-ui="AdminGroupPage.grantRow" data-id={g.id} key={g.id}>
                {visible.has(g.page.id) ? (
                  <Link data-ui="AdminGroupPage.pageLink" href={`/pages/${g.page.id}`} style={{ textDecoration: "underline" }}>
                    {displayTitle(g.page.title)}
                  </Link>
                ) : (
                  "（権限のないページ）"
                )}
                ：{ACCESS_LABELS[g.access]}（配下のページにも引き継ぎ）
              </li>
            ))}
          </ul>
        )}
      </section>

      {group.builtIn ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>メンバー</h2>
          <p className={styles.note}>
            登録されている有効なユーザー全員が、自動でこのグループに含まれます（あとから登録した人も含む）。メンバーの追加・削除と、グループの削除はできません。
          </p>
        </section>
      ) : (
        <>
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
                  <tr data-ui="AdminGroupPage.memberRow" data-id={user.id} key={user.id} className={user.disabledAt ? styles.disabledRow : undefined}>
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
        <form data-ui="AdminGroupPage.deleteGroupForm" action={deleteGroup}>
          <input type="hidden" name="id" value={group.id} />
          <button data-ui="AdminGroupPage.deleteGroupButton" type="submit" className={styles.danger}>
            このグループを削除
          </button>
        </form>
      </section>
        </>
      )}
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

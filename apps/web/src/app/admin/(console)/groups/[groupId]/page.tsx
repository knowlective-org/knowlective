import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { getDisplayTitle } from "@/i18n/display-title";
import { groupName } from "@/i18n/group-name";
import { prisma } from "@/lib/db";
import { withEmail } from "@/lib/emails";
import { requireAdmin } from "@/lib/admin/auth";
// The admin console isn't covered by the network caps (lib/page-access.ts).
import { getVisibleTrees } from "shared";
import { canManageGroup } from "@/lib/group-access";
import styles from "@/styles/ui.module.css";
import { deleteGroup, removeGroupMember } from "../actions";
import { AddMemberForm } from "../add-member-form";
import { EditGroupForm } from "../group-forms";
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
        include: { user: { select: { id: true, emailEnc: true, name: true, disabledAt: true } } },
      },
      grants: { include: { page: { select: { id: true, title: true, deletedAt: true } } } },
    },
  });
  if (!group) notFound();
  const members = await Promise.all(group.members.map(async (m) => ({ ...m, user: await withEmail(m.user) })));
  // Page titles are only shown for pages the viewer itself can see: a site
  // admin manages groups without being able to read their pages.
  const visible = new Set(
    session.userId ? (await getVisibleTrees(prisma, session.userId)).flatMap((t) => t.pages.map((p) => p.id)) : [],
  );
  const [t, format, displayTitle] = await Promise.all([getTranslations(), getFormatter(), getDisplayTitle()]);
  const name = groupName(t, group);
  const menuText: MemberMenuText = {
    remove: t("admin.groups.removeMember"),
    removeConfirm: (who) => t("admin.groups.removeConfirm", { who, group: name }),
    enable: t("admin.groups.enableUser"),
    disable: t("admin.groups.disableUser"),
    disableConfirm: (who) => t("admin.users.disableConfirm", { who }),
  };

  return (
    <>
      <p className={styles.note} style={{ marginBottom: 16 }}>
        <Link data-ui="AdminGroupPage.backLink" href="/admin/groups" style={{ textDecoration: "underline" }}>
          {t("admin.groups.back")}
        </Link>
      </p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{name}</h2>
        <EditGroupForm id={group.id} name={group.name} description={group.description} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("admin.groups.grantsHeading", { count: group.grants.length })}</h2>
        {group.grants.length === 0 ? (
          <p className={styles.note}>
            {t("admin.groups.noGrants")}
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
                  t("admin.common.noAccessPage")
                )}
                {t("admin.groups.grantRow", { access: t(`access.${g.access}`) })}
              </li>
            ))}
          </ul>
        )}
      </section>

      {group.builtIn ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t("admin.groups.membersHeading")}</h2>
          <p className={styles.note}>
            {t("admin.groups.allUsersNote")}
          </p>
        </section>
      ) : (
        <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("admin.groups.membersCount", { count: members.length })}</h2>
        {members.length > 0 && (
          <div className={styles.tableWrap} style={{ marginBottom: 24 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("admin.users.name")}</th>
                  <th>{t("admin.users.email")}</th>
                  <th>{t("admin.groups.added_at")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map(({ user, createdAt }) => (
                  <tr data-ui="AdminGroupPage.memberRow" data-id={user.id} key={user.id} className={user.disabledAt ? styles.disabledRow : undefined}>
                    <td>
                      {user.name ?? "-"}
                      {user.disabledAt && <span className={styles.badge}>{t("admin.common.disabled")}</span>}
                    </td>
                    <td>{user.email}</td>
                    <td>{format.dateTime(createdAt, { dateStyle: "short", timeStyle: "medium" })}</td>
                    <td>
                      <RowMenu
                        label={t("admin.common.actionsFor", { name: user.name ?? user.email })}
                        items={memberMenu(menuText, group.id, user, {
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
        <h2 className={styles.sectionTitle}>{t("admin.groups.delete")}</h2>
        <p className={styles.note} style={{ marginBottom: 12 }}>
          {t("admin.groups.deleteNote")}
        </p>
        <form data-ui="AdminGroupPage.deleteGroupForm" action={deleteGroup}>
          <input type="hidden" name="id" value={group.id} />
          <button data-ui="AdminGroupPage.deleteGroupButton" type="submit" className={styles.danger}>
            {t("admin.groups.deleteButton")}
          </button>
        </form>
      </section>
        </>
      )}
    </>
  );
}

type MemberMenuText = {
  remove: string;
  removeConfirm: (who: string) => string;
  enable: string;
  disable: string;
  disableConfirm: (who: string) => string;
};

function memberMenu(
  text: MemberMenuText,
  groupId: string,
  user: { id: string; email: string; name: string | null; disabledAt: Date | null },
  { canDisable }: { canDisable: boolean },
): RowMenuItem[] {
  const who = user.name ?? user.email;
  const items: RowMenuItem[] = [
    {
      label: text.remove,
      action: removeGroupMember,
      fields: { groupId, userId: user.id },
      confirm: text.removeConfirm(who),
    },
  ];
  if (canDisable) {
    items.push(
      user.disabledAt
        ? { label: text.enable, action: enableUser, fields: { userId: user.id } }
        : {
            label: text.disable,
            action: disableUser,
            fields: { userId: user.id },
            danger: true,
            confirm: text.disableConfirm(who),
          },
    );
  }
  return items;
}

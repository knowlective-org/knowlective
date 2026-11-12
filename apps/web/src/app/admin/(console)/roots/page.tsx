import { getFormatter, getTranslations } from "next-intl/server";
import { getDisplayTitle } from "@/i18n/display-title";
import { groupName } from "@/i18n/group-name";
import { requireAdminView } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import styles from "@/styles/ui.module.css";
import { AdminReadOnly } from "../admin-read-only";
import { DeleteRootButton, RestoreRootButton } from "./root-buttons";

// Every knowledge root but the personal ones, for site admins: its name (the
// root page's title), how many pages it has, the groups with access to it,
// and deleting or restoring it. Nothing inside is shown: a site admin may
// know a root is there without being able to open it.
export default async function AdminRootsPage() {
  const { readOnly } = await requireAdminView(["SITE_ADMIN"]);
  const [roots, t, format, displayTitle] = await Promise.all([
    prisma.knowledgeRoot.findMany({
      where: { ownerId: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        deletedAt: true,
        rootPage: {
          select: {
            title: true,
            grants: { where: { access: { not: "NONE" } }, select: { access: true, group: { select: { name: true, builtIn: true } } } },
          },
        },
        _count: { select: { pages: { where: { deletedAt: null } } } },
      },
    }),
    getTranslations(),
    getFormatter(),
    getDisplayTitle(),
  ]);
  const live = roots.filter((r) => !r.deletedAt);
  const deleted = roots.filter((r) => r.deletedAt);

  const table = (rows: typeof roots, kind: "live" | "deleted") => (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t("admin.roots.name")}</th>
            <th>{t("admin.roots.pages")}</th>
            <th>{t("admin.roots.groups")}</th>
            <th>{kind === "live" ? t("admin.roots.created") : t("admin.roots.deleted")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const name = displayTitle(r.rootPage?.title ?? "");
            return (
              <tr data-ui="AdminRootsPage.rootRow" data-id={r.id} key={r.id}>
                <td>{name}</td>
                <td>{r._count.pages}</td>
                <td>
                  {r.rootPage?.grants.length
                    ? format.list(
                        r.rootPage.grants.map((g) => t("admin.roots.groupAccess", { group: groupName(t, g.group), access: t(`access.${g.access}`) })),
                      )
                    : "-"}
                </td>
                <td>{format.dateTime(kind === "live" ? r.createdAt : r.deletedAt!, { dateStyle: "medium", timeStyle: "short" })}</td>
                <td>
                  {kind === "live" ? (
                    <DeleteRootButton rootId={r.id} name={name} pages={r._count.pages} />
                  ) : (
                    <RestoreRootButton rootId={r.id} name={name} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <AdminReadOnly readOnly={readOnly}>
      <section className={styles.section} data-ui="AdminRootsPage">
        <h2 className={styles.sectionTitle}>{t("admin.roots.heading")}</h2>
        <p className={styles.note}>{t("admin.roots.lead")}</p>
        {live.length === 0 ? <p className={styles.note}>{t("admin.roots.none")}</p> : table(live, "live")}
      </section>
      {deleted.length > 0 && (
        <section className={styles.section} data-ui="AdminRootsPage.deletedSection">
          <h2 className={styles.sectionTitle}>{t("admin.roots.deletedHeading")}</h2>
          <p className={styles.note}>{t("admin.roots.deletedLead")}</p>
          {table(deleted, "deleted")}
        </section>
      )}
    </AdminReadOnly>
  );
}

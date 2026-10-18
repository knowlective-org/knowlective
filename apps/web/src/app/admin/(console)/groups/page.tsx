import Link from "next/link";
import { PUBLIC_GROUP } from "shared";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { manageableGroupIds } from "@/lib/group-access";
import styles from "@/styles/ui.module.css";
import { CreateGroupForm } from "./group-forms";

export default async function AdminGroupsPage() {
  const { actor } = await requireAdmin();
  const allowed = await manageableGroupIds(actor);
  const groups = await prisma.group.findMany({
    // Content managers only see groups within trees they manage. The public
    // group isn't one to manage here: pages are made public from their
    // permission settings, and the overview page allows it at all.
    where: {
      OR: [{ builtIn: null }, { builtIn: { not: PUBLIC_GROUP } }],
      ...(allowed === "all" ? {} : { id: { in: [...allowed] } }),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, description: true, builtIn: true, _count: { select: { members: true, grants: true } } },
  });

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>グループ</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>グループ名</th>
                <th>説明</th>
                <th>メンバー数</th>
                <th>権限の数</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr data-ui="AdminGroupsPage.groupRow" data-id={g.id} key={g.id}>
                  <td>
                    <Link data-ui="AdminGroupsPage.groupLink" href={`/admin/groups/${g.id}`} style={{ textDecoration: "underline" }}>
                      {g.name}
                    </Link>
                  </td>
                  <td>{g.description ?? "-"}</td>
                  <td>{g.builtIn ? "全員（自動）" : g._count.members}</td>
                  <td>{g._count.grants}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>グループを作成</h2>
        <CreateGroupForm />
      </section>
    </>
  );
}

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import styles from "@/styles/ui.module.css";
import { CreateGroupForm } from "./group-forms";

export default async function AdminGroupsPage() {
  await requireAdmin();
  const groups = await prisma.group.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, description: true, _count: { select: { members: true } } },
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
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link href={`/admin/groups/${g.id}`} style={{ textDecoration: "underline" }}>
                      {g.name}
                    </Link>
                  </td>
                  <td>{g.description ?? "-"}</td>
                  <td>{g._count.members}</td>
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

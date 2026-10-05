import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import styles from "@/styles/ui.module.css";
import { logout } from "./actions";

export default async function Home() {
  const user = await requireUser("/");
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          pages: {
            where: { deletedAt: null },
            orderBy: { createdAt: "asc" },
            select: { id: true, title: true, icon: true },
          },
        },
      },
    },
  });

  return (
    <main className={styles.wide}>
      <header className={styles.header}>
        <h1 className={styles.title} style={{ margin: 0 }}>
          yosuga
        </h1>
        <form action={logout} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className={styles.note}>{user.name ?? user.email}</span>
          <button type="submit" className={styles.button}>
            ログアウト
          </button>
        </form>
      </header>

      {memberships.length === 0 && (
        <p className={styles.lead}>参加しているワークスペースはまだありません。</p>
      )}
      {memberships.map(({ workspace }) => (
        <section key={workspace.id} className={styles.section}>
          <h2 className={styles.sectionTitle}>{workspace.name}</h2>
          {workspace.pages.length === 0 ? (
            <p className={styles.note}>ページはまだありません。</p>
          ) : (
            <ul style={{ paddingLeft: 20, lineHeight: 2 }}>
              {workspace.pages.map((page) => (
                <li key={page.id}>
                  <Link href={`/pages/${page.id}`} style={{ textDecoration: "underline" }}>
                    {page.icon ? `${page.icon} ` : ""}
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}

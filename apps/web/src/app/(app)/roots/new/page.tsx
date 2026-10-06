import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { manageableGroupIds } from "@/lib/group-access";
import styles from "@/styles/ui.module.css";
import { CreateRootForm } from "./create-root-form";

export const metadata: Metadata = { title: "新しいナレッジルート | yosuga" };

export default async function NewRootPage() {
  const user = await requireUser("/roots/new");
  const canCreate = user.siteRole === "SITE_ADMIN" || user.siteRole === "CONTENT_MANAGER";
  const allowed = canCreate ? await manageableGroupIds({ userId: user.id, role: user.siteRole }) : new Set<string>();
  const groups = canCreate
    ? await prisma.group.findMany({
        where: allowed === "all" ? {} : { id: { in: [...allowed] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, members: { where: { userId: user.id }, select: { userId: true } } },
      })
    : [];

  return (
    <main className={styles.narrow} data-ui="NewRootPage">
      <p className={styles.note} style={{ marginBottom: 16 }}>
        <Link href="/" style={{ textDecoration: "underline" }} data-ui="NewRootPage.homeLink">
          ← ホーム
        </Link>
      </p>
      <h1 className={styles.title}>新しいナレッジルート</h1>
      {canCreate ? (
        <>
          <p className={styles.lead}>
            ナレッジルートの権限は、必ずグループに付けます。選んだグループに「管理」の権限が付き、そのメンバーがページの追加や共有の設定を行えます。
          </p>
          <CreateRootForm groups={groups.map((g) => ({ id: g.id, name: g.name, isMember: g.members.length > 0 }))} />
        </>
      ) : (
        <p className={styles.lead} data-ui="NewRootPage.notAllowedMessage">ナレッジルートを作成できるのは、コンテンツ管理者とサイト管理者だけです。</p>
      )}
    </main>
  );
}

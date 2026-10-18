import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { manageableGroupIds } from "@/lib/group-access";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import { CreateRootForm } from "./create-root-form";

export const metadata: Metadata = { title: "新しいナレッジルート | KNOWLECTIVE" };

export default async function NewRootPage() {
  const user = await requireUser("/roots/new");
  const canCreate = user.siteRole === "SITE_ADMIN" || user.siteRole === "CONTENT_MANAGER";
  const allowed = canCreate ? await manageableGroupIds({ userId: user.id, role: user.siteRole }) : new Set<string>();
  const [sidebar, groups] = await Promise.all([
    loadSidebar(user),
    canCreate
      ? prisma.group.findMany({
          // Never offer "all users" for MANAGE on a whole new tree.
          where: { builtIn: null, ...(allowed === "all" ? {} : { id: { in: [...allowed] } }) },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, members: { where: { userId: user.id }, select: { userId: true } } },
        })
      : [],
  ]);

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} />}>
      <div className={styles.paneNarrow} data-ui="NewRootPage">
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
      </div>
    </AppShell>
  );
}

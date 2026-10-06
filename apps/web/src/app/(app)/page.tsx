import { redirect } from "next/navigation";
import { getPageAccess } from "shared";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";

// "/" has no screen of its own: it reopens the page opened last, or else the
// first page the user can see (a root page before shared pages). Only when
// nothing is visible does it render the empty two-pane screen.
export default async function Home() {
  const user = await requireUser("/");
  const { lastPageId } = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { lastPageId: true },
  });
  if (lastPageId && (await getPageAccess(prisma, user.id, lastPageId))) {
    redirect(`/pages/${lastPageId}`);
  }

  const sidebar = await loadSidebar(user);
  const first =
    sidebar.trees.find((t) => t.rootPageId && t.entryIds.includes(t.rootPageId))?.rootPageId ??
    sidebar.trees[0]?.entryIds[0];
  if (first) redirect(`/pages/${first}`);

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} />}>
      <div style={{ padding: "0 54px" }} data-ui="EmptyHome">
        <h1 className={styles.title}>yosuga へようこそ</h1>
        <p className={styles.lead}>
          {sidebar.canCreateRoot
            ? "見られるページはまだありません。左の「＋ 新しいナレッジルート」から作成できます。"
            : "見られるページはまだありません。グループに追加されると、左に表示されます。"}
        </p>
      </div>
    </AppShell>
  );
}

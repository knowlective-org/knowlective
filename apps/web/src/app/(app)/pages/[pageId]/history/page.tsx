import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { atLeast } from "shared";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { findAccessiblePage } from "@/lib/auth/pages";
import { requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { displayTitle } from "@/lib/page-title";
import { VERSION_INTERVAL_MS } from "@/lib/page-versions";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import { HistoryView } from "./history-view";

export const metadata: Metadata = { title: "履歴 | KNOWLECTIVE" };

// Saved versions of a page (newest first) with a read-only preview, and
// "restore this version" for editors.
export default async function PageHistoryRoute({ params }: PageProps<"/pages/[pageId]/history">) {
  await connection();
  const { pageId } = await params;
  const user = await requireUser(`/pages/${encodeURIComponent(pageId)}/history`);
  const page = await findAccessiblePage(user.id, pageId);
  if (!page) notFound();

  const [sidebar, versions] = await Promise.all([
    loadSidebar(user),
    prisma.pageVersion.findMany({
      where: { pageId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, kind: true, title: true, editorIds: true, restoredFromId: true, maskedAt: true },
    }),
  ]);
  const editorIds = [...new Set(versions.flatMap((v) => v.editorIds))];
  const editors = await prisma.user.findMany({ where: { id: { in: editorIds } }, select: { id: true, name: true, emailEnc: true } });
  const names = new Map(await Promise.all(editors.map(async (u) => [u.id, await displayName(u)] as const)));

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={page.id} />}>
      <div className={styles.pane} data-ui="PageHistoryPage">
        <p style={{ marginBottom: 8 }}>
          <Link href={`/pages/${page.id}`} style={{ textDecoration: "underline" }} data-ui="PageHistoryPage.backLink">
            ← ページに戻る
          </Link>
        </p>
        <h1 className={styles.title}>「{displayTitle(page.title)}」の履歴</h1>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          編集中は{VERSION_INTERVAL_MS / 60000}分ごと、全員がページを閉じたときに版が保存されます。
          {atLeast(page.access, "EDIT") ? "「この版に戻す」で、ページの内容をその版に戻せます（戻す直前の内容も版として残ります）。" : ""}
        </p>
        <HistoryView
          pageId={page.id}
          canRestore={atLeast(page.access, "EDIT")}
          versions={versions.map((v) => ({
            id: v.id,
            createdAt: v.createdAt.toISOString(),
            kind: v.kind,
            title: v.title,
            editors: v.editorIds.map((id) => names.get(id) ?? "（削除されたユーザー）"),
            restoredFromId: v.restoredFromId,
            masked: v.maskedAt !== null,
          }))}
        />
      </div>
    </AppShell>
  );
}

import type { Metadata } from "next";
import { connection } from "next/server";
import { getTrash } from "shared";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import { TrashList } from "./trash-list";

export const metadata: Metadata = { title: "ごみ箱 | YOSUGA" };

// Pages the user deleted or could restore (EDIT on them), across all
// knowledge roots.
export default async function TrashPage() {
  await connection();
  const user = await requireUser("/trash");
  const [sidebar, { items, destinations }] = await Promise.all([loadSidebar(user), getTrash(prisma, user.id)]);
  const deleterIds = [...new Set(items.map((i) => i.deletedById).filter((id): id is string => !!id))];
  const deleters = await prisma.user.findMany({ where: { id: { in: deleterIds } }, select: { id: true, name: true, emailEnc: true } });
  const names = new Map(await Promise.all(deleters.map(async (u) => [u.id, await displayName(u)] as const)));

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} />}>
      <div className={styles.pane} data-ui="TrashPage">
        <h1 className={styles.title}>ごみ箱</h1>
        <p className={styles.lead}>
          削除したページは、子ページと一緒にここに移ります。元に戻すと、子ページも含めて元の場所に戻ります。編集の権限があるページだけが表示されます。
          元の親ページもごみ箱にある場合（灰色の行）は、同じナレッジルートの中から戻す場所を選べます。
        </p>
        <TrashList
          items={items.map((i) => ({
            id: i.id,
            title: i.title,
            icon: i.icon,
            deletedAt: i.deletedAt.toISOString(),
            deletedBy: i.deletedById ? (names.get(i.deletedById) ?? "") : "",
            parent: i.parent,
            parentInTrash: i.parentInTrash,
            suggestedParentId: i.suggestedParentId,
            rootId: i.rootId,
          }))}
          destinations={destinations}
        />
      </div>
    </AppShell>
  );
}

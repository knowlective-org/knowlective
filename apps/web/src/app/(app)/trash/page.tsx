import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { getTrash } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import { TrashList } from "./trash-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("trash.title") }) };
}

// Pages the user deleted or could restore (EDIT on them), across all
// knowledge roots.
export default async function TrashPage() {
  await connection();
  const user = await requireUser("/trash");
  const [sidebar, { items, destinations }, t] = await Promise.all([
    loadSidebar(user),
    getTrash(prisma, user.id),
    getTranslations("trash"),
  ]);
  const deleterIds = [...new Set(items.map((i) => i.deletedById).filter((id): id is string => !!id))];
  const deleters = await prisma.user.findMany({ where: { id: { in: deleterIds } }, select: { id: true, name: true, emailEnc: true } });
  const names = new Map(await Promise.all(deleters.map(async (u) => [u.id, await displayName(u)] as const)));

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={null} />}>
      <div className={styles.pane} data-ui="TrashPage">
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.lead}>
          {t("lead")} {t("lead2")}
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

import { loadDataKey } from "shared";
import { openSnapshot } from "@/lib/presentation-history";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDisplayTitle } from "@/i18n/display-title";
import { atLeast } from "shared";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { findAccessiblePage } from "@/lib/auth/pages";
import { requireUser } from "@/lib/auth/session";
import { loadSidebar } from "@/lib/sidebar-data";
import { VERSION_INTERVAL_MS } from "@/lib/page-versions";
import { AppShell } from "@/components/app-shell";
import { Sidebar } from "@/components/sidebar";
import styles from "@/styles/ui.module.css";
import { noteAuditorView } from "@/lib/personal-root-audit";
import { PresentationHistory } from "./presentation-history";
import { HistoryView } from "./history-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("history.title") };
}

// Saved versions of a page (newest first) with a read-only preview, and
// "restore this version" for editors.
export default async function PageHistoryRoute({ params }: PageProps<"/pages/[pageId]/history">) {
  await connection();
  const { pageId } = await params;
  const user = await requireUser(`/pages/${encodeURIComponent(pageId)}/history`);
  const page = await findAccessiblePage(user.id, pageId);
  if (!page) notFound();
  // Someone else's personal root (an auditor): recorded.
  if (page.personal) await noteAuditorView(user, page, "history");

  const [sidebar, versions, t, displayTitle] = await Promise.all([
    loadSidebar(user),
    prisma.pageVersion.findMany({
      where: { pageId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, kind: true, title: true, editorIds: true, restoredFromId: true, maskedAt: true },
    }),
    getTranslations("history"),
    getDisplayTitle(),
  ]);
  // A presentation's own history: what it was made of at each time.
  const snapshots =
    page.kind === "PRESENTATION"
      ? await prisma.presentationSnapshot.findMany({
          where: { pageId },
          orderBy: { createdAt: "desc" },
          select: { id: true, createdAt: true, kind: true, createdById: true, sealed: true },
        })
      : [];
  const dataKey = snapshots.length > 0 ? await loadDataKey(prisma) : null;
  const snapshotAuthors = await prisma.user.findMany({
    where: { id: { in: [...new Set(snapshots.flatMap((s) => (s.createdById ? [s.createdById] : [])))] } },
    select: { id: true, name: true, emailEnc: true },
  });
  const authorNames = new Map(await Promise.all(snapshotAuthors.map(async (u) => [u.id, await displayName(u)] as const)));
  const editorIds = [...new Set(versions.flatMap((v) => v.editorIds))];
  const editors = await prisma.user.findMany({ where: { id: { in: editorIds } }, select: { id: true, name: true, emailEnc: true } });
  const names = new Map(await Promise.all(editors.map(async (u) => [u.id, await displayName(u)] as const)));

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={page.id} />}>
      <div className={styles.pane} data-ui="PageHistoryPage">
        <p style={{ marginBottom: 8 }}>
          <Link href={`/pages/${page.id}`} style={{ textDecoration: "underline" }} data-ui="PageHistoryPage.backLink">
            {t("back")}
          </Link>
        </p>
        <h1 className={styles.title}>{t("heading", { title: displayTitle(page.title) })}</h1>
        <p className={styles.note} style={{ marginBottom: 16 }}>
          {t("saving", { minutes: VERSION_INTERVAL_MS / 60000 })}
          {atLeast(page.access, "EDIT") ? t("restoreHint") : ""}
        </p>
        {page.kind === "PRESENTATION" && (
          <PresentationHistory
            pageId={page.id}
            canRestore={atLeast(page.access, "EDIT") && !page.lock}
            snapshots={snapshots.map((s) => ({
              id: s.id,
              createdAt: s.createdAt.toISOString(),
              kind: s.kind === "BEFORE_RESTORE" || s.kind === "RESTORED" ? s.kind : "AUTO",
              // Only how many: the notes in it aren't for everyone who can view.
              slides: openSnapshot(dataKey!, page.id, s.id, s.sealed).slides.length,
              by: s.createdById ? (authorNames.get(s.createdById) ?? t("deletedUser")) : null,
            }))}
          />
        )}
        <HistoryView
          pageId={page.id}
          whiteboard={page.kind === "WHITEBOARD" || page.kind === "SLIDE"}
          maskWithoutVersions={page.kind === "SLIDE"}
          canRestore={atLeast(page.access, "EDIT")}
          versions={versions.map((v) => ({
            id: v.id,
            createdAt: v.createdAt.toISOString(),
            kind: v.kind,
            title: v.title,
            editors: v.editorIds.map((id) => names.get(id) ?? t("deletedUser")),
            restoredFromId: v.restoredFromId,
            masked: v.maskedAt !== null,
          }))}
        />
      </div>
    </AppShell>
  );
}

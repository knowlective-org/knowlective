import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { findAccessiblePage } from "@/lib/auth/pages";
import { requireUser } from "@/lib/auth/session";
import { atLeast } from "shared";
import { loadSidebar } from "@/lib/sidebar-data";
import { displayTitle } from "@/lib/page-title";
import { PageView } from "./page-view";

// Shared by generateMetadata and the page within one request.
const loadPage = cache(async (pageId: string) => {
  const user = await requireUser(`/pages/${encodeURIComponent(pageId)}`);
  const page = await findAccessiblePage(user.id, pageId);
  return { user, page };
});

export async function generateMetadata({ params }: PageProps<"/pages/[pageId]">): Promise<Metadata> {
  const { page } = await loadPage((await params).pageId);
  return { title: page ? `${displayTitle(page.title)} | yosuga` : "yosuga" };
}

export default async function PageEditorRoute({ params }: PageProps<"/pages/[pageId]">) {
  const { user, page } = await loadPage((await params).pageId);
  if (!page) notFound();

  const [sidebar] = await Promise.all([
    loadSidebar(user),
    // "/" reopens the page opened last.
    prisma.user.updateMany({
      where: { id: user.id, OR: [{ lastPageId: null }, { lastPageId: { not: page.id } }] },
      data: { lastPageId: page.id },
    }),
  ]);

  return (
    <PageView
      // Remount per page so the editor's collab connection is replaced cleanly.
      key={page.id}
      pageId={page.id}
      readOnly={!atLeast(page.access, "EDIT")}
      canManage={atLeast(page.access, "MANAGE")}
      user={{ id: user.id, name: user.name ?? user.email }}
      sidebar={sidebar}
    />
  );
}

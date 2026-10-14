import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { findAccessiblePage } from "@/lib/auth/pages";
import { requireUser } from "@/lib/auth/session";
import { atLeast } from "shared";
import { loadSidebar } from "@/lib/sidebar-data";
import { getPublicUrl } from "@/lib/site-url";
import { displayTitle } from "@/lib/page-title";
import { type PageLockView, PageView } from "./page-view";

// Shared by generateMetadata and the page within one request.
const loadPage = cache(async (pageId: string) => {
  const user = await requireUser(`/pages/${encodeURIComponent(pageId)}`);
  const page = await findAccessiblePage(user.id, pageId);
  return { user, page };
});

export async function generateMetadata({ params }: PageProps<"/pages/[pageId]">): Promise<Metadata> {
  const { page } = await loadPage((await params).pageId);
  return { title: page ? `${displayTitle(page.title)} | YOSUGA` : "YOSUGA" };
}

export default async function PageEditorRoute({ params }: PageProps<"/pages/[pageId]">) {
  const { user, page } = await loadPage((await params).pageId);
  if (!page) notFound();

  const [sidebar, publicUrl] = await Promise.all([
    loadSidebar(user),
    getPublicUrl(),
    // "/" reopens the page opened last.
    prisma.user.updateMany({
      where: { id: user.id, OR: [{ lastPageId: null }, { lastPageId: { not: page.id } }] },
      data: { lastPageId: page.id },
    }),
  ]);

  // Who locked the page and when; the locking page's title only if it's this
  // page or one the viewer can open.
  let lock: PageLockView | null = null;
  if (page.lock) {
    const [holder, holderAccess] = await Promise.all([
      prisma.page.findUnique({
        where: { id: page.lock.holderId },
        select: { id: true, title: true, lockedAt: true, lockSubtree: true, lockedBy: { select: { name: true, email: true } } },
      }),
      page.lock.own ? null : findAccessiblePage(user.id, page.lock.holderId),
    ]);
    lock = {
      own: page.lock.own,
      withChildren: holder?.lockSubtree ?? false,
      lockedBy: holder?.lockedBy ? holder.lockedBy.name || holder.lockedBy.email : null,
      lockedAt: holder?.lockedAt?.toISOString() ?? null,
      holder: !page.lock.own && holder && holderAccess ? { id: holder.id, title: holder.title } : null,
    };
  }

  return (
    <PageView
      // Remount per page so the editor's collab connection is replaced cleanly.
      key={page.id}
      pageId={page.id}
      initialTitle={page.title}
      canEdit={atLeast(page.access, "EDIT")}
      lock={lock}
      canManage={atLeast(page.access, "MANAGE")}
      isRootPage={page.isRootPage}
      personal={page.personal}
      shareUrl={`${publicUrl}/pages/${page.id}`}
      user={{ id: user.id, name: user.name ?? user.email }}
      sidebar={sidebar}
    />
  );
}

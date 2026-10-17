import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { findAccessiblePage } from "@/lib/auth/pages";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { atLeast } from "shared";
import { loadPublicSidebar, loadSidebar } from "@/lib/sidebar-data";
import { getPublicUrl } from "@/lib/site-url";
import { displayTitle } from "@/lib/page-title";
import { type PageLockView, PageView } from "./page-view";

// Shared by generateMetadata and the page within one request. Someone not
// logged in may view a public page; any other page sends them to the login
// screen, as before (so it doesn't tell which pages exist).
const loadPage = cache(async (pageId: string) => {
  const user = await getCurrentUser();
  if (user) return { user, page: await findAccessiblePage(user.id, pageId) };
  const page = await findAccessiblePage(null, pageId);
  if (!page) await requireUser(`/pages/${encodeURIComponent(pageId)}`);
  return { user: null, page };
});

export async function generateMetadata({ params }: PageProps<"/pages/[pageId]">): Promise<Metadata> {
  const { page } = await loadPage((await params).pageId);
  return { title: page ? `${displayTitle(page.title)} | KNOWLECTIVE` : "KNOWLECTIVE" };
}

export default async function PageEditorRoute({ params }: PageProps<"/pages/[pageId]">) {
  const { user, page } = await loadPage((await params).pageId);
  if (!page) notFound();

  const [sidebar, publicUrl] = await Promise.all([
    user ? loadSidebar(user) : loadPublicSidebar(),
    getPublicUrl(),
    // "/" reopens the page opened last.
    user &&
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
        select: { id: true, title: true, lockedAt: true, lockSubtree: true, lockedBy: { select: { name: true, emailEnc: true } } },
      }),
      page.lock.own ? null : findAccessiblePage(user?.id ?? null, page.lock.holderId),
    ]);
    lock = {
      own: page.lock.own,
      withChildren: holder?.lockSubtree ?? false,
      // Not shown to someone not logged in: people's names aren't public.
      lockedBy: user && holder?.lockedBy ? await displayName(holder.lockedBy) : null,
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
      user={user ? { id: user.id, name: user.name ?? user.email } : null}
      sidebar={sidebar}
    />
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/emails";
import { findAccessiblePage } from "@/lib/auth/pages";
import { pageOpened } from "@/lib/notifications";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { atLeast } from "shared";
import { loadPublicSidebar, loadSidebar } from "@/lib/sidebar-data";
import { getPublicUrl } from "@/lib/site-url";
import { getDisplayTitle } from "@/i18n/display-title";
import { publicPageState } from "@/lib/public-page-state";
import { getBrand } from "@/lib/brand";
import { jsonLd, pageDescription } from "@/lib/seo";
import { auditorsSeePersonalRoots, noteAuditorView } from "@/lib/personal-root-audit";
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

// Someone not logged in sees only public pages; for them (and so for search
// engines) the page is described: the start of its text, its canonical URL,
// and Open Graph / Twitter card tags (lib/seo.ts).
export async function generateMetadata({ params }: PageProps<"/pages/[pageId]">): Promise<Metadata> {
  const { user, page } = await loadPage((await params).pageId);
  if (!page) return {};
  const title = (await getDisplayTitle())(page.title);
  if (user) return { title };
  const [description, base, brand] = await Promise.all([pageDescription(page.id), getPublicUrl(), getBrand()]);
  const url = `${base}/pages/${page.id}`;
  return {
    title,
    description: description || undefined,
    alternates: { canonical: url },
    openGraph: { type: "article", title, description: description || undefined, url, siteName: brand.name },
    twitter: { card: "summary", title, description: description || undefined },
  };
}

export default async function PageEditorRoute({ params }: PageProps<"/pages/[pageId]">) {
  const { user, page } = await loadPage((await params).pageId);
  if (!page) notFound();

  // Someone else's personal root (an auditor): recorded, and said so. The
  // owner's root page says auditors may look, while they may.
  const viewingAs = user && page.personal ? await noteAuditorView(user, page, "page") : null;
  const ownerNotice = !!user && page.isRootPage && page.root.ownerId === user.id && (await auditorsSeePersonalRoots());

  const [sidebar, publicUrl, guestState, following] = await Promise.all([
    // Its notifications are read now (before the sidebar counts them).
    user ? pageOpened(user.id, page.id).then(() => loadSidebar(user)) : loadPublicSidebar(),
    getPublicUrl(),
    // Not logged in: the content now, instead of a collaborative-editing connection.
    user ? null : publicPageState(page.id, page.title),
    user ? prisma.pageFollow.count({ where: { userId: user.id, pageId: page.id } }).then((n) => n > 0) : false,
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

  // For search engines: the page as an article (someone not logged in only).
  const article = user
    ? null
    : await prisma.page.findUnique({ where: { id: page.id }, select: { createdAt: true, updatedAt: true } }).then(async (dates) => ({
        "@context": "https://schema.org",
        "@type": "Article",
        headline: (await getDisplayTitle())(page.title),
        url: `${publicUrl}/pages/${page.id}`,
        datePublished: dates?.createdAt.toISOString(),
        dateModified: dates?.updatedAt.toISOString(),
        publisher: { "@type": "Organization", name: (await getBrand()).name },
      }));

  return (
    <>
      {article && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(article) }} />}
      <PageView
        // Remount per page so the editor's collab connection is replaced cleanly.
        key={page.id}
        pageId={page.id}
        initialTitle={page.title}
        kind={page.kind}
        canEdit={atLeast(page.access, "EDIT")}
        lock={lock}
        canManage={atLeast(page.access, "MANAGE")}
        isRootPage={page.isRootPage}
        personal={page.personal}
        personalNotice={viewingAs !== null ? { auditing: viewingAs } : ownerNotice ? { auditorsMayView: true } : null}
        shareUrl={`${publicUrl}/pages/${page.id}`}
        user={user ? { id: user.id, name: user.name ?? user.email } : null}
        guestState={guestState}
        following={following}
        sidebar={sidebar}
      />
    </>
  );
}

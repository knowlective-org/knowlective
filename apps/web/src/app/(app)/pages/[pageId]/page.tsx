import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { findAccessiblePage } from "@/lib/auth/pages";
import { requireUser } from "@/lib/auth/session";
import { MAX_PAGE_DEPTH } from "@/lib/knowledge-roots";
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
  if (!page || !page.root.rootPageId) notFound();

  // Whole tree of this knowledge root for the sidebar (bounded by MAX_PAGE_DEPTH).
  const tree = await prisma.page.findMany({
    where: { rootId: page.root.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, icon: true, parentId: true },
  });

  return (
    <PageView
      // Remount per page so the editor's collab connection is replaced cleanly.
      key={page.id}
      pageId={page.id}
      readOnly={page.role === "GUEST"}
      user={{ id: user.id, name: user.name ?? user.email }}
      tree={tree}
      rootPageId={page.root.rootPageId}
      maxDepth={MAX_PAGE_DEPTH}
    />
  );
}

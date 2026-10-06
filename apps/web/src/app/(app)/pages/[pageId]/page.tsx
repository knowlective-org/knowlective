import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { findAccessiblePage } from "@/lib/auth/pages";
import { requireUser } from "@/lib/auth/session";
import { MAX_PAGE_DEPTH, atLeast, getVisibleTree } from "shared";
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

  // The part of this knowledge root the user can see, for the sidebar.
  const tree = await getVisibleTree(prisma, user.id, page.root.id);
  if (!tree) notFound();

  return (
    <PageView
      // Remount per page so the editor's collab connection is replaced cleanly.
      key={page.id}
      pageId={page.id}
      readOnly={!atLeast(page.access, "EDIT")}
      user={{ id: user.id, name: user.name ?? user.email }}
      tree={tree.pages}
      entryIds={tree.entryIds}
      maxDepth={MAX_PAGE_DEPTH}
    />
  );
}

import { getPageAccess } from "shared";
import { prisma } from "@/lib/db";

// The page plus the viewer's access to it (from group grants), or null if the
// page doesn't exist, is deleted, or none of the user's groups grants it.
// Callers should treat null as "not found" so page ids can't be probed.
// userId null: someone not logged in (public pages only, VIEW).
export async function findAccessiblePage(userId: string | null, pageId: string) {
  const result = await getPageAccess(prisma, userId, pageId);
  if (!result) return null;
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, title: true, root: { select: { id: true, rootPageId: true, ownerId: true } } },
  });
  if (!page) return null;
  return {
    id: page.id,
    title: page.title,
    access: result.access,
    // The lock applying to the page, if it's locked (see canEditPage).
    lock: result.lock,
    isRootPage: page.root.rootPageId === page.id,
    // In someone's personal knowledge root (theirs: nobody else gets here).
    personal: page.root.ownerId !== null,
    root: page.root,
  };
}

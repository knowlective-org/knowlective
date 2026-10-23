import { MAX_PAGE_DEPTH, atLeast, getPageAccess } from "shared";
import { prisma } from "@/lib/db";
import { notifyChildrenChanged } from "@/lib/collab-events";
import { nextSortOrder } from "@/lib/page-move";
import { reindexPage } from "@/lib/search-index";

// Why a page can't be created under a parent. "notAllowed" for a missing
// parent and a forbidden one alike, so page ids can't be probed.
export type CreatePageError = "notAllowed" | "lockedWithChildren" | "tooDeep";

// Creates a child page under `parentId` (last among its siblings). Needs EDIT
// on the parent; the child inherits the parent's grants, so no grant is
// added. The sidebar, the child page table and the public API all come here.
export async function insertChildPage(
  userId: string,
  parentId: unknown,
  title: string,
): Promise<{ id: string } | { error: CreatePageError }> {
  const parentAccess = typeof parentId === "string" ? await getPageAccess(prisma, userId, parentId) : null;
  if (typeof parentId !== "string" || !parentAccess || !atLeast(parentAccess.access, "EDIT")) {
    return { error: "notAllowed" };
  }
  // A lock on the parent alone doesn't stop pages being added under it; one
  // that covers its child pages does (the new page would be born locked).
  if (parentAccess.lock?.coversChildren) return { error: "lockedWithChildren" };

  // Depth of the parent (root page = 0), walked in memory over the root's
  // tree. The cap also stops a corrupted cycle.
  const tree = await prisma.page.findMany({
    where: { rootId: parentAccess.rootId },
    select: { id: true, parentId: true },
  });
  const parentOf = new Map(tree.map((p) => [p.id, p.parentId]));
  let depth = 0;
  for (let cursor = parentOf.get(parentId) ?? null; cursor; cursor = parentOf.get(cursor) ?? null) {
    if (++depth >= MAX_PAGE_DEPTH) break;
  }
  if (depth + 1 > MAX_PAGE_DEPTH) return { error: "tooDeep" };

  const page = await prisma.page.create({
    // An empty title shows as "untitled" until renamed. The collab server seeds the
    // document's title from this when the page is first opened.
    data: { title, rootId: parentAccess.rootId, parentId, createdById: userId, sortOrder: await nextSortOrder(parentId) },
    select: { id: true },
  });
  // Findable by title right away, before anyone opens it.
  await reindexPage(prisma, page.id);
  notifyChildrenChanged(parentId);
  return page;
}

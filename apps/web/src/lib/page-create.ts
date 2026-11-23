import { MAX_PAGE_DEPTH, type PageKind, atLeast } from "shared";
import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { notifyChildrenChanged } from "@/lib/collab-events";
import { nextSortOrder } from "@/lib/page-move";
import { reindexPage } from "@/lib/search-index";
import { hasRoomForSlide, lockPresentations } from "@/lib/presentation-tree";

// Why a page can't be created under a parent. "notAllowed" for a missing
// parent and a forbidden one alike, so page ids can't be probed.
export type CreatePageError = "notAllowed" | "lockedWithChildren" | "tooDeep" | "presentationLocked" | "tooManySlides";

// Creates a child page under `parentId` (last among its siblings). Needs EDIT
// on the parent; the child inherits the parent's grants, so no grant is
// added. The sidebar, the child page table and the public API all come here.
export async function insertChildPage(
  userId: string,
  parentId: unknown,
  title: string,
  // A document, a whiteboard (lib/whiteboard.ts) or a shortcut (lib/shortcuts.ts,
  // which checks `shortcutTargetId`); fixed for the page's life.
  kind: PageKind = "DOCUMENT",
  shortcutTargetId: string | null = null,
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
    select: { id: true, parentId: true, kind: true },
  });
  // Nothing goes under a shortcut (it opens another page; it has no children).
  const parentKind = tree.find((p) => p.id === parentId)?.kind;
  if (parentKind === "SHORTCUT" || parentKind === "SLIDE") return { error: "notAllowed" };
  // A presentation holds slides and nothing else; a slide is in nothing else.
  if ((parentKind === "PRESENTATION") !== (kind === "SLIDE")) return { error: "notAllowed" };
  // Even a lock on the presentation alone stops slides being added.
  if (kind === "SLIDE" && parentAccess.lock) return { error: "presentationLocked" };
  const parentOf = new Map(tree.map((p) => [p.id, p.parentId]));
  let depth = 0;
  for (let cursor = parentOf.get(parentId) ?? null; cursor; cursor = parentOf.get(cursor) ?? null) {
    if (++depth >= MAX_PAGE_DEPTH) break;
  }
  if (depth + 1 > MAX_PAGE_DEPTH) return { error: "tooDeep" };

  // An empty title shows as "untitled" until renamed. The collab server seeds the
  // document's title from this when the page is first opened.
  const data = {
    title,
    kind,
    shortcutTargetId: kind === "SHORTCUT" ? shortcutTargetId : null,
    rootId: parentAccess.rootId,
    parentId,
    createdById: userId,
  };
  let firstSlideId: string | null = null;
  let page: { id: string } | null;
  if (kind === "SLIDE") {
    page = await prisma.$transaction(async (tx) => {
      await lockPresentations(tx, [parentId]);
      if (!(await hasRoomForSlide(tx, parentId))) return null;
      const last = await tx.page.aggregate({ where: { parentId }, _max: { sortOrder: true } });
      return tx.page.create({ data: { ...data, sortOrder: (last._max.sortOrder ?? -1) + 1 }, select: { id: true } });
    });
    if (!page) return { error: "tooManySlides" };
  } else if (kind === "PRESENTATION") {
    // A presentation starts with one empty slide and its settings.
    const sortOrder = await nextSortOrder(parentId);
    const created = await prisma.$transaction(async (tx) => {
      const deck = await tx.page.create({ data: { ...data, sortOrder }, select: { id: true } });
      await tx.presentationSettings.create({ data: { pageId: deck.id } });
      const slide = await tx.page.create({
        data: { ...data, title: "", kind: "SLIDE", parentId: deck.id, sortOrder: 0 },
        select: { id: true },
      });
      return { deck, slide };
    });
    page = created.deck;
    firstSlideId = created.slide.id;
  } else {
    page = await prisma.page.create({ data: { ...data, sortOrder: await nextSortOrder(parentId) }, select: { id: true } });
  }
  // Findable by title right away, before anyone opens it.
  await reindexPage(prisma, page.id);
  if (firstSlideId) await reindexPage(prisma, firstSlideId);
  notifyChildrenChanged(parentId);
  return page;
}

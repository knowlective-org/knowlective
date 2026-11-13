import * as Y from "yjs";
import { decrypt, getUsersWithPageAccess, loadDataKey } from "shared";
import { getPageAccess, getVisibleTree } from "@/lib/page-access";
import { liveDocumentState } from "@/lib/collab-events";
import { prisma } from "@/lib/db";
import { bodyToMarkdown } from "@/lib/markdown-bridge";
import type { ChildPageItem } from "@/lib/page-property-types";
import { TITLE_FIELD, normalizeTitle } from "@/lib/page-title";
import { getPublicUrl } from "@/lib/site-url";
import { linkedViewSources } from "@/lib/child-view-blocks";

// A page's content for the public API. The Markdown conversion itself runs in
// the custom server (lib/markdown-bridge.ts, server/page-markdown.ts).

export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

export { markdownToBody } from "@/lib/markdown-bridge";

// The page's document as it is now: open in the collab server (with edits not
// stored yet), or else as stored.
export async function currentPageState(pageId: string): Promise<Uint8Array | null> {
  const live = liveDocumentState(pageId);
  if (live) return live;
  const stored = await prisma.pageDocument.findUnique({ where: { pageId }, select: { state: true } });
  return stored ? decrypt(await loadDataKey(prisma), stored.state, pageId) : null;
}

// The pages below `pageId` that `userId` can see (child page blocks are
// written out as links to them).
async function visibleChildPages(userId: string, pageId: string): Promise<ChildPageItem[]> {
  const access = await getPageAccess(prisma, userId, pageId);
  const tree = access ? await getVisibleTree(prisma, userId, access.rootId) : null;
  if (!tree) return [];
  const below = new Set([pageId]);
  const result: ChildPageItem[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of tree.pages) {
      // Not shortcuts, as in the child page blocks (child-pages-actions.ts).
      if (p.parentId && below.has(p.parentId) && !below.has(p.id) && p.kind !== "SHORTCUT") {
        below.add(p.id);
        result.push({ id: p.id, parentId: p.parentId, title: p.title, icon: p.icon, updatedAt: "", createdAt: "" });
        changed = true;
      }
    }
  }
  // The times, for a list sorted by them.
  const times = await prisma.page.findMany({
    where: { id: { in: result.map((p) => p.id) } },
    select: { id: true, updatedAt: true, createdAt: true },
  });
  const time = new Map(times.map((t) => [t.id, t]));
  for (const p of result) {
    p.updatedAt = time.get(p.id)?.updatedAt.toISOString() ?? "";
    p.createdAt = time.get(p.id)?.createdAt.toISOString() ?? "";
  }
  return result;
}

// Title and body (Markdown) of a page `userId` can see; access is checked by
// the caller.
export async function pageContent(
  userId: string,
  pageId: string,
  fallbackTitle: string,
  untitled: string,
): Promise<{ title: string; markdown: string }> {
  const state = await currentPageState(pageId);
  if (!state) return { title: fallbackTitle, markdown: "" };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const title = normalizeTitle(doc.getText(TITLE_FIELD).toString()) || fallbackTitle;
  // Linked views (lib/linked-views.ts): their pages' child pages, as the reader sees them.
  const linkedChildPages: Record<string, ChildPageItem[]> = {};
  for (const id of linkedViewSources(doc)) {
    if (id !== pageId) linkedChildPages[id] = await visibleChildPages(userId, id);
  }
  const markdown = await bodyToMarkdown(state, {
    origin: await getPublicUrl(),
    pageId,
    childPages: await visibleChildPages(userId, pageId),
    linkedChildPages,
    untitled,
    // Mentions as "@name": the names of those who can open the page.
    people: Object.fromEntries((await getUsersWithPageAccess(prisma, pageId)).map((u) => [u.id, u.name || u.email])),
  });
  return { title, markdown };
}

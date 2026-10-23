import * as Y from "yjs";
import { decrypt, getPageAccess, getVisibleTree, loadDataKey } from "shared";
import { liveDocumentState } from "@/lib/collab-events";
import { prisma } from "@/lib/db";
import { bodyToMarkdown } from "@/lib/markdown-bridge";
import type { ChildPageItem } from "@/lib/page-property-types";
import { TITLE_FIELD, normalizeTitle } from "@/lib/page-title";
import { getPublicUrl } from "@/lib/site-url";

// A page's content for the public API. The Markdown conversion itself runs in
// the custom server (lib/markdown-bridge.ts, server/page-markdown.ts).

export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

export { markdownToBody } from "@/lib/markdown-bridge";

// The page's document as it is now: open in the collab server (with edits not
// stored yet), or else as stored.
async function currentState(pageId: string): Promise<Uint8Array | null> {
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
      if (p.parentId && below.has(p.parentId) && !below.has(p.id)) {
        below.add(p.id);
        result.push({ id: p.id, parentId: p.parentId, title: p.title, icon: p.icon, updatedAt: "" });
        changed = true;
      }
    }
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
  const state = await currentState(pageId);
  if (!state) return { title: fallbackTitle, markdown: "" };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const title = normalizeTitle(doc.getText(TITLE_FIELD).toString()) || fallbackTitle;
  const markdown = await bodyToMarkdown(state, {
    origin: await getPublicUrl(),
    pageId,
    childPages: await visibleChildPages(userId, pageId),
    untitled,
  });
  return { title, markdown };
}

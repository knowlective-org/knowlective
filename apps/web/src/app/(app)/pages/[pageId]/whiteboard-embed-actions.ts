"use server";

import * as Y from "yjs";
import { getPageAccess } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { currentPageState } from "@/lib/api/page-content";
import { TITLE_FIELD } from "@/lib/page-title";
import { PAGE_ID, copyWhiteboard } from "@/lib/whiteboard";

// The whiteboard block of a document (components/editor/whiteboard-embed-
// block.tsx): another page's whiteboard, shown read-only to each viewer with
// their own access, as the child page blocks do. The document holds only the
// page's id; someone who can't open that page gets nothing, not even its
// title (the same answer as for a page that isn't there or isn't a whiteboard).

export type WhiteboardEmbed = {
  title: string;
  // A base64 Yjs update holding the board alone (a fresh copy, without the
  // page's history), as for a public page (lib/public-page-state.ts).
  state: string;
};

export async function loadWhiteboardEmbed(pageId: string): Promise<WhiteboardEmbed | null> {
  // Shown on public pages too: someone not logged in sees it if the
  // whiteboard is public as well.
  const user = await getCurrentUser();
  if (typeof pageId !== "string" || !PAGE_ID.test(pageId)) return null;
  const access = await getPageAccess(prisma, user?.id ?? null, pageId);
  if (!access) return null;
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { kind: true, title: true } });
  if (page?.kind !== "WHITEBOARD") return null;
  const state = await currentPageState(pageId);
  const source = new Y.Doc();
  if (state) Y.applyUpdate(source, state);
  const copy = new Y.Doc();
  copy.transact(() => copyWhiteboard(source, copy));
  return {
    title: (state && source.getText(TITLE_FIELD).toString()) || page.title,
    state: Buffer.from(Y.encodeStateAsUpdate(copy)).toString("base64"),
  };
}

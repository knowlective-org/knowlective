"use server";

import { redirect } from "next/navigation";
import { MAX_PAGE_DEPTH, atLeast, createCollabToken, getPageAccess } from "shared";
import { prisma } from "@/lib/db";
import { findAccessiblePage } from "@/lib/auth/pages";
import { notifyChildrenChanged } from "@/lib/collab-events";
import { normalizeTitle } from "@/lib/page-title";
import { reindexPage } from "@/lib/search-index";
import { endUserSession, requireUser } from "@/lib/auth/session";

export async function logout(): Promise<void> {
  await endUserSession();
  redirect("/login");
}

// Called by the editor each time it (re)connects to the collab server, so the
// short-lived token is always fresh and membership is re-checked.
export async function getCollabToken(pageId: string): Promise<string> {
  const user = await requireUser();
  if (typeof pageId !== "string" || !(await findAccessiblePage(user.id, pageId))) {
    throw new Error("Page not found");
  }
  return createCollabToken(user.id, pageId);
}

// Creates a child page under `parentId`. Needs EDIT on the parent; the child
// inherits the parent's grants, so no grant is added.
async function insertChildPage(
  userId: string,
  parentId: unknown,
  title: string,
): Promise<{ id: string } | { error: string }> {
  const parentAccess = typeof parentId === "string" ? await getPageAccess(prisma, userId, parentId) : null;
  // Same message for missing and forbidden, so page ids can't be probed.
  if (typeof parentId !== "string" || !parentAccess || !atLeast(parentAccess.access, "EDIT")) {
    return { error: "このページの下にはページを作成できません。" };
  }

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
  if (depth + 1 > MAX_PAGE_DEPTH) {
    return { error: `ページの階層は${MAX_PAGE_DEPTH}段までです。` };
  }

  const page = await prisma.page.create({
    // An empty title shows as 無題 until renamed. The collab server seeds the
    // document's title from this when the page is first opened.
    data: { title, rootId: parentAccess.rootId, parentId, createdById: userId },
    select: { id: true },
  });
  // Findable by title right away, before anyone opens it.
  await reindexPage(prisma, page.id);
  notifyChildrenChanged(parentId);
  return page;
}

// Creates an untitled child page under `parentId` and opens it (sidebar ＋).
export async function createChildPage(parentId: string): Promise<{ error: string }> {
  const user = await requireUser();
  const result = await insertChildPage(user.id, parentId, "");
  if ("error" in result) return result;
  redirect(`/pages/${result.id}`);
}

// Creates a child page with a title and stays on the current page (child-page
// table's 新しいページ row).
export async function createChildPageInPlace(parentId: string, title: string): Promise<{ id: string } | { error: string }> {
  const user = await requireUser();
  return insertChildPage(user.id, parentId, normalizeTitle(typeof title === "string" ? title : ""));
}

"use server";

import { redirect } from "next/navigation";
import { MAX_PAGE_DEPTH, atLeast, createCollabToken, getPageAccess } from "shared";
import { prisma } from "@/lib/db";
import { findAccessiblePage } from "@/lib/auth/pages";
import { notifyChildrenChanged } from "@/lib/collab-events";
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

// Creates an untitled child page under `parentId` and opens it. Needs EDIT on
// the parent; the child inherits the parent's grants, so no grant is added.
export async function createChildPage(parentId: string): Promise<{ error: string }> {
  const user = await requireUser();
  const parentAccess = typeof parentId === "string" ? await getPageAccess(prisma, user.id, parentId) : null;
  // Same message for missing and forbidden, so page ids can't be probed.
  if (!parentAccess || !atLeast(parentAccess.access, "EDIT")) {
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
    // Empty title: shown as 無題 until renamed in the editor.
    data: { title: "", rootId: parentAccess.rootId, parentId, createdById: user.id },
    select: { id: true },
  });
  notifyChildrenChanged(parentId);
  redirect(`/pages/${page.id}`);
}

import type { VisibleTree } from "shared";
import { prisma } from "@/lib/db";
import { getPageAccess } from "@/lib/page-access";
import { type CreatePageError, insertChildPage } from "@/lib/page-create";

// Shortcuts (Page.kind = SHORTCUT): an entry in the page tree that opens
// another page, from anywhere the user can add a page. It's a page like any
// other for its place in the tree — moved, reordered, put in the trash and
// shared as one — but has no content and no child pages. What it shows and
// opens is decided by the viewer's own access to the target: someone who
// can see the shortcut but not its target sees neither the target's title
// nor anything in it. Its own title stays empty.

// The page a shortcut opens for `userId` (null: not logged in), or null when
// they can't open it (or it's gone, in the trash, or another shortcut).
export async function shortcutTarget(userId: string | null, targetId: string | null): Promise<string | null> {
  if (!targetId) return null;
  const access = await getPageAccess(prisma, userId, targetId);
  if (!access) return null;
  const target = await prisma.page.findUnique({ where: { id: targetId }, select: { kind: true } });
  return target && target.kind !== "SHORTCUT" ? targetId : null;
}

// Creates a shortcut to `targetId` under `parentId` (last among its
// siblings): the user must be able to open the target, and add a page
// under the parent (insertChildPage). A shortcut to a shortcut points at
// that one's target instead.
export async function createShortcut(
  userId: string,
  targetId: unknown,
  parentId: unknown,
): Promise<{ id: string } | { error: CreatePageError }> {
  if (typeof targetId !== "string") return { error: "notAllowed" };
  let target = targetId;
  const page = await prisma.page.findUnique({ where: { id: target }, select: { kind: true, shortcutTargetId: true } });
  if (page?.kind === "SHORTCUT") target = page.shortcutTargetId ?? "";
  if (!(await shortcutTarget(userId, target))) return { error: "notAllowed" };
  return insertChildPage(userId, parentId, "", "SHORTCUT", target);
}

export type ShortcutView = {
  // The target, when the viewer can open it.
  targetId: string | null;
};

// The viewer's trees with each shortcut's title and icon taken from its
// target, where the viewer can open the target (it's then among their
// visible pages); an empty title otherwise, with `shortcut.targetId` null.
// `trees` must be every tree the viewer can see (getVisibleTrees), so a
// target not among them is one they can't open.
export function resolveShortcuts<T extends VisibleTree>(
  trees: T[],
): (Omit<T, "pages"> & { pages: (T["pages"][number] & { shortcut: ShortcutView | null })[] })[] {
  const visible = new Map(trees.flatMap((t) => t.pages.map((p) => [p.id, p] as const)));
  return trees.map((tree) => ({
    ...tree,
    pages: tree.pages.map((p) => {
      if (p.kind !== "SHORTCUT") return { ...p, shortcut: null };
      const target = p.shortcutTargetId ? visible.get(p.shortcutTargetId) : undefined;
      if (!target || target.kind === "SHORTCUT") return { ...p, title: "", icon: null, shortcut: { targetId: null } };
      return { ...p, title: target.title, icon: target.icon, shortcut: { targetId: target.id } };
    }),
  }));
}

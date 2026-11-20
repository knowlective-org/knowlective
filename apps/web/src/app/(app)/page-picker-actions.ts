"use server";

import { MAX_PAGE_DEPTH } from "shared";
import { getVisibleTrees } from "@/lib/page-access";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getTranslations } from "next-intl/server";
import { getDisplayTitle } from "@/i18n/display-title";

// The pages someone can choose from (components/page-picker-dialog.tsx): to
// link a whiteboard's item to, to show in a document's whiteboard block, or
// whose child pages a linked view shows.
// Only pages they can see, per knowledge root in tree order, with only the
// titles they can see. Whiteboards are listed alone, each with the titles of
// the pages above it; for the other kinds the whole tree is listed, pages of
// another kind greyed (for where the others are).

export type PickablePage = {
  id: string;
  title: string;
  depth: number;
  // Of the kind asked for (the others are shown for where they are).
  selectable: boolean;
};

export type PickableGroup = { label: string; pages: PickablePage[] };

// `kind`: any page, whiteboards only, or pages that can have child pages
// (not shortcuts, lib/shortcuts.ts). `exclude`: a page not to offer (the one
// being edited).
export type PickableKind = "any" | "whiteboard" | "parent";

export async function loadPickablePages(kind: PickableKind, exclude: string | null = null): Promise<PickableGroup[]> {
  const user = await requireUser();
  const trees = await getVisibleTrees(prisma, user.id);
  const ids = trees.flatMap((t) => t.pages.map((p) => p.id));
  const whiteboards =
    kind === "whiteboard"
      ? new Set((await prisma.page.findMany({ where: { id: { in: ids }, kind: "WHITEBOARD" }, select: { id: true } })).map((p) => p.id))
      : null;

  const t = await getTranslations("pagePicker");
  const displayTitle = await getDisplayTitle();
  const groups: PickableGroup[] = [];
  const shared: PickablePage[] = [];
  for (const tree of trees) {
    const childrenOf = new Map<string, typeof tree.pages>();
    for (const p of tree.pages) {
      if (p.parentId) childrenOf.set(p.parentId, [...(childrenOf.get(p.parentId) ?? []), p]);
    }
    const byId = new Map(tree.pages.map((p) => [p.id, p]));
    // `trail`: the titles of the pages above (from the entry page down).
    const visit = (id: string, depth: number, out: PickablePage[], trail: string[] = []) => {
      const p = byId.get(id);
      if (!p || depth > MAX_PAGE_DEPTH) return;
      const title = displayTitle(p.title);
      if (whiteboards) {
        // Whiteboards alone, each after the titles of the pages above it
        // (all the viewer's own: visible pages from the entry page down).
        if (whiteboards.has(id) && id !== exclude) out.push({ id, title: [...trail, title].join(" / "), depth: 0, selectable: true });
      } else {
        const ofKind = kind === "parent" ? p.kind !== "SHORTCUT" : true;
        out.push({ id, title, depth, selectable: id !== exclude && ofKind });
      }
      for (const child of childrenOf.get(id) ?? []) visit(child.id, depth + 1, out, [...trail, title]);
    };
    for (const entryId of tree.entryIds) {
      if (entryId === tree.rootPageId) {
        const pages: PickablePage[] = [];
        visit(entryId, 0, pages);
        if (pages.length > 0) groups.push({ label: displayTitle(byId.get(entryId)?.title ?? ""), pages });
      } else {
        visit(entryId, 0, shared);
      }
    }
  }
  if (shared.length > 0) groups.push({ label: t("sharedPages"), pages: shared });
  return groups;
}

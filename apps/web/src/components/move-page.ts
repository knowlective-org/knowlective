"use client";

import { type MoveCheck, checkMovePage, movePage } from "@/app/(app)/page-move-actions";
import { useTranslations } from "next-intl";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { showAlert, showConfirm } from "./dialog";

export type DraggedPage = {
  id: string;
  title: string;
  parentId: string;
  // EDIT on the page: needed to change its parent (not to reorder it).
  canEdit: boolean;
  // The page and its visible descendants: never a drop target.
  subtree: Set<string>;
};

// The page being dragged in the sidebar. Module-level so a drop can land in
// another knowledge root's tree (each tree is its own DocTree). Only used
// from drag event handlers.
let draggedPage: DraggedPage | null = null;
export const getDraggedPage = () => draggedPage;
export const setDraggedPage = (page: DraggedPage | null) => {
  draggedPage = page;
};

// confirmAndMovePage() with the viewer's language: moves a page after
// checking it on the server. A change of parent changes the page's access, so
// it's confirmed first; a reorder among the same siblings isn't. Errors are
// shown in a dialog. The returned function resolves to whether it moved.
export function useConfirmAndMovePage() {
  const t = useTranslations();
  const displayTitle = useDisplayTitle();

  const confirmMessage = (title: string, check: MoveCheck): string => {
    const lines = [
      t("movePage.confirm", {
        title: displayTitle(title),
        descendants: check.descendants,
        parent: displayTitle(check.toParentTitle),
      }),
    ];
    if (check.toRootTitle !== null) lines.push(t("movePage.toRoot", { root: displayTitle(check.toRootTitle) }));
    lines.push("");
    if (check.accessChanges.length === 0) {
      lines.push(t("movePage.sameAccess"));
    } else {
      lines.push(t("movePage.accessChanges"));
      for (const c of check.accessChanges) {
        const before = c.before ? t(`access.${c.before}`) : t("common.none");
        const after = c.after ? t(`access.${c.after}`) : t("common.none");
        lines.push(t("movePage.accessChange", { group: c.group, before, after }));
      }
    }
    return lines.join("\n");
  };

  return async function confirmAndMovePage(input: {
    pageId: string;
    title: string;
    parentId: string;
    beforeId: string | null;
  }): Promise<boolean> {
    const check = await checkMovePage(input.pageId, input.parentId, input.beforeId);
    if ("error" in check) {
      await showAlert(check.error, { title: t("movePage.cannotMove") });
      return false;
    }
    if (
      check.parentChanges &&
      !(await showConfirm(confirmMessage(input.title, check), {
        title: t("movePage.title"),
        confirmLabel: t("movePage.confirmLabel"),
      }))
    ) {
      return false;
    }
    const result = await movePage(input.pageId, input.parentId, input.beforeId);
    if (result.error) {
      await showAlert(result.error, { title: t("movePage.cannotMove") });
      return false;
    }
    return true;
  };
}
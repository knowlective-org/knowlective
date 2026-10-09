"use client";

import { type MoveCheck, checkMovePage, movePage } from "@/app/(app)/page-move-actions";
import { displayTitle } from "@/lib/page-title";
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

const ACCESS_LABELS: Record<string, string> = { VIEW: "閲覧", EDIT: "編集", MANAGE: "管理" };

function confirmMessage(title: string, check: MoveCheck): string {
  const children = check.descendants > 0 ? `（とその下の${check.descendants}ページ）` : "";
  const lines = [`「${displayTitle(title)}」${children}を「${displayTitle(check.toParentTitle)}」の下に移動しますか？`];
  if (check.toRootTitle !== null) lines.push(`ナレッジルート「${displayTitle(check.toRootTitle)}」に移ります。`);
  lines.push("");
  if (check.accessChanges.length === 0) {
    lines.push("権限は移動先から引き継ぎます（見られる人は変わりません）。");
  } else {
    lines.push("権限は移動先から引き継ぐため、次のように変わります:");
    for (const c of check.accessChanges) {
      const before = c.before ? ACCESS_LABELS[c.before] : "なし";
      const after = c.after ? ACCESS_LABELS[c.after] : "なし";
      lines.push(`・${c.group}: ${before} → ${after}`);
    }
  }
  return lines.join("\n");
}

// Moves a page after checking it on the server. A change of parent changes
// the page's access, so it's confirmed first; a reorder among the same
// siblings isn't. Errors are shown in a dialog. Returns whether it moved.
export async function confirmAndMovePage(input: {
  pageId: string;
  title: string;
  parentId: string;
  beforeId: string | null;
}): Promise<boolean> {
  const check = await checkMovePage(input.pageId, input.parentId, input.beforeId);
  if ("error" in check) {
    await showAlert(check.error, { title: "移動できません" });
    return false;
  }
  if (
    check.parentChanges &&
    !(await showConfirm(confirmMessage(input.title, check), { title: "ページの移動", confirmLabel: "移動する" }))
  ) {
    return false;
  }
  const result = await movePage(input.pageId, input.parentId, input.beforeId);
  if (result.error) {
    await showAlert(result.error, { title: "移動できません" });
    return false;
  }
  return true;
}

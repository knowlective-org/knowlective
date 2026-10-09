"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { displayTitle } from "@/lib/page-title";
import styles from "@/styles/ui.module.css";
import { restorePage } from "./actions";
import trashStyles from "./trash-list.module.css";
import { showAlert, showConfirm } from "@/components/dialog";

export type TrashListItem = {
  id: string;
  title: string;
  icon: string | null;
  deletedAt: string;
  deletedBy: string;
  parent: { id: string; title: string } | null;
  // The original parent is in the trash too: restoring needs a new place.
  parentInTrash: boolean;
  suggestedParentId: string | null;
  rootId: string;
};

type Destination = { id: string; title: string; depth: number };

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

export function TrashList({
  items,
  destinations,
}: {
  items: TrashListItem[];
  // Per knowledge root: live pages the user can edit, in tree order.
  destinations: Record<string, Destination[]>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // The item whose destination picker is open, and the page picked in it.
  const [picking, setPicking] = useState<{ id: string; parentId: string } | null>(null);
  const [, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <p className={styles.note} data-ui="TrashList.empty">
        ごみ箱は空です。
      </p>
    );
  }

  const restore = async (item: TrashListItem, newParentId?: string) => {
    if (newParentId) {
      const to = destinations[item.rootId]?.find((d) => d.id === newParentId);
      const from = item.parent ? `元の親「${displayTitle(item.parent.title)}」` : "元の親ページ";
      const message =
        `「${displayTitle(item.title)}」を「${displayTitle(to?.title ?? "")}」の下に戻します（${from}はごみ箱にあるため）。\n` +
        `ページの権限は、戻した場所から引き継がれます。よろしいですか？`;
      if (!(await showConfirm(message, { title: "ページを戻す", confirmLabel: "戻す" }))) return;
    }
    setBusy(item.id);
    startTransition(async () => {
      const result = await restorePage(item.id, newParentId);
      if (result.error) void showAlert(result.error, { title: "元に戻せません" });
      else setPicking(null);
      // Refreshes this list and the sidebar (the page is back in the tree).
      router.refresh();
      setBusy(null);
    });
  };

  return (
    <table className={styles.table} data-ui="TrashList">
      <thead>
        <tr>
          <th>ページ</th>
          <th>元の場所</th>
          <th>削除した人</th>
          <th>削除日時</th>
          <th aria-label="操作" />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const options = destinations[item.rootId] ?? [];
          const isPicking = picking?.id === item.id;
          return (
            <Fragment key={item.id}>
              <tr
                className={item.parentInTrash ? trashStyles.orphan : undefined}
                data-ui="TrashList.row"
                data-id={item.id}
                data-parent-in-trash={item.parentInTrash || undefined}
              >
                <td className={trashStyles.dim}>
                  {item.icon ? `${item.icon} ` : "📄 "}
                  {displayTitle(item.title)}
                </td>
                <td className={trashStyles.dim}>
                  {item.parent ? (
                    item.parentInTrash ? (
                      displayTitle(item.parent.title)
                    ) : (
                      <Link href={`/pages/${item.parent.id}`} style={{ textDecoration: "underline" }}>
                        {displayTitle(item.parent.title)}
                      </Link>
                    )
                  ) : (
                    "（権限のないページ）"
                  )}
                  {item.parentInTrash && <div className={trashStyles.badge}>親ページがごみ箱にあります</div>}
                </td>
                <td className={trashStyles.dim}>{item.deletedBy || "—"}</td>
                <td className={trashStyles.dim} style={{ whiteSpace: "nowrap" }}>
                  {dateTimeFormat.format(new Date(item.deletedAt))}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {item.parentInTrash ? (
                    <button
                      type="button"
                      className={styles.buttonSecondary}
                      style={{ padding: "4px 12px" }}
                      disabled={busy !== null || options.length === 0}
                      title={options.length === 0 ? "戻せる場所（編集できるページ）がありません" : undefined}
                      aria-expanded={isPicking}
                      onClick={() =>
                        setPicking(
                          isPicking ? null : { id: item.id, parentId: item.suggestedParentId ?? options[0]?.id ?? "" },
                        )
                      }
                      data-ui="TrashList.chooseButton"
                    >
                      戻す場所を選ぶ
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.buttonSecondary}
                      style={{ padding: "4px 12px" }}
                      disabled={busy !== null}
                      onClick={() => restore(item)}
                      data-ui="TrashList.restoreButton"
                    >
                      {busy === item.id ? "戻しています…" : "元に戻す"}
                    </button>
                  )}
                </td>
              </tr>
              {isPicking && (
                <tr data-ui="TrashList.picker" data-id={item.id}>
                  <td colSpan={5}>
                    <div className={trashStyles.picker}>
                      <label className={trashStyles.pickerLabel}>
                        戻す場所（このページの下に戻します）
                        <select
                          className={styles.field}
                          value={picking.parentId}
                          onChange={(e) => setPicking({ id: item.id, parentId: e.target.value })}
                          data-ui="TrashList.destinationSelect"
                        >
                          {options.map((d) => (
                            <option key={d.id} value={d.id}>
                              {"　".repeat(d.depth)}
                              {displayTitle(d.title)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className={trashStyles.pickerActions}>
                        <button
                          type="button"
                          className={styles.button}
                          disabled={busy !== null || !picking.parentId}
                          onClick={() => restore(item, picking.parentId)}
                          data-ui="TrashList.restoreHereButton"
                        >
                          {busy === item.id ? "戻しています…" : "ここに戻す"}
                        </button>
                        <button
                          type="button"
                          className={styles.buttonSecondary}
                          onClick={() => setPicking(null)}
                        >
                          キャンセル
                        </button>
                      </div>
                      <p className={styles.note}>
                        ページの権限は、戻した場所から引き継がれます。同じナレッジルートの中で、編集できるページだけを選べます。
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useState, useTransition } from "react";
import { useDisplayTitle } from "@/i18n/use-display-title";
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
  const t = useTranslations("trash");
  const tc = useTranslations("common");
  const format = useFormatter();
  const displayTitle = useDisplayTitle();

  if (items.length === 0) {
    return (
      <p className={styles.note} data-ui="TrashList.empty">
        {t("empty")}
      </p>
    );
  }

  const restore = async (item: TrashListItem, newParentId?: string) => {
    if (newParentId) {
      const to = destinations[item.rootId]?.find((d) => d.id === newParentId);
      const from = item.parent ? t("fromParent", { title: displayTitle(item.parent.title) }) : t("fromParentUnknown");
      const message = t("restoreConfirm", { title: displayTitle(item.title), to: displayTitle(to?.title ?? ""), from });
      if (!(await showConfirm(message, { title: t("restoreTitle"), confirmLabel: t("restoreLabel") }))) return;
    }
    setBusy(item.id);
    startTransition(async () => {
      const result = await restorePage(item.id, newParentId);
      if (result.error) void showAlert(result.error, { title: t("cannotRestore") });
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
          <th>{t("page")}</th>
          <th>{t("from")}</th>
          <th>{t("deletedBy")}</th>
          <th>{t("deletedAt")}</th>
          <th aria-label={t("actions")} />
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
                    t("noAccessPage")
                  )}
                  {item.parentInTrash && <div className={trashStyles.badge}>{t("parentInTrash")}</div>}
                </td>
                <td className={trashStyles.dim}>{item.deletedBy || "—"}</td>
                <td className={trashStyles.dim} style={{ whiteSpace: "nowrap" }}>
                  {format.dateTime(new Date(item.deletedAt), { dateStyle: "medium", timeStyle: "short" })}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {item.parentInTrash ? (
                    <button
                      type="button"
                      className={styles.buttonSecondary}
                      style={{ padding: "4px 12px" }}
                      disabled={busy !== null || options.length === 0}
                      title={options.length === 0 ? t("noDestinations") : undefined}
                      aria-expanded={isPicking}
                      onClick={() =>
                        setPicking(
                          isPicking ? null : { id: item.id, parentId: item.suggestedParentId ?? options[0]?.id ?? "" },
                        )
                      }
                      data-ui="TrashList.chooseButton"
                    >
                      {t("chooseDestination")}
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
                      {busy === item.id ? t("restoring") : t("restore")}
                    </button>
                  )}
                </td>
              </tr>
              {isPicking && (
                <tr data-ui="TrashList.picker" data-id={item.id}>
                  <td colSpan={5}>
                    <div className={trashStyles.picker}>
                      <label className={trashStyles.pickerLabel}>
                        {t("destination")}
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
                          {busy === item.id ? t("restoring") : t("restoreHere")}
                        </button>
                        <button
                          type="button"
                          className={styles.buttonSecondary}
                          onClick={() => setPicking(null)}
                        >
                          {tc("cancel")}
                        </button>
                      </div>
                      <p className={styles.note}>
                        {t("destinationNote")}
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

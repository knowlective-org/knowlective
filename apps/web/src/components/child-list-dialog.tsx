"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { type ChildListItem, loadChildList } from "@/app/(app)/child-list-actions";
import { useDisplayTitle } from "@/i18n/use-display-title";
import ui from "@/styles/ui.module.css";
import styles from "./dialog.module.css";
import listStyles from "./child-list-dialog.module.css";

// Every child page of a page the viewer can open, with a filter by title:
// from the sidebar's "N more pages" (a page with many children lists only
// the one on the way to the open page) and the page menu's "child pages".
export function ChildListDialog({ pageId, title, onClose }: { pageId: string; title: string; onClose: () => void }) {
  const t = useTranslations("childList");
  const tc = useTranslations("common");
  const displayTitle = useDisplayTitle();
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<ChildListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    ref.current?.showModal();
    loadChildList(pageId)
      .then((result) => (result ? setItems(result) : setFailed(true)))
      .catch(() => setFailed(true));
  }, [pageId]);

  const label = (item: ChildListItem) =>
    item.shortcut && !item.href ? t("shortcutUnavailable") : `${item.icon ? `${item.icon} ` : ""}${displayTitle(item.title)}`;
  const q = query.normalize("NFKC").toLowerCase().trim();
  const shown = (items ?? []).filter((item) => !q || label(item).normalize("NFKC").toLowerCase().includes(q));

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-ui="ChildListDialog"
      aria-labelledby="child-list-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.body}>
        <h2 id="child-list-title" className={styles.title}>
          {t("title", { title })}
        </h2>
        {failed ? (
          <p className={ui.error} data-ui="ChildListDialog.error">
            {t("loadFailed")}
          </p>
        ) : items === null ? (
          <p className={ui.note} data-ui="ChildListDialog.status">
            {t("loading")}
          </p>
        ) : items.length === 0 ? (
          <p className={ui.note} data-ui="ChildListDialog.status">
            {t("none")}
          </p>
        ) : (
          <>
            <input
              type="search"
              className={ui.field}
              value={query}
              placeholder={t("filter")}
              aria-label={t("filter")}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              data-ui="ChildListDialog.filterInput"
            />
            <p className={ui.note} data-ui="ChildListDialog.count">
              {q ? t("matches", { count: shown.length, total: items.length }) : t("count", { count: items.length })}
            </p>
            <ul className={listStyles.list} data-ui="ChildListDialog.list">
              {shown.map((item) => (
                <li key={item.id}>
                  {item.href ? (
                    <Link href={item.href} className={listStyles.link} onClick={onClose} data-ui="ChildListDialog.pageLink" data-id={item.id}>
                      {label(item)}
                      {item.shortcut && (
                        <span className={listStyles.mark} aria-label={t("shortcut")} title={t("shortcut")}>
                          {" ↗"}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <span className={listStyles.unavailable} data-ui="ChildListDialog.unavailableShortcut" data-id={item.id}>
                      {label(item)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className={styles.actions}>
          <button type="button" className={ui.buttonSecondary} data-ui="ChildListDialog.closeButton" onClick={onClose}>
            {tc("close")}
          </button>
        </div>
      </div>
    </dialog>
  );
}

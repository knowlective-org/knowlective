"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { type PickableGroup, loadPickablePages } from "@/app/(app)/page-picker-actions";
import ui from "@/styles/ui.module.css";
import styles from "./dialog.module.css";

// Choosing a page the user can see: a filter by title, then the pages per
// knowledge root (those not of the kind asked for are shown greyed, for where
// they are). For a whiteboard item's link and a document's whiteboard block.
export function PagePickerDialog({
  title,
  lead,
  kind,
  exclude = null,
  onPick,
  onClose,
}: {
  title: string;
  lead: string;
  kind: "any" | "whiteboard";
  exclude?: string | null;
  onPick: (pageId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("pagePicker");
  const tc = useTranslations("common");
  const ref = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState<PickableGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState("");

  useEffect(() => {
    ref.current?.showModal();
    loadPickablePages(kind, exclude)
      .then(setGroups)
      .catch(() => setFailed(true));
  }, [kind, exclude]);

  // Filtered: the matching pages alone, without the tree's indentation.
  const q = query.normalize("NFKC").toLowerCase().trim();
  const shown = (groups ?? [])
    .map((g) => ({
      ...g,
      pages: q ? g.pages.filter((p) => p.selectable && p.title.normalize("NFKC").toLowerCase().includes(q)) : g.pages,
    }))
    .filter((g) => g.pages.length > 0);
  const any = groups?.some((g) => g.pages.some((p) => p.selectable)) ?? false;

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-ui="PagePickerDialog"
      aria-labelledby="page-picker-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      // Inside a document's block: keys and clicks are the dialog's, not the editor's.
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          if (!chosen) return;
          onPick(chosen);
          onClose();
        }}
      >
        <h2 id="page-picker-title" className={styles.title}>
          {title}
        </h2>
        <p className={ui.note}>{lead}</p>
        {failed ? (
          <p className={ui.error} data-ui="PagePickerDialog.error">
            {t("loadFailed")}
          </p>
        ) : groups === null ? (
          <p className={ui.note} data-ui="PagePickerDialog.status">
            {t("loading")}
          </p>
        ) : !any ? (
          <p className={ui.note} data-ui="PagePickerDialog.status">
            {kind === "whiteboard" ? t("noWhiteboards") : t("noPages")}
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
              data-ui="PagePickerDialog.filterInput"
            />
            <select
              className={ui.field}
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              onDoubleClick={() => {
                if (!chosen) return;
                onPick(chosen);
                onClose();
              }}
              aria-label={title}
              required
              size={12}
              data-ui="PagePickerDialog.pageSelect"
            >
              {shown.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.pages.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.selectable}>
                      {q ? "" : "　".repeat(p.depth)}
                      {p.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </>
        )}
        <div className={styles.actions}>
          <button type="button" className={ui.buttonSecondary} data-ui="PagePickerDialog.cancelButton" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button type="submit" className={ui.button} data-ui="PagePickerDialog.submitButton" disabled={!chosen}>
            {t("choose")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

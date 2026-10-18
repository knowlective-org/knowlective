"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { type MoveDestinationGroup, loadMoveDestinations } from "@/app/(app)/page-move-actions";
import { useTranslations } from "next-intl";
import { useConfirmAndMovePage } from "@/components/move-page";
import ui from "@/styles/ui.module.css";
import styles from "@/components/dialog.module.css";

// The page menu's "move": pick a new parent from every page the user can see
// (any knowledge root). The page goes last among its new siblings; the
// order can then be changed by dragging in the sidebar.
export function MoveDialog({ pageId, title, onClose }: { pageId: string; title: string; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState<MoveDestinationGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parentId, setParentId] = useState("");
  const [moving, startMoving] = useTransition();
  const t = useTranslations("moveDialog");
  const tc = useTranslations("common");
  const confirmAndMovePage = useConfirmAndMovePage();

  useEffect(() => {
    ref.current?.showModal();
    loadMoveDestinations(pageId)
      .then((result) => ("error" in result ? setError(result.error) : setGroups(result)))
      .catch(() => setError(t("loadFailed")));
  }, [pageId]);

  const move = () =>
    startMoving(async () => {
      if (!parentId) return;
      if (!(await confirmAndMovePage({ pageId, title, parentId, beforeId: null }))) return;
      onClose();
      router.refresh();
    });

  const hasChoice = groups?.some((g) => g.pages.some((p) => p.selectable && !p.current)) ?? false;

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-ui="MoveDialog"
      aria-labelledby="move-dialog-title"
      // Esc, or a click on the backdrop.
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          move();
        }}
      >
        <h2 id="move-dialog-title" className={styles.title}>
          {t("title")}
        </h2>
        <p className={ui.note}>
          {t("lead")}
        </p>
        {error ? (
          <p className={ui.error} data-ui="MoveDialog.error">
            {error}
          </p>
        ) : groups === null ? (
          <p className={ui.note} data-ui="MoveDialog.status">
            {t("loading")}
          </p>
        ) : !hasChoice ? (
          <p className={ui.note} data-ui="MoveDialog.status">
            {t("nowhere")}
          </p>
        ) : (
          <label>
            {t("destination")}
            <select
              className={ui.field}
              data-ui="MoveDialog.parentSelect"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              required
              size={12}
            >
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.pages.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.selectable || p.current}>
                      {"　".repeat(p.depth)}
                      {p.title}
                      {p.current ? t("current") : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        <div className={styles.actions}>
          <button type="button" className={ui.buttonSecondary} data-ui="MoveDialog.cancelButton" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button
            type="submit"
            className={ui.button}
            data-ui="MoveDialog.submitButton"
            disabled={!parentId || moving}
          >
            {moving ? t("moving") : t("move")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

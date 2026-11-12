"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  type MoveDestination,
  type MoveDestinationGroup,
  createPageShortcut,
  loadMoveDestinations,
} from "@/app/(app)/page-move-actions";
import { showAlert } from "@/components/dialog";
import { useTranslations } from "next-intl";
import { useConfirmAndMovePage } from "@/components/move-page";
import ui from "@/styles/ui.module.css";
import styles from "@/components/dialog.module.css";

// The page menu's "move": pick a new parent from every page the user can see
// (any knowledge root). The page goes last among its new siblings; the
// order can then be changed by dragging in the sidebar.
// With `shortcut`, the page menu's "create a shortcut": the same choice, of
// where a shortcut to the page goes (lib/shortcuts.ts).
export function MoveDialog({
  pageId,
  title,
  shortcut = false,
  onClose,
}: {
  pageId: string;
  title: string;
  shortcut?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState<MoveDestinationGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parentId, setParentId] = useState("");
  const [query, setQuery] = useState("");
  const [moving, startMoving] = useTransition();
  const tm = useTranslations("moveDialog");
  const ts = useTranslations("shortcutDialog");
  // The words that differ between the two purposes.
  const t = (key: "loadFailed" | "title" | "lead" | "nowhere" | "destination" | "moving" | "move") =>
    shortcut ? ts(key) : tm(key);
  const tc = useTranslations("common");
  const confirmAndMovePage = useConfirmAndMovePage();

  useEffect(() => {
    ref.current?.showModal();
    loadMoveDestinations(pageId, shortcut ? "shortcut" : "move")
      .then((result) => ("error" in result ? setError(result.error) : setGroups(result)))
      .catch(() => setError(t("loadFailed")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, shortcut]);

  const move = () =>
    startMoving(async () => {
      if (!parentId) return;
      if (shortcut) {
        const result = await createPageShortcut(pageId, parentId).catch(() => ({ error: ts("failed") }));
        if (result.error) return void (await showAlert(result.error, { title: ts("cannotCreate") }));
        // The parent, with the shortcut under it.
        onClose();
        router.push(`/pages/${parentId}`);
        router.refresh();
        return;
      }
      if (!(await confirmAndMovePage({ pageId, title, parentId, beforeId: null }))) return;
      onClose();
      router.refresh();
    });

  const hasChoice = groups?.some((g) => g.pages.some((p) => p.selectable && !p.current)) ?? false;

  // Filtered by title: the matching pages alone, each after the titles of
  // the pages above it (several pages may have the same title).
  const q = query.normalize("NFKC").toLowerCase().trim();
  const shown = (groups ?? [])
    .map((g) => {
      if (!q) return { ...g, pages: g.pages.map((p) => ({ ...p, path: "" })) };
      const above: string[] = [];
      const pages: (MoveDestination & { path: string })[] = [];
      for (const p of g.pages) {
        above.length = p.depth;
        if (p.title.normalize("NFKC").toLowerCase().includes(q)) {
          pages.push({ ...p, path: above.length ? `${above.join(" / ")} / ` : "" });
        }
        above.push(p.title);
      }
      return { ...g, pages };
    })
    .filter((g) => g.pages.length > 0);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-ui="MoveDialog"
      data-purpose={shortcut ? "shortcut" : "move"}
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
            {tm("loading")}
          </p>
        ) : !hasChoice ? (
          <p className={ui.note} data-ui="MoveDialog.status">
            {t("nowhere")}
          </p>
        ) : (
          <>
            <input
              type="search"
              className={ui.field}
              value={query}
              placeholder={tm("filter")}
              aria-label={tm("filter")}
              onChange={(e) => setQuery(e.target.value)}
              data-ui="MoveDialog.filterInput"
            />
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
                {shown.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.pages.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.selectable || p.current}>
                        {q ? p.path : "　".repeat(p.depth)}
                        {p.title}
                        {p.current ? tm("current") : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {q && shown.length === 0 && (
              <p className={ui.note} data-ui="MoveDialog.noMatchStatus">
                {tm("noMatch")}
              </p>
            )}
          </>
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

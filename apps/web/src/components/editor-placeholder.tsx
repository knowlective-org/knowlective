"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";
import styles from "./collaborative-editor.module.css";
import { LoadingOverlay } from "./loading-overlay";

// The page's title as of the last save (Page.title), known before the editor
// loads. Lets the loading state show it instead of an empty title, which
// would read as "untitled" until the collab document syncs.
export const InitialTitleContext = createContext("");

// Stands in for the title + editor until the document has synced. Same box
// as the title field, so nothing shifts when the editor replaces it.
// `reload`: the label of a button that reloads the screen.
export function EditorPlaceholder({ message: given, reload }: { message?: string; reload?: string }) {
  const title = useContext(InitialTitleContext);
  const t = useTranslations("editorPlaceholder");
  const message = given ?? t("loading");
  return (
    <div data-ui="EditorPlaceholder" aria-busy="true">
      {/* Still loading (not a failure): the whole screen says so until the document is in. */}
      {given === undefined && <LoadingOverlay />}
      <div className={title ? styles.title : styles.titleLoading}>{title || message}</div>
      {title && <p className={styles.loading}>{message}</p>}
      {reload && (
        <button type="button" className={styles.reload} data-ui="EditorPlaceholder.reloadButton" onClick={() => window.location.reload()}>
          {reload}
        </button>
      )}
    </div>
  );
}

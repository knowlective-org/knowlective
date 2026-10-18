"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";
import styles from "./collaborative-editor.module.css";

// The page's title as of the last save (Page.title), known before the editor
// loads. Lets the loading state show it instead of an empty title, which
// would read as "untitled" until the collab document syncs.
export const InitialTitleContext = createContext("");

// Stands in for the title + editor until the document has synced. Same box
// as the title field, so nothing shifts when the editor replaces it.
export function EditorPlaceholder({ message: given }: { message?: string }) {
  const title = useContext(InitialTitleContext);
  const t = useTranslations("editorPlaceholder");
  const message = given ?? t("loading");
  return (
    <div data-ui="EditorPlaceholder" aria-busy="true">
      <div className={title ? styles.title : styles.titleLoading}>{title || message}</div>
      {title && <p className={styles.loading}>{message}</p>}
    </div>
  );
}

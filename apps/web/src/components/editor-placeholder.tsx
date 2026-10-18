"use client";

import { createContext, useContext } from "react";
import styles from "./collaborative-editor.module.css";

// The page's title as of the last save (Page.title), known before the editor
// loads. Lets the loading state show it instead of an empty title, which
// would read as "untitled" until the collab document syncs.
export const InitialTitleContext = createContext("");

// Stands in for the title + editor until the document has synced. Same box
// as the title field, so nothing shifts when the editor replaces it.
export function EditorPlaceholder({ message = "読み込み中…" }: { message?: string }) {
  const title = useContext(InitialTitleContext);
  return (
    <div data-ui="EditorPlaceholder" aria-busy="true">
      <div className={title ? styles.title : styles.titleLoading}>{title || message}</div>
      {title && <p className={styles.loading}>{message}</p>}
    </div>
  );
}

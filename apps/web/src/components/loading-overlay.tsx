"use client";

import { useTranslations } from "next-intl";
import styles from "./loading-overlay.module.css";

// Covers the whole screen while a page's data is read (the route's
// loading.tsx: the server reading the page, its access and the sidebar; the
// editor's placeholder: the document syncing from the collab server). It
// fades in only after a moment, so a quick load doesn't flash, and takes the
// clicks meanwhile, so nothing on the screen underneath is used half-loaded.
export function LoadingOverlay() {
  const t = useTranslations("editorPlaceholder");
  return (
    <div className={styles.overlay} role="status" aria-live="polite" data-ui="LoadingOverlay">
      <div className={styles.box}>
        <span className={styles.spinner} aria-hidden />
        <span>{t("loading")}</span>
      </div>
    </div>
  );
}

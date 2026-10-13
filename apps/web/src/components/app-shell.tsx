"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useId, useState } from "react";
import styles from "./app-shell.module.css";

// Two-pane app layout: sticky sidebar on the left, content on the right.
//
// On a narrow screen (under 600px) the sidebar is out of the way: a menu
// button at the top left slides it in over the content, and it goes away
// again when a link in it is followed, the backdrop is tapped or Esc is
// pressed. (The switch is in the CSS; the button and backdrop don't show on
// wider screens.)
export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  // The path the drawer was opened on: going anywhere else closes it without
  // an effect having to notice the navigation.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const close = () => setOpenedOn(null);
  const sidebarId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenedOn(null);
    };
    // The page behind the drawer stays put while it's open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.layout} data-ui="AppShell">
      <button
        type="button"
        className={styles.menuButton}
        data-ui="AppShell.menuButton"
        aria-label="メニューを開く"
        aria-expanded={open}
        aria-controls={sidebarId}
        onClick={() => setOpenedOn(pathname)}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
          <path d="M3 5h14M3 10h14M3 15h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open && <div className={styles.backdrop} data-ui="AppShell.backdrop" onClick={close} />}
      <aside id={sidebarId} className={styles.sidebar} data-ui="AppShell.sidebar" data-open={open || undefined}>
        <button
          type="button"
          className={styles.closeButton}
          data-ui="AppShell.closeButton"
          aria-label="メニューを閉じる"
          onClick={close}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
            <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        {sidebar}
      </aside>
      <main className={styles.main} data-ui="AppShell.main">
        {children}
      </main>
    </div>
  );
}

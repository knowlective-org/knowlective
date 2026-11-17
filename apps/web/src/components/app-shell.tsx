"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useState, useSyncExternalStore } from "react";
import styles from "./app-shell.module.css";
import { SIDEBAR_HIDDEN_KEY as HIDDEN_KEY } from "@/lib/sidebar-hidden";

const isHidden = () => document.documentElement.dataset.sidebar === "hidden";
function watchHidden(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sidebar"] });
  return () => observer.disconnect();
}

function setHidden(hidden: boolean) {
  if (hidden) document.documentElement.dataset.sidebar = "hidden";
  else delete document.documentElement.dataset.sidebar;
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, "1");
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Private mode and the like: just for this page.
  }
}

// Two-pane app layout: sticky sidebar on the left, content on the right.
//
// On a narrow screen (under 600px) the sidebar is out of the way: a menu
// button at the top left slides it in over the content, and it goes away
// again when a link in it is followed, the backdrop is tapped or Esc is
// pressed. (The switch is in the CSS; the button and backdrop don't show on
// wider screens.)
//
// On wider screens the sidebar can be hidden altogether (its button at its
// top right) and shown again (a button at the top left). Remembered per
// browser (localStorage), and set on <html> (data-sidebar="hidden") by a
// script in the root layout before the page is drawn (lib/sidebar-hidden.ts),
// so a hidden sidebar doesn't flash in.
export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations("appShell");
  // The path the drawer was opened on: going anywhere else closes it without
  // an effect having to notice the navigation.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const close = () => setOpenedOn(null);
  const sidebarId = useId();
  // Hidden on a wide screen (the state is the <html> attribute; this follows it).
  const hidden = useSyncExternalStore(watchHidden, isHidden, () => false);
  const hide = setHidden;

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
        className={styles.showButton}
        data-ui="AppShell.showSidebarButton"
        aria-label={t("showSidebar")}
        title={t("showSidebar")}
        aria-expanded={!hidden}
        aria-controls={sidebarId}
        onClick={() => hide(false)}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
          <rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M7.5 3.5v13M10.5 8l2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.menuButton}
        data-ui="AppShell.menuButton"
        aria-label={t("openMenu")}
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
          aria-label={t("closeMenu")}
          onClick={close}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
            <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.hideButton}
          data-ui="AppShell.hideSidebarButton"
          aria-label={t("hideSidebar")}
          title={t("hideSidebar")}
          aria-expanded={!hidden}
          aria-controls={sidebarId}
          onClick={() => hide(true)}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
            <rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M7.5 3.5v13M13 8l-2 2 2 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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

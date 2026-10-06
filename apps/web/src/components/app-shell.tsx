import type { ReactNode } from "react";
import styles from "./app-shell.module.css";

// Two-pane app layout: sticky sidebar on the left, content on the right.
export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.layout} data-ui="AppShell">
      <aside className={styles.sidebar} data-ui="AppShell.sidebar">
        {sidebar}
      </aside>
      <main className={styles.main} data-ui="AppShell.main">
        {children}
      </main>
    </div>
  );
}

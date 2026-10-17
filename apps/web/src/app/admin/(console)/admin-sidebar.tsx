"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/components/sidebar.module.css";
import { logout } from "./actions";

export type AdminNavItem = { href: string; label: string };

// Left pane of the admin console: the menu (already filtered by role in the
// layout) and the signed-in admin. Same look as the app's page sidebar.
export function AdminSidebar({
  items,
  actor,
  sourceUrl,
}: {
  items: AdminNavItem[];
  actor: string;
  // Source code of this instance (AGPL-3.0; lib/source.ts).
  sourceUrl: string;
}) {
  const pathname = usePathname();
  // "/admin" is only current on itself; the others also cover their subpages.
  const isCurrent = (href: string) =>
    href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={styles.sidebar} data-ui="AdminSidebar">
      <div className={styles.brand}>KNOWLECTIVE 管理画面</div>
      <nav className={styles.nav} data-ui="AdminSidebar.nav">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isCurrent(item.href) ? styles.navItemCurrent : styles.navItem}
            aria-current={isCurrent(item.href) ? "page" : undefined}
            data-ui="AdminSidebar.navLink"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className={styles.footer}>
        <span className={styles.user} title={actor}>
          {actor}
        </span>
        <Link href="/" className={styles.footerLink} data-ui="AdminSidebar.appLink">
          アプリに戻る
        </Link>
        <form action={logout}>
          <button type="submit" className={styles.footerLink} data-ui="AdminSidebar.logoutButton">
            ログアウト
          </button>
        </form>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.footerLink}
          title="KNOWLECTIVE は AGPL-3.0 で公開されています"
          data-ui="AdminSidebar.sourceLink"
        >
          ソースコード（AGPL-3.0）
        </a>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/components/sidebar.module.css";
import { logout } from "./actions";

export type AdminNavItem = { href: string; label: string };

// Left pane of the admin console: the menu (already filtered by role in the
// layout) and the signed-in admin. Same look as the app's page sidebar.
export function AdminSidebar({ items, actor }: { items: AdminNavItem[]; actor: string }) {
  const pathname = usePathname();
  // "/admin" is only current on itself; the others also cover their subpages.
  const isCurrent = (href: string) =>
    href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={styles.sidebar} data-ui="AdminSidebar">
      <div className={styles.brand}>yosuga 管理画面</div>
      <nav className={styles.scroll} data-ui="AdminSidebar.nav">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isCurrent(item.href) ? styles.actionCurrent : styles.action}
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
      </div>
    </div>
  );
}

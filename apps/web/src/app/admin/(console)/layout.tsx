import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { SITE_ROLE_LABELS } from "@/lib/roles";
import styles from "@/styles/ui.module.css";
import { logout } from "./actions";

export const metadata: Metadata = {
  title: "管理画面 | yosuga",
  robots: { index: false, follow: false },
};

// Content managers only see users (invitations) and groups.
const NAV: { href: string; label: string; siteAdminOnly?: boolean }[] = [
  { href: "/admin", label: "概要", siteAdminOnly: true },
  { href: "/admin/users", label: "ユーザー" },
  { href: "/admin/groups", label: "グループ" },
  { href: "/admin/security", label: "セキュリティ", siteAdminOnly: true },
];

// Navigation chrome only. Not a security boundary: every page and Server
// Action calls requireAdmin() itself.
export default async function AdminConsoleLayout({ children }: LayoutProps<"/admin">) {
  const { actorLabel, role } = await requireAdmin();
  return (
    <main className={styles.wide}>
      <header className={styles.header}>
        <h1 className={styles.title} style={{ margin: 0 }}>
          管理画面
        </h1>
        <form action={logout} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className={styles.note}>
            {actorLabel}（{SITE_ROLE_LABELS[role]}）
          </span>
          <button type="submit" className={styles.button}>
            ログアウト
          </button>
        </form>
      </header>
      <nav className={styles.nav}>
        {NAV.filter((item) => role === "SITE_ADMIN" || !item.siteAdminOnly).map((item) => (
          <Link key={item.href} href={item.href} className={styles.navLink}>
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}

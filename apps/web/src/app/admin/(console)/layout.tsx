import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/admin/auth";
import { SITE_ROLE_LABELS } from "@/lib/roles";
import { getSourceUrl } from "@/lib/source";
import styles from "@/styles/ui.module.css";
import { AdminSidebar, type AdminNavItem } from "./admin-sidebar";

export const metadata: Metadata = {
  title: "管理画面 | yosuga",
  robots: { index: false, follow: false },
};

// Content managers only see users (invitations) and groups.
const NAV: (AdminNavItem & { siteAdminOnly?: boolean })[] = [
  { href: "/admin", label: "概要", siteAdminOnly: true },
  { href: "/admin/users", label: "ユーザー" },
  { href: "/admin/groups", label: "グループ" },
  { href: "/admin/security", label: "セキュリティ", siteAdminOnly: true },
];

// Navigation chrome only. Not a security boundary: every page and Server
// Action calls requireAdmin() itself.
export default async function AdminConsoleLayout({ children }: LayoutProps<"/admin">) {
  const { actorLabel, role } = await requireAdmin();
  const items = NAV.filter((item) => role === "SITE_ADMIN" || !item.siteAdminOnly).map(({ href, label }) => ({
    href,
    label,
  }));
  return (
    <AppShell sidebar={<AdminSidebar items={items} actor={`${actorLabel}（${SITE_ROLE_LABELS[role]}）`} sourceUrl={getSourceUrl()} />}>
      <div className={`${styles.pane} ${styles.adminPane}`} data-ui="AdminConsoleLayout">
        {children}
      </div>
    </AppShell>
  );
}

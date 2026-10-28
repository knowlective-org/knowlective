import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/admin/auth";
import { getBrand } from "@/lib/brand";
import { getBuildInfo, versionLabel } from "@/lib/build-info";
import { getSourceUrl } from "@/lib/source";
import styles from "@/styles/ui.module.css";
import { AdminSidebar, type AdminNavItem } from "./admin-sidebar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("meta.titleSuffix", { title: t("admin.title") }), robots: { index: false, follow: false } };
}

// Content managers only see users (invitations) and groups. Labels: admin.shell.nav.
const NAV: { href: string; key: "overview" | "users" | "groups" | "files" | "security" | "about"; siteAdminOnly?: boolean }[] = [
  { href: "/admin", key: "overview", siteAdminOnly: true },
  { href: "/admin/users", key: "users" },
  { href: "/admin/groups", key: "groups" },
  { href: "/admin/files", key: "files", siteAdminOnly: true },
  { href: "/admin/security", key: "security", siteAdminOnly: true },
  { href: "/admin/about", key: "about", siteAdminOnly: true },
];

// Navigation chrome only. Not a security boundary: every page and Server
// Action calls requireAdmin() itself.
export default async function AdminConsoleLayout({ children }: LayoutProps<"/admin">) {
  const { actorLabel, role } = await requireAdmin();
  const [t, brand] = await Promise.all([getTranslations(), getBrand()]);
  const items: AdminNavItem[] = NAV.filter((item) => role === "SITE_ADMIN" || !item.siteAdminOnly).map(({ href, key }) => ({
    href,
    label: t(`admin.shell.nav.${key}`),
  }));
  return (
    <AppShell sidebar={<AdminSidebar
          items={items}
          brand={brand}
          actor={`${actorLabel} (${t(`roles.${role}`)})`}
          sourceUrl={getSourceUrl()}
          version={versionLabel(getBuildInfo())}
        />}>
      <div className={`${styles.pane} ${styles.adminPane}`} data-ui="AdminConsoleLayout">
        {children}
      </div>
    </AppShell>
  );
}

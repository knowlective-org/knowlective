"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Brand } from "@/components/brand";
import styles from "@/components/sidebar.module.css";
import type { Brand as BrandSettings } from "@/lib/brand";
import { logout } from "./actions";

export type AdminNavItem = { href: string; label: string };

// Left pane of the admin console: the menu (already filtered by role in the
// layout) and the signed-in admin. Same look as the app's page sidebar.
export function AdminSidebar({
  items,
  brand,
  actor,
  sourceUrl,
  version,
}: {
  // The site's name or logo, as in the app's sidebar.
  brand: BrandSettings;
  items: AdminNavItem[];
  actor: string;
  // Source code of this instance (AGPL-3.0; lib/source.ts).
  sourceUrl: string;
  // This KNOWLECTIVE's version and commit (lib/build-info.ts).
  version: string;
}) {
  const pathname = usePathname();
  const t = useTranslations("admin.shell");
  // "/admin" is only current on itself; the others also cover their subpages.
  const isCurrent = (href: string) =>
    href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={styles.sidebar} data-ui="AdminSidebar">
      <Brand brand={brand} suffix={t("brandSuffix")} />
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
          {t("backToApp")}
        </Link>
        <form action={logout}>
          <button type="submit" className={styles.footerLink} data-ui="AdminSidebar.logoutButton">
            {t("logout")}
          </button>
        </form>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.footerLink}
          title={t("sourceTitle")}
          data-ui="AdminSidebar.sourceLink"
        >
          {t("source")}
        </a>
        <span className={styles.user} title={version} data-ui="AdminSidebar.version">
          KNOWLECTIVE {version}
        </span>
      </div>
    </div>
  );
}

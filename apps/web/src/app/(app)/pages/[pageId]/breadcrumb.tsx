"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { SidebarTree } from "@/components/sidebar";
import { useDisplayTitle } from "@/i18n/use-display-title";
import styles from "./breadcrumb.module.css";

// Up to this many pages are shown as they are; a longer path shows the
// knowledge root, "…", the page's parent and the page.
const MAX_SHOWN = 3;

type Crumb = { id: string; title: string };

// The pages from the top of the page's tree down to the page, as far up as
// the viewer can see: a parent they can't open ends the path there (its
// title, and the knowledge root's name, must not be shown to them).
// Built from the sidebar's data, which only holds pages the viewer can open.
export function pathTo(trees: SidebarTree[], pageId: string): Crumb[] {
  const tree = trees.find((t) => t.pages.some((p) => p.id === pageId));
  if (!tree) return [];
  const byId = new Map(tree.pages.map((p) => [p.id, p]));
  const path: Crumb[] = [];
  for (let page = byId.get(pageId); page && path.length <= 64; page = page.parentId ? byId.get(page.parentId) : undefined) {
    path.unshift({ id: page.id, title: page.title });
  }
  return path;
}

export function Breadcrumb({
  trees,
  pageId,
  currentTitle,
}: {
  trees: SidebarTree[];
  pageId: string;
  // The open page's title as it's being typed.
  currentTitle?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations("breadcrumb");
  const displayTitle = useDisplayTitle();
  const path = pathTo(trees, pageId);
  if (path.length === 0) return null;

  const folded = !expanded && path.length > MAX_SHOWN;
  // Folded: the top, "…", the parent and the page.
  const shown: (Crumb | "more")[] = folded ? [path[0], "more", ...path.slice(-2)] : path;
  const hidden = folded ? path.slice(1, -2) : [];

  return (
    <nav className={styles.breadcrumb} aria-label={t("label")} data-ui="Breadcrumb">
      <ol className={styles.list}>
        {shown.map((crumb, i) => {
          const last = i === shown.length - 1;
          return (
            <li key={crumb === "more" ? "more" : crumb.id} className={styles.item}>
              {crumb === "more" ? (
                <button
                  type="button"
                  className={styles.more}
                  data-ui="Breadcrumb.expandButton"
                  // The folded pages, for a glance without opening them.
                  title={hidden.map((c) => displayTitle(c.title)).join(" / ")}
                  aria-label={t("showHidden", { count: hidden.length })}
                  onClick={() => setExpanded(true)}
                >
                  …
                </button>
              ) : last ? (
                <span className={styles.current} aria-current="page" data-ui="Breadcrumb.current">
                  {displayTitle(currentTitle ?? crumb.title)}
                </span>
              ) : (
                <Link href={`/pages/${crumb.id}`} className={styles.link} data-ui="Breadcrumb.link" data-id={crumb.id}>
                  {displayTitle(crumb.title)}
                </Link>
              )}
              {!last && (
                <span className={styles.separator} aria-hidden>
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

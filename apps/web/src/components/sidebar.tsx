"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/(app)/actions";
import { DocTree, type DocTreeNode } from "./doc-tree";
import styles from "./sidebar.module.css";

export type SidebarTree = {
  rootId: string;
  rootPageId: string | null;
  pages: DocTreeNode[];
  entryIds: string[];
};

// App-wide navigation: every knowledge root the user can see (as its root
// page), then subtrees shared without their parent, then account links.
// Only the tree containing the open page starts expanded.
export function Sidebar({
  trees,
  currentPageId,
  currentTitle,
  maxDepth,
  userName,
  canCreateRoot,
  canOpenAdmin,
  searchQuery = "",
}: {
  trees: SidebarTree[];
  currentPageId: string | null;
  currentTitle?: string;
  maxDepth: number;
  userName: string;
  canCreateRoot: boolean;
  canOpenAdmin: boolean;
  // Prefills the search box (on the search screen).
  searchQuery?: string;
}) {
  const pathname = usePathname();
  const rootTrees = trees.filter((t) => t.rootPageId && t.entryIds.includes(t.rootPageId));
  // Entry pages other than a visible root page: shared without their parent.
  const shared = trees
    .map((t) => ({ ...t, entryIds: t.entryIds.filter((id) => id !== t.rootPageId) }))
    .filter((t) => t.entryIds.length > 0);

  return (
    <div className={styles.sidebar}>
      <div className={styles.brand}>YOSUGA</div>
      {/* A plain GET form, so it works before hydration too. */}
      <form action="/search" role="search" className={styles.search} data-ui="Sidebar.searchForm">
        <input
          type="search"
          name="q"
          defaultValue={searchQuery}
          maxLength={100}
          placeholder="検索"
          aria-label="ページを検索"
          className={styles.searchInput}
          data-ui="Sidebar.searchInput"
        />
      </form>

      <div className={styles.scroll}>
        {/* At the top so it stays reachable however many roots are listed. */}
        {canCreateRoot && (
          <Link href="/roots/new" className={pathname === "/roots/new" ? styles.actionCurrent : styles.action}>
            ＋ 新しいナレッジルート
          </Link>
        )}
        {rootTrees.length === 0 && shared.length === 0 && (
          <p className={styles.empty}>見られるページはまだありません。</p>
        )}
        {rootTrees.map((t) => (
          <DocTree
            key={t.rootId}
            nodes={t.pages}
            entryIds={[t.rootPageId!]}
            currentPageId={currentPageId}
            currentTitle={currentTitle}
            maxDepth={maxDepth}
          />
        ))}
        {shared.length > 0 && (
          <>
            <div className={styles.sectionLabel}>共有されたページ</div>
            {shared.map((t) => (
              <DocTree
                key={`shared-${t.rootId}`}
                nodes={t.pages}
                entryIds={t.entryIds}
                currentPageId={currentPageId}
                currentTitle={currentTitle}
                maxDepth={maxDepth}
              />
            ))}
          </>
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.user} title={userName}>
          {userName}
        </span>
        <Link href="/trash" className={styles.footerLink} data-ui="Sidebar.trashLink">
          ごみ箱
        </Link>
        {canOpenAdmin && (
          <Link href="/admin" className={styles.footerLink}>
            管理画面
          </Link>
        )}
        <form action={logout}>
          <button type="submit" className={styles.footerLink}>
            ログアウト
          </button>
        </form>
      </div>
    </div>
  );
}

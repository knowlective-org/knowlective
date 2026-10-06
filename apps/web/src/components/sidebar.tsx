"use client";

import Link from "next/link";
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
}: {
  trees: SidebarTree[];
  currentPageId: string | null;
  currentTitle?: string;
  maxDepth: number;
  userName: string;
  canCreateRoot: boolean;
  canOpenAdmin: boolean;
}) {
  const rootTrees = trees.filter((t) => t.rootPageId && t.entryIds.includes(t.rootPageId));
  // Entry pages other than a visible root page: shared without their parent.
  const shared = trees
    .map((t) => ({ ...t, entryIds: t.entryIds.filter((id) => id !== t.rootPageId) }))
    .filter((t) => t.entryIds.length > 0);

  return (
    <div className={styles.sidebar}>
      <div className={styles.brand}>yosuga</div>

      <div className={styles.scroll}>
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
        {canCreateRoot && (
          <Link href="/roots/new" className={styles.action}>
            ＋ 新しいナレッジルート
          </Link>
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.user} title={userName}>
          {userName}
        </span>
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

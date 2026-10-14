"use client";

import Link from "next/link";
import { withBasePath } from "@/lib/base-path";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { logout, saveRootOrder } from "@/app/(app)/actions";
import { showAlert } from "./dialog";
import { DocTree, type DocTreeNode } from "./doc-tree";
import styles from "./sidebar.module.css";

// Height of a tree row: a drop in the top half of a root's own row puts the
// dragged root before it.
const ROOT_ROW_HEIGHT = 32;

const rank = (order: string[], id: string) => {
  const i = order.indexOf(id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

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
  const router = useRouter();
  const listed = trees.filter((t) => t.rootPageId && t.entryIds.includes(t.rootPageId));
  // Knowledge root order: this user's own (User.rootOrder), changed by
  // dragging a root's row. Shown at once, then saved; the next data from the
  // server has it too.
  const [order, setOrder] = useState<string[] | null>(null);
  const [draggedRoot, setDraggedRoot] = useState<string | null>(null);
  const [rootDrop, setRootDrop] = useState<{ id: string; after: boolean } | null>(null);
  const rootTrees = order
    ? [...listed].sort((a, b) => rank(order, a.rootId) - rank(order, b.rootId))
    : listed;
  const reorderable = rootTrees.length > 1;

  const saveOrder = async (next: string[]) => {
    const previous = order;
    setOrder(next);
    const result = await saveRootOrder(next).catch(() => ({ error: "保存に失敗しました。" }));
    if (result.error) {
      setOrder(previous);
      await showAlert(result.error);
      return;
    }
    router.refresh();
  };
  // `id` placed before the root now at `beforeIndex` (the list's length = last).
  const moveRoot = (id: string, beforeIndex: number) => {
    const ids = rootTrees.map((t) => t.rootId);
    const from = ids.indexOf(id);
    const next = ids.filter((x) => x !== id);
    next.splice(beforeIndex > from ? beforeIndex - 1 : beforeIndex, 0, id);
    if (next.join() !== ids.join()) void saveOrder(next);
  };
  const endRootDrag = () => {
    setDraggedRoot(null);
    setRootDrop(null);
  };
  // Entry pages other than a visible root page: shared without their parent.
  const shared = trees
    .map((t) => ({ ...t, entryIds: t.entryIds.filter((id) => id !== t.rootPageId) }))
    .filter((t) => t.entryIds.length > 0);

  return (
    <div className={styles.sidebar}>
      <div className={styles.brand}>YOSUGA</div>
      {/* A plain GET form, so it works before hydration too. */}
      <form action={withBasePath("/search")} role="search" className={styles.search} data-ui="Sidebar.searchForm">
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
        {rootTrees.map((t, i) => (
          // Drop target for a root being reordered: the upper half of its
          // own row puts it before this one, anywhere lower after. (A page
          // being moved is handled by the DocTree inside and passes by.)
          <div
            key={t.rootId}
            className={
              rootDrop?.id === t.rootId && draggedRoot !== t.rootId
                ? rootDrop.after
                  ? styles.rootDropAfter
                  : styles.rootDropBefore
                : undefined
            }
            data-ui="Sidebar.root"
            data-id={t.rootId}
            onDragOver={(e) => {
              if (!draggedRoot) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const box = e.currentTarget.getBoundingClientRect();
              const after = e.clientY > box.top + Math.min(box.height, ROOT_ROW_HEIGHT) / 2;
              if (rootDrop?.id !== t.rootId || rootDrop.after !== after) setRootDrop({ id: t.rootId, after });
            }}
            onDrop={(e) => {
              if (!draggedRoot) return;
              e.preventDefault();
              if (rootDrop) moveRoot(draggedRoot, i + (rootDrop.after ? 1 : 0));
              endRootDrag();
            }}
          >
            <DocTree
              nodes={t.pages}
              entryIds={[t.rootPageId!]}
              currentPageId={currentPageId}
              currentTitle={currentTitle}
              maxDepth={maxDepth}
              rootReorder={
                reorderable
                  ? {
                      onDragStart: () => setDraggedRoot(t.rootId),
                      onDragEnd: endRootDrag,
                      onKeyMove: (by) => {
                        if (i + by >= 0 && i + by < rootTrees.length) moveRoot(t.rootId, by < 0 ? i - 1 : i + 2);
                      },
                    }
                  : undefined
              }
            />
          </div>
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
        <Link href="/account" className={styles.footerLink} data-ui="Sidebar.accountLink">
          アカウント
        </Link>
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

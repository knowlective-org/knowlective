"use client";

import Link from "next/link";
import { withBasePath } from "@/lib/base-path";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { logout, saveRootOrder } from "@/app/(app)/actions";
import { showAlert } from "./dialog";
import { DocTree, type DocTreeNode } from "./doc-tree";
import { AccountIcon, AdminIcon, LoginIcon, LogoutIcon, TrashIcon } from "./sidebar-icons";
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
  // The user's own personal knowledge root.
  personal: boolean;
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
  guest = false,
  searchQuery = "",
}: {
  trees: SidebarTree[];
  currentPageId: string | null;
  currentTitle?: string;
  maxDepth: number;
  userName: string;
  canCreateRoot: boolean;
  canOpenAdmin: boolean;
  // Someone not logged in, viewing public pages: no search, no account links.
  guest?: boolean;
  // Prefills the search box (on the search screen).
  searchQuery?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const tr = useTranslations("sidebar");
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
  // The order is saved per user: not for someone not logged in.
  const reorderable = rootTrees.length > 1 && !guest;

  const saveOrder = async (next: string[]) => {
    const previous = order;
    setOrder(next);
    const result = await saveRootOrder(next).catch(() => ({ error: tr("saveFailed") }));
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
      <div className={styles.brand}>KNOWLECTIVE</div>
      {/* A plain GET form, so it works before hydration too. */}
      {!guest && (
      <form action={withBasePath("/search")} role="search" className={styles.search} data-ui="Sidebar.searchForm">
        <input
          type="search"
          name="q"
          defaultValue={searchQuery}
          maxLength={100}
          placeholder={tr("search")}
          aria-label={tr("searchLabel")}
          className={styles.searchInput}
          data-ui="Sidebar.searchInput"
        />
      </form>
      )}

      <div className={styles.scroll}>
        {/* At the top so it stays reachable however many roots are listed. */}
        {canCreateRoot && (
          <Link href="/roots/new" className={pathname === "/roots/new" ? styles.actionCurrent : styles.action}>
            {tr("newRoot")}
          </Link>
        )}
        {rootTrees.length === 0 && shared.length === 0 && (
          <p className={styles.empty}>{tr("nothingVisible")}</p>
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
              rootBadge={t.personal ? tr("personal") : undefined}
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
            <div className={styles.sectionLabel}>{guest ? tr("publicPages") : tr("sharedPages")}</div>
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

      {guest ? (
        <div className={styles.footer}>
          <Link
            href={`/login?next=${encodeURIComponent(pathname)}`}
            className={styles.footerLink}
            data-ui="Sidebar.loginLink"
          >
            <LoginIcon />
            {tr("login")}
          </Link>
        </div>
      ) : (
      <div className={styles.footer}>
        <span className={styles.user} title={userName}>
          {userName}
        </span>
        <Link href="/account" className={styles.footerIcon} aria-label={tr("account")} title={tr("account")} data-ui="Sidebar.accountLink">
          <AccountIcon />
        </Link>
        <Link href="/trash" className={styles.footerIcon} aria-label={tr("trash")} title={tr("trash")} data-ui="Sidebar.trashLink">
          <TrashIcon />
        </Link>
        {canOpenAdmin && (
          <Link href="/admin" className={styles.footerIcon} aria-label={tr("admin")} title={tr("admin")} data-ui="Sidebar.adminLink">
            <AdminIcon />
          </Link>
        )}
        <form action={logout} className={styles.logoutForm}>
          <button type="submit" className={styles.footerIcon} aria-label={tr("logout")} title={tr("logout")} data-ui="Sidebar.logoutButton">
            <LogoutIcon />
          </button>
        </form>
      </div>
      )}
    </div>
  );
}

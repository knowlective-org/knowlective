"use client";

import Link from "next/link";
import { useState } from "react";
import { displayTitle } from "@/lib/page-title";
import { AppShell } from "@/components/app-shell";
import { InitialTitleContext } from "@/components/editor-placeholder";
import { Sidebar, type SidebarTree } from "@/components/sidebar";
import { EditorLoader } from "./editor-loader";
import { PageMenu, ShareButton } from "./page-menu";
import styles from "./page-view.module.css";

export type SidebarInfo = {
  trees: SidebarTree[];
  maxDepth: number;
  userName: string;
  canCreateRoot: boolean;
  canOpenAdmin: boolean;
};

// The page screen: sidebar with every visible knowledge root on the left,
// title + editor on the right. The open page's live title is shared so
// renaming shows in the sidebar immediately.
// The lock applying to the open page, for its banner and menu.
export type PageLockView = {
  // Locked on this page itself (it's unlocked here).
  own: boolean;
  withChildren: boolean;
  lockedBy: string | null;
  lockedAt: string | null;
  // For a lock from a page above: that page, if the viewer can open it.
  holder: { id: string; title: string } | null;
};

const lockDateFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

export function PageView({
  pageId,
  initialTitle,
  canEdit,
  lock,
  canManage,
  isRootPage,
  shareUrl,
  user,
  sidebar,
}: {
  pageId: string;
  // Page.title, shown while the editor loads.
  initialTitle: string;
  // EDIT access to the page.
  canEdit: boolean;
  // Set while the page is locked: nobody can edit it, whatever their access.
  lock: PageLockView | null;
  // MANAGE access: may change this page's group grants.
  canManage: boolean;
  isRootPage: boolean;
  // This page's URL on the site's public URL, for the share button.
  shareUrl: string;
  user: { id: string; name: string };
  sidebar: SidebarInfo;
}) {
  const [liveTitle, setLiveTitle] = useState<string | undefined>(undefined);
  const readOnly = !canEdit || lock !== null;

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={pageId} currentTitle={liveTitle} />}>
      <div data-ui="PageView">
        <div className={styles.toolbar}>
          {lock ? (
            <span className={styles.locked} data-ui="PageView.lockStatus">
              🔒 ロック中
            </span>
          ) : (
            readOnly && <span className={styles.readOnly} data-ui="PageView.readOnlyBadge">閲覧のみ</span>
          )}
          <ShareButton url={shareUrl} />
          <PageMenu
            pageId={pageId}
            title={liveTitle ?? initialTitle}
            canEdit={canEdit}
            lock={lock ? { own: lock.own } : null}
            canManage={canManage}
            isRootPage={isRootPage}
          />
        </div>
        {lock && (
          <p className={styles.lockBanner} data-ui="PageView.lockBanner">
            {lock.own
              ? `このページは${lock.withChildren ? "、子ページも含めて" : ""}ロックされています。`
              : "このページは、上位のページのロックにより編集できません。"}
            {lock.lockedBy && lock.lockedAt && (
              <>
                {" "}
                （{lock.lockedBy}、{lockDateFormat.format(new Date(lock.lockedAt))}）
              </>
            )}
            {lock.own
              ? canEdit && " 編集するには、ページのメニューからロックを解除してください。"
              : lock.holder && (
                  <>
                    {" "}
                    ロックしているページ：
                    <Link href={`/pages/${lock.holder.id}`} data-ui="PageView.lockHolderLink">
                      {displayTitle(lock.holder.title)}
                    </Link>
                  </>
                )}
          </p>
        )}
        <InitialTitleContext.Provider value={initialTitle}>
          <EditorLoader pageId={pageId} readOnly={readOnly} user={user} onTitleChange={setLiveTitle} />
        </InitialTitleContext.Provider>
      </div>
    </AppShell>
  );
}

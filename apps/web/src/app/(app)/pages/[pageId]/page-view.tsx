"use client";

import { useState } from "react";
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
export function PageView({
  pageId,
  initialTitle,
  readOnly,
  canManage,
  shareUrl,
  user,
  sidebar,
}: {
  pageId: string;
  // Page.title, shown while the editor loads.
  initialTitle: string;
  readOnly: boolean;
  // MANAGE access: may change this page's group grants.
  canManage: boolean;
  // This page's URL on the site's public URL, for the share button.
  shareUrl: string;
  user: { id: string; name: string };
  sidebar: SidebarInfo;
}) {
  const [liveTitle, setLiveTitle] = useState<string | undefined>(undefined);

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={pageId} currentTitle={liveTitle} />}>
      <div data-ui="PageView">
        <div className={styles.toolbar}>
          {readOnly && <span className={styles.readOnly} data-ui="PageView.readOnlyBadge">閲覧のみ</span>}
          <ShareButton url={shareUrl} />
          <PageMenu pageId={pageId} canManage={canManage} />
        </div>
        <InitialTitleContext.Provider value={initialTitle}>
          <EditorLoader pageId={pageId} readOnly={readOnly} user={user} onTitleChange={setLiveTitle} />
        </InitialTitleContext.Provider>
      </div>
    </AppShell>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Sidebar, type SidebarTree } from "@/components/sidebar";
import { EditorLoader } from "./editor-loader";
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
  readOnly,
  canManage,
  user,
  sidebar,
}: {
  pageId: string;
  readOnly: boolean;
  // MANAGE access: may change this page's group grants.
  canManage: boolean;
  user: { id: string; name: string };
  sidebar: SidebarInfo;
}) {
  const [liveTitle, setLiveTitle] = useState<string | undefined>(undefined);

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={pageId} currentTitle={liveTitle} />}>
      <div data-ui="PageView">
        <div className={styles.toolbar}>
          {readOnly && <span className={styles.readOnly} data-ui="PageView.readOnlyBadge">閲覧のみ</span>}
          {canManage && (
            <Link href={`/pages/${pageId}/share`} className={styles.share} data-ui="PageView.shareLink">
              共有
            </Link>
          )}
        </div>
        <EditorLoader pageId={pageId} readOnly={readOnly} user={user} onTitleChange={setLiveTitle} />
      </div>
    </AppShell>
  );
}

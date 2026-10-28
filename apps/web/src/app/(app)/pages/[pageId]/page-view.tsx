"use client";

import Link from "next/link";
import type { Brand } from "@/lib/brand";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { useSaving } from "@/lib/saving-status";
import { AppShell } from "@/components/app-shell";
import { InitialTitleContext } from "@/components/editor-placeholder";
import { Sidebar, type SidebarTree } from "@/components/sidebar";
import { Breadcrumb } from "./breadcrumb";
import { EditorLoader, StaticDocumentLoader } from "./editor-loader";
import { PageMenu, ShareButton } from "./page-menu";
import styles from "./page-view.module.css";

export type SidebarInfo = {
  trees: SidebarTree[];
  maxDepth: number;
  userName: string;
  canCreateRoot: boolean;
  canOpenAdmin: boolean;
  // Someone not logged in, viewing public pages.
  guest: boolean;
  // The top left: the site's name or logo.
  brand: Brand;
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

export function PageView({
  pageId,
  initialTitle,
  canEdit,
  lock,
  canManage,
  isRootPage,
  personal,
  shareUrl,
  user,
  guestState,
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
  // In the user's personal knowledge root: never shared.
  personal: boolean;
  // This page's URL on the site's public URL, for the share button.
  shareUrl: string;
  // null: someone not logged in, on a public page.
  user: { id: string; name: string } | null;
  // For someone not logged in: the page's content (lib/public-page-state.ts),
  // shown without collaborative editing.
  guestState: string | null;
  sidebar: SidebarInfo;
}) {
  const [liveTitle, setLiveTitle] = useState<string | undefined>(undefined);
  const readOnly = !canEdit || lock !== null || user === null;
  // Edits on their way to the server (the editor and its blocks report them).
  const saving = useSaving();
  const t = useTranslations("pageView");
  const format = useFormatter();
  const displayTitle = useDisplayTitle();

  return (
    <AppShell sidebar={<Sidebar {...sidebar} currentPageId={pageId} currentTitle={liveTitle} />}>
      <div data-ui="PageView">
        <div className={styles.toolbar} data-ui="PageView.toolbar">
          <Breadcrumb trees={sidebar.trees} pageId={pageId} currentTitle={liveTitle} />
          {saving && (
            <span className={styles.saving} role="status" data-ui="PageView.status">
              {t("saving")}
            </span>
          )}
          {lock ? (
            <span className={styles.locked} data-ui="PageView.lockStatus">
              {t("locked")}
            </span>
          ) : (
            readOnly && (
              <span className={styles.readOnly} data-ui="PageView.readOnlyBadge">
                {user ? t("readOnly") : t("publicReadOnly")}
              </span>
            )
          )}
          <ShareButton url={shareUrl} />
          {user && (
          <PageMenu
            pageId={pageId}
            title={liveTitle ?? initialTitle}
            canEdit={canEdit}
            lock={lock ? { own: lock.own } : null}
            canManage={canManage}
            isRootPage={isRootPage}
            personal={personal}
          />
          )}
        </div>
        {lock && (
          <p className={styles.lockBanner} data-ui="PageView.lockBanner">
            {lock.own
              ? t("lockedHere", { withChildren: String(lock.withChildren) })
              : t("lockedAbove")}
            {lock.lockedBy && lock.lockedAt && (
              <>
                {" "}
                {t("lockedBy", {
                  name: lock.lockedBy,
                  date: format.dateTime(new Date(lock.lockedAt), { dateStyle: "medium", timeStyle: "short" }),
                })}
              </>
            )}
            {lock.own
              ? canEdit && t("unlockHint")
              : lock.holder && (
                  <>
                    {" "}
                    {t("lockedPage")}
                    <Link href={`/pages/${lock.holder.id}`} data-ui="PageView.lockHolderLink">
                      {displayTitle(lock.holder.title)}
                    </Link>
                  </>
                )}
          </p>
        )}
        <InitialTitleContext.Provider value={initialTitle}>
          {user ? (
            <EditorLoader pageId={pageId} readOnly={readOnly} user={user} onTitleChange={setLiveTitle} />
          ) : (
            <StaticDocumentLoader pageId={pageId} state={guestState ?? ""} dataUi="PageView.publicDocument" />
          )}
        </InitialTitleContext.Provider>
      </div>
    </AppShell>
  );
}

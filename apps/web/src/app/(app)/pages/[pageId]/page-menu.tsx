"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { displayTitle } from "@/lib/page-title";
import { checkDeletePage, deletePage, loadPageInfo, type PageInfo } from "./page-actions";
import styles from "./page-view.module.css";

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

// Copies the page's URL. navigator.clipboard only exists in secure contexts
// (https / localhost), so plain-http intranet installs use the old fallback.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}

export function ShareButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={styles.share}
      data-ui="PageView.shareButton"
      title="このページの URL をコピー"
      onClick={async () => {
        if (await copyText(url)) setCopied(true);
        else window.prompt("この URL をコピーしてください", url);
      }}
    >
      {copied ? "URL をコピーしました" : "共有"}
    </button>
  );
}

// The ⋯ menu at the top right of a page: page information plus page actions.
export function PageMenu({
  pageId,
  title,
  canEdit,
  canManage,
  isRootPage,
}: {
  pageId: string;
  // Current (live) title, for the delete confirmation.
  title: string;
  canEdit: boolean;
  canManage: boolean;
  isRootPage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [info, setInfo] = useState<PageInfo | null | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      setInfo(undefined);
      loadPageInfo(pageId)
        .then(setInfo)
        .catch(() => setInfo(null));
    }
    setOpen(!open);
  };

  return (
    <div className={styles.menuAnchor} ref={ref}>
      <button
        type="button"
        className={styles.menuButton}
        data-ui="PageMenu.button"
        aria-label="ページのメニュー"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        ⋯
      </button>
      {open && (
        <div className={styles.menu} data-ui="PageMenu.panel">
          <dl className={styles.info} data-ui="PageMenu.info">
            {info === undefined ? (
              <dd className={styles.infoMuted}>読み込み中…</dd>
            ) : info === null ? (
              <dd className={styles.infoMuted}>情報を取得できませんでした。</dd>
            ) : (
              <>
                <dt>作成者</dt>
                <dd>{info.createdBy}</dd>
                <dt>作成日時</dt>
                <dd>{dateTimeFormat.format(new Date(info.createdAt))}</dd>
                <dt>更新者</dt>
                <dd>{info.updatedBy ?? "—"}</dd>
                <dt>更新日時</dt>
                <dd>{dateTimeFormat.format(new Date(info.updatedAt))}</dd>
              </>
            )}
          </dl>
          <div role="menu" className={styles.menuItems}>
            <PlannedItem label="履歴表示" />
            <PlannedItem label="ロック" />
            {canManage ? (
              <Link
                href={`/pages/${pageId}/share`}
                role="menuitem"
                className={styles.menuItem}
                data-ui="PageMenu.permissions"
              >
                権限設定
              </Link>
            ) : (
              <PlannedItem label="権限設定" note="管理の権限が必要" />
            )}
            <PlannedItem label="エクスポート" />
            {canEdit && !isRootPage ? (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItemDanger}
                data-ui="PageMenu.delete"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const check = await checkDeletePage(pageId);
                    if ("error" in check) {
                      window.alert(check.error);
                      return;
                    }
                    const children = check.descendants > 0 ? `と、その下の${check.descendants}ページ` : "";
                    if (!window.confirm(`「${displayTitle(title)}」${children}をごみ箱に移動しますか？
ごみ箱から元に戻せます。`)) return;
                    const result = await deletePage(pageId);
                    if ("error" in result) {
                      window.alert(result.error);
                      return;
                    }
                    setOpen(false);
                    router.push(`/pages/${result.parentId}`);
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                <span>{deleting ? "削除しています…" : "削除"}</span>
                <span className={styles.menuNote}>ごみ箱へ</span>
              </button>
            ) : (
              <PlannedItem label="削除" danger note={isRootPage ? "ナレッジルートは削除不可" : "編集の権限が必要"} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Not implemented yet; shown so the menu's final shape is visible.
function PlannedItem({ label, note = "準備中", danger }: { label: string; note?: string; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? styles.menuItemDanger : styles.menuItem}
      data-ui="PageMenu.item"
      data-label={label}
      disabled
    >
      <span>{label}</span>
      <span className={styles.menuNote}>{note}</span>
    </button>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { showAlert, showChoice, showConfirm, showCopyText, showTypedConfirm } from "@/components/dialog";
import { EXPORT_MARKDOWN_EVENT, EXPORT_PDF_EVENT } from "@/lib/page-export";
import { displayTitle } from "@/lib/page-title";
import { MoveDialog } from "./move-dialog";
import { checkDeletePage, deletePage, loadPageInfo, lockPage, type PageInfo, unlockPage } from "./page-actions";
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
        else void showCopyText("この URL をコピーしてください。", url, { title: "URL のコピー" });
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
  lock,
  canManage,
  isRootPage,
  personal,
}: {
  pageId: string;
  // Current (live) title, for the delete confirmation.
  title: string;
  // EDIT access to the page.
  canEdit: boolean;
  // Set while the page is locked; `own` if the lock is on this very page.
  lock: { own: boolean } | null;
  canManage: boolean;
  isRootPage: boolean;
  // In the user's personal knowledge root: there's nothing to share.
  personal: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [locking, setLocking] = useState(false);
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
                <dt>オーナー</dt>
                <dd className={styles.infoList} data-ui="PageMenu.ownerGroups">
                  {info.ownerGroups.length > 0
                    ? info.ownerGroups.map((name) => <span key={name}>{name}</span>)
                    : "—"}
                </dd>
              </>
            )}
          </dl>
          <div role="menu" className={styles.menuItems}>
            <Link href={`/pages/${pageId}/history`} role="menuitem" className={styles.menuItem} data-ui="PageMenu.history">
              履歴表示
            </Link>
            {!canEdit ? (
              <PlannedItem label={lock ? "ロック解除" : "ロック"} note="編集の権限が必要" />
            ) : !lock ? (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                data-ui="PageMenu.lock"
                disabled={locking}
                onClick={async () => {
                  setOpen(false);
                  const scope = await showChoice(
                    `「${displayTitle(title)}」をロックしますか？\nロック中は、解除するまで誰も編集できません（閲覧はできます）。ロックの解除は、編集の権限があれば誰でもできます。`,
                    [
                      { value: "subtree", label: "子ページもロック" },
                      { value: "page", label: "このページだけロック" },
                    ],
                    { title: "ページのロック" },
                  );
                  if (!scope) return;
                  setLocking(true);
                  try {
                    const result = await lockPage(pageId, scope === "subtree");
                    if (result.error) await showAlert(result.error, { title: "ロックできません" });
                    router.refresh();
                  } finally {
                    setLocking(false);
                  }
                }}
              >
                ロック
              </button>
            ) : lock.own ? (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                data-ui="PageMenu.unlock"
                disabled={locking}
                onClick={async () => {
                  setOpen(false);
                  const ok = await showTypedConfirm(
                    `「${displayTitle(title)}」のロックを解除しますか？\n解除すると、編集の権限がある人は再び編集できるようになります。`,
                    { title: "ロックの解除", confirmLabel: "ロックを解除" },
                  );
                  if (!ok) return;
                  setLocking(true);
                  try {
                    const result = await unlockPage(pageId);
                    if (result.error) await showAlert(result.error, { title: "解除できません" });
                    router.refresh();
                  } finally {
                    setLocking(false);
                  }
                }}
              >
                ロック解除
              </button>
            ) : (
              <PlannedItem label="ロック解除" note="上位のページで解除" />
            )}
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
              <PlannedItem label="権限設定" note={personal ? "自分専用（共有できません）" : "管理の権限が必要"} />
            )}
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              data-ui="PageMenu.exportMarkdown"
              onClick={() => {
                setOpen(false);
                // The editor holds the content and writes the file.
                window.dispatchEvent(new Event(EXPORT_MARKDOWN_EVENT));
              }}
            >
              <span>Markdown で書き出す</span>
              <span className={styles.menuNote}>.md</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              data-ui="PageMenu.exportPdf"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new Event(EXPORT_PDF_EVENT));
              }}
            >
              <span>PDF で書き出す</span>
              <span className={styles.menuNote}>.pdf</span>
            </button>
            {canEdit && !isRootPage && !lock ? (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                data-ui="PageMenu.move"
                onClick={() => {
                  setOpen(false);
                  setMoveOpen(true);
                }}
              >
                移動
              </button>
            ) : (
              <PlannedItem label="移動" note={isRootPage ? "ナレッジルートは移動不可" : lock && canEdit ? "ロック中" : "編集の権限が必要"} />
            )}
            {canEdit && !isRootPage && !lock ? (
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
                      await showAlert(check.error, { title: "削除できません" });
                      return;
                    }
                    const children = check.descendants > 0 ? `と、その下の${check.descendants}ページ` : "";
                    const ok = await showConfirm(
                      `「${displayTitle(title)}」${children}をごみ箱に移動しますか？\nごみ箱から元に戻せます。`,
                      { title: "ページの削除", confirmLabel: "ごみ箱に移動", danger: true },
                    );
                    if (!ok) return;
                    const result = await deletePage(pageId);
                    if ("error" in result) {
                      await showAlert(result.error, { title: "削除できません" });
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
              <PlannedItem label="削除" danger note={isRootPage ? "ナレッジルートは削除不可" : lock && canEdit ? "ロック中" : "編集の権限が必要"} />
            )}
          </div>
        </div>
      )}
      {moveOpen && <MoveDialog pageId={pageId} title={title} onClose={() => setMoveOpen(false)} />}
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

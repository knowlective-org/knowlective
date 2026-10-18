"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { showAlert, showChoice, showConfirm, showCopyText, showTypedConfirm } from "@/components/dialog";
import { EXPORT_MARKDOWN_EVENT, EXPORT_PDF_EVENT } from "@/lib/page-export";
import { MoveDialog } from "./move-dialog";
import { checkDeletePage, deletePage, loadPageInfo, lockPage, type PageInfo, unlockPage } from "./page-actions";
import styles from "./page-view.module.css";

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
  const t = useTranslations("pageMenu");
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
      title={t("copyUrlTitle")}
      onClick={async () => {
        if (await copyText(url)) setCopied(true);
        else void showCopyText(t("copyUrlPrompt"), url, { title: t("copyUrlDialog") });
      }}
    >
      {copied ? t("copied") : t("share")}
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
  const t = useTranslations("pageMenu");
  const format = useFormatter();
  const displayTitle = useDisplayTitle();
  const formatDate = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

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
        aria-label={t("menu")}
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
              <dd className={styles.infoMuted}>{t("loading")}</dd>
            ) : info === null ? (
              <dd className={styles.infoMuted}>{t("infoFailed")}</dd>
            ) : (
              <>
                <dt>{t("createdBy")}</dt>
                <dd>{info.createdBy}</dd>
                <dt>{t("createdAt")}</dt>
                <dd>{formatDate(info.createdAt)}</dd>
                <dt>{t("updatedBy")}</dt>
                <dd>{info.updatedBy ?? "—"}</dd>
                <dt>{t("updatedAt")}</dt>
                <dd>{formatDate(info.updatedAt)}</dd>
                <dt>{t("owners")}</dt>
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
              {t("history")}
            </Link>
            {!canEdit ? (
              <PlannedItem label={lock ? t("unlock") : t("lock")} note={t("needsEdit")} />
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
                    t("lockConfirm", { title: displayTitle(title) }),
                    [
                      { value: "subtree", label: t("lockSubtree") },
                      { value: "page", label: t("lockPageOnly") },
                    ],
                    { title: t("lockTitle") },
                  );
                  if (!scope) return;
                  setLocking(true);
                  try {
                    const result = await lockPage(pageId, scope === "subtree");
                    if (result.error) await showAlert(result.error, { title: t("cannotLock") });
                    router.refresh();
                  } finally {
                    setLocking(false);
                  }
                }}
              >
                {t("lock")}
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
                    t("unlockConfirm", { title: displayTitle(title) }),
                    { title: t("unlockTitle"), confirmLabel: t("unlockLabel") },
                  );
                  if (!ok) return;
                  setLocking(true);
                  try {
                    const result = await unlockPage(pageId);
                    if (result.error) await showAlert(result.error, { title: t("cannotUnlock") });
                    router.refresh();
                  } finally {
                    setLocking(false);
                  }
                }}
              >
                {t("unlock")}
              </button>
            ) : (
              <PlannedItem label={t("unlock")} note={t("unlockAbove")} />
            )}
            {canManage ? (
              <Link
                href={`/pages/${pageId}/share`}
                role="menuitem"
                className={styles.menuItem}
                data-ui="PageMenu.permissions"
              >
                {t("permissions")}
              </Link>
            ) : (
              <PlannedItem label={t("permissions")} note={personal ? t("personalNoShare") : t("needsManage")} />
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
              <span>{t("exportMarkdown")}</span>
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
              <span>{t("exportPdf")}</span>
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
                {t("move")}
              </button>
            ) : (
              <PlannedItem label={t("move")} note={isRootPage ? t("rootCannotMove") : lock && canEdit ? t("locked") : t("needsEdit")} />
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
                      await showAlert(check.error, { title: t("cannotDelete") });
                      return;
                    }
                    const ok = await showConfirm(
                      t("deleteConfirm", { title: displayTitle(title), descendants: check.descendants }),
                      { title: t("deleteTitle"), confirmLabel: t("deleteLabel"), danger: true },
                    );
                    if (!ok) return;
                    const result = await deletePage(pageId);
                    if ("error" in result) {
                      await showAlert(result.error, { title: t("cannotDelete") });
                      return;
                    }
                    setOpen(false);
                    router.push(`/pages/${result.parentId}`);
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                <span>{deleting ? t("deleting") : t("delete")}</span>
                <span className={styles.menuNote}>{t("toTrash")}</span>
              </button>
            ) : (
              <PlannedItem label={t("delete")} danger note={isRootPage ? t("rootCannotDelete") : lock && canEdit ? t("locked") : t("needsEdit")} />
            )}
          </div>
        </div>
      )}
      {moveOpen && <MoveDialog pageId={pageId} title={title} onClose={() => setMoveOpen(false)} />}
    </div>
  );
}

// Not implemented yet; shown so the menu's final shape is visible.
function PlannedItem({ label, note, danger }: { label: string; note?: string; danger?: boolean }) {
  const t = useTranslations("pageMenu");
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
      <span className={styles.menuNote}>{note ?? t("planned")}</span>
    </button>
  );
}

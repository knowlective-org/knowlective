"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import ui from "@/styles/ui.module.css";
import styles from "@/components/dialog.module.css";
import { loadRootFavicon, removeRootFavicon, setRootFavicon } from "./favicon-actions";

// Setting a knowledge root's favicon (lib/root-favicon.ts), from its root
// page's menu.
export function FaviconDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const t = useTranslations("rootFavicon");
  const tc = useTranslations("common");
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
    loadRootFavicon(pageId)
      .then((result) => {
        if (result) setCurrent(result.url);
        else setError(t("cannot"));
      })
      .catch(() => setError(t("cannot")));
  }, [pageId, t]);

  const done = (result: { error?: string }) => {
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
    onClose();
  };

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-ui="FaviconDialog"
      aria-labelledby="favicon-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className={styles.body}
        data-ui="FaviconDialog.form"
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const file = data.get("file");
          if (!(file instanceof File) || file.size === 0) {
            setError(t("noFile"));
            return;
          }
          setBusy(true);
          setError(null);
          try {
            done(await setRootFavicon(pageId, data));
          } catch {
            setError(t("cannot"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="favicon-dialog-title" className={styles.title}>
          {t("title")}
        </h2>
        <p className={ui.note}>{t("lead")}</p>
        {current !== undefined && (
          <p className={ui.note} data-ui="FaviconDialog.current">
            {current ? (
              <>
                {t("current")}:{" "}
                {/* eslint-disable-next-line @next/next/no-img-element -- a small icon from our own API */}
                <img src={withBasePath(current)} alt="" width={32} height={32} style={{ verticalAlign: "middle", objectFit: "contain" }} data-ui="FaviconDialog.preview" />
              </>
            ) : (
              t("none")
            )}
          </p>
        )}
        <label style={{ display: "grid", gap: 4 }}>
          {t("file")}
          <input
            type="file"
            name="file"
            accept=".png,.ico,.svg,image/png,image/x-icon,image/svg+xml"
            className={ui.field}
            data-ui="FaviconDialog.fileInput"
            onChange={() => setError(null)}
          />
        </label>
        {error && (
          <p className={ui.error} role="alert" data-ui="FaviconDialog.error">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          {current && (
            <button
              type="button"
              className={ui.buttonSecondary}
              data-ui="FaviconDialog.removeButton"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  done(await removeRootFavicon(pageId));
                } catch {
                  setError(t("cannot"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("remove")}
            </button>
          )}
          <button type="button" className={ui.buttonSecondary} data-ui="FaviconDialog.cancelButton" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button type="submit" className={ui.button} data-ui="FaviconDialog.submitButton" disabled={busy || current === undefined}>
            {busy ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useRef } from "react";
import { StatusRow } from "@/components/status-row";
import { withBasePath } from "@/lib/base-path";
import styles from "@/styles/ui.module.css";
import { type SiteFaviconState, saveSiteFaviconSettings } from "./actions";

// The site's favicon in the browser's tab (lib/site-favicon.ts): a file to
// upload, or back to the default.
export function SiteFaviconForm({ href, custom }: { href: string; custom: boolean }) {
  const [state, formAction, pending] = useActionState(saveSiteFaviconSettings, {} as SiteFaviconState);
  const t = useTranslations("admin.siteFavicon");
  const tc = useTranslations("admin.common");
  const formRef = useRef<HTMLFormElement>(null);
  const message = state.error ?? (state.saved ? tc("saved") : state.removed ? t("removed") : "");

  return (
    <form
      ref={formRef}
      data-ui="SiteFaviconForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}
    >
      <div data-ui="SiteFaviconForm.preview" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className={styles.note}>{t("current")}</span>
        {/* eslint-disable-next-line @next/next/no-img-element -- a 32px icon from our own route */}
        <img src={withBasePath(href)} alt="" width={32} height={32} data-ui="SiteFaviconForm.currentImage" />
        <span className={styles.note}>{custom ? t("customNote") : t("defaultNote")}</span>
      </div>
      <label>
        {custom ? t("replace") : t("file")}
        <input type="file" name="favicon" accept=".png,.ico,.svg,image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml" className={styles.field} data-ui="SiteFaviconForm.fileInput" />
        <span className={styles.note}>{t("fileNote")}</span>
      </label>
      <StatusRow message={message} className={state.error ? styles.error : styles.success} dataUi="SiteFaviconForm.status">
        {custom && (
          <button type="submit" name="remove" value="1" disabled={pending} className={styles.buttonSecondary} data-ui="SiteFaviconForm.removeButton">
            {t("remove")}
          </button>
        )}
        <button type="submit" disabled={pending} className={styles.button} data-ui="SiteFaviconForm.submitButton">
          {pending ? tc("saving") : tc("save")}
        </button>
      </StatusRow>
    </form>
  );
}

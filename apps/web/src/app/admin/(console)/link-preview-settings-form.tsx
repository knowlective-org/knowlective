"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import type { LinkPreviewSettingsView } from "@/lib/link-preview-settings";
import styles from "@/styles/ui.module.css";
import { type LinkPreviewSettingsState, saveLinkPreviewSettings } from "./actions";

const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

export function LinkPreviewSettingsForm({ current }: { current: LinkPreviewSettingsView }) {
  const [state, formAction, pending] = useActionState(saveLinkPreviewSettings, {} as LinkPreviewSettingsState);
  const ta = useTranslations("admin");
  const [enabled, setEnabled] = useState(current.enabled);
  const [allowPrivate, setAllowPrivate] = useState(current.allowPrivate);
  const [proxyUrl, setProxyUrl] = useState(current.proxyUrl ?? "");

  return (
    // Submitted by hand, not via `action`: React resets action forms after
    // they run, which would put the checkboxes back to their initial values.
    <form
      data-ui="LinkPreviewSettingsForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <label style={checkRow}>
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          data-ui="LinkPreviewSettingsForm.enabledCheckbox"
        />
        <span>
          {ta("linkPreview.enabled")}
          <span className={styles.note} style={{ display: "block" }}>
            {ta("linkPreview.enabledNote")}
          </span>
        </span>
      </label>

      <label style={checkRow}>
        <input
          type="checkbox"
          name="allowPrivate"
          checked={allowPrivate}
          disabled={!enabled}
          onChange={(e) => setAllowPrivate(e.target.checked)}
          data-ui="LinkPreviewSettingsForm.allowPrivateCheckbox"
        />
        <span>
          {ta("linkPreview.allowPrivate")}
          <span className={styles.note} style={{ display: "block" }}>
            {ta("linkPreview.allowPrivateNote")}
          </span>
        </span>
      </label>

      <label>
        {ta("linkPreview.proxy")}
        <input
          type="url"
          name="proxyUrl"
          value={proxyUrl}
          onChange={(e) => setProxyUrl(e.target.value)}
          disabled={!enabled}
          placeholder="http://proxy.example.co.jp:8080"
          spellCheck={false}
          autoComplete="off"
          className={styles.field}
          data-ui="LinkPreviewSettingsForm.proxyUrlInput"
        />
        <span className={styles.note}>
          {ta("linkPreview.proxyNote")}
        </span>
      </label>

      {enabled && proxyUrl.trim() !== "" && (
        <>
          <label>
            {ta("linkPreview.proxyUser")}
            <input
              type="text"
              name="proxyUsername"
              defaultValue={current.proxyUsername ?? ""}
              autoComplete="off"
              className={styles.field}
              data-ui="LinkPreviewSettingsForm.proxyUsernameInput"
            />
          </label>
          <label>
            {ta("linkPreview.proxyPassword")}
            <input
              type="password"
              name="proxyPassword"
              placeholder={current.hasProxyPassword ? ta("linkPreview.proxyPasswordKeep") : ""}
              autoComplete="new-password"
              className={styles.field}
              data-ui="LinkPreviewSettingsForm.proxyPasswordInput"
            />
            <span className={styles.note}>{ta("linkPreview.proxyPasswordNote")}</span>
          </label>
        </>
      )}

      <p
        data-ui="LinkPreviewSettingsForm.status"
        aria-live="polite"
        className={state.error ? styles.error : styles.success}
      >
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <button data-ui="LinkPreviewSettingsForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("common.saving") : ta("common.save")}
      </button>
    </form>
  );
}

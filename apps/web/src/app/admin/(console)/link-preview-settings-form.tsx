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

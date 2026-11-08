"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { StatusRow } from "@/components/status-row";
import styles from "@/styles/ui.module.css";
import { type AuditorSettingsState, saveAuditorSettings } from "./actions";

const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

// Whether the auditors group may view everyone's personal knowledge root.
export function AuditorSettingsForm({ personalRoots: initial }: { personalRoots: boolean }) {
  const [state, formAction, pending] = useActionState(saveAuditorSettings, {} as AuditorSettingsState);
  const t = useTranslations();
  const [personalRoots, setPersonalRoots] = useState(initial);
  return (
    // Submitted by hand, not via `action`: React resets action forms after
    // they run, which would put the checkbox back to its initial value.
    <form
      data-ui="AuditorSettingsForm"
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
          name="personalRoots"
          checked={personalRoots}
          onChange={(e) => setPersonalRoots(e.target.checked)}
          data-ui="AuditorSettingsForm.personalRootsCheckbox"
        />
        <span>
          {t("admin.overview.auditorsPersonalRoots")}
          <span className={styles.note} style={{ display: "block" }}>
            {t("admin.overview.auditorsPersonalRootsNote")}
          </span>
        </span>
      </label>
      <StatusRow
        message={state.error ?? (state.saved ? t("common.saved") : "")}
        className={state.error ? styles.error : styles.success}
        dataUi="AuditorSettingsForm.status"
      >
        <button type="submit" disabled={pending} className={styles.button} data-ui="AuditorSettingsForm.submitButton">
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </StatusRow>
    </form>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { StatusRow } from "@/components/status-row";
import styles from "@/styles/ui.module.css";
import { type PushNotificationsState, savePushNotificationsSetting } from "./actions";

const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

export function PushNotificationsForm({ enabled: initial }: { enabled: boolean }) {
  const [state, formAction, pending] = useActionState(savePushNotificationsSetting, {} as PushNotificationsState);
  const t = useTranslations();
  const [enabled, setEnabled] = useState(initial);
  return (
    // Submitted by hand, not via `action`: React resets action forms after
    // they run, which would put the checkbox back to its initial value.
    <form
      data-ui="PushNotificationsForm"
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
          data-ui="PushNotificationsForm.enabledCheckbox"
        />
        <span>{t("admin.overview.pushNotificationsEnabled")}</span>
      </label>
      <StatusRow
        message={state.error ?? (state.saved ? t("common.saved") : "")}
        className={state.error ? styles.error : styles.success}
        dataUi="PushNotificationsForm.status"
      >
        <button type="submit" disabled={pending} className={styles.button} data-ui="PushNotificationsForm.submitButton">
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </StatusRow>
    </form>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { showConfirm } from "@/components/dialog";
import { StatusRow } from "@/components/status-row";
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS, parseRetentionDays } from "@/lib/version-retention";
import styles from "@/styles/ui.module.css";
import { type VersionRetentionState, saveVersionRetention } from "./actions";

const checkRow = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } as const;

// How long page history is kept (lib/version-cleanup.ts).
export function VersionRetentionForm({ current }: { current: number | null }) {
  const [state, formAction, pending] = useActionState(saveVersionRetention, {} as VersionRetentionState);
  const t = useTranslations();
  const [forever, setForever] = useState(current === null);
  const [days, setDays] = useState(String(current ?? 365));
  return (
    // Submitted by hand: React resets action forms after they run (the
    // radios would go back), and a shorter period asks first.
    <form
      data-ui="VersionRetentionForm"
      action={formAction}
      className={styles.form}
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const next = forever ? null : parseRetentionDays(days);
        if (typeof next === "number" && (current === null || next < current)) {
          const ok = await showConfirm(t("admin.overview.versionRetentionConfirm", { days: next }), {
            danger: true,
            confirmLabel: t("common.save"),
          });
          if (!ok) return;
        }
        startTransition(() => formAction(data));
      }}
    >
      <label style={checkRow}>
        <input
          type="radio"
          name="mode"
          value="forever"
          checked={forever}
          onChange={() => setForever(true)}
          data-ui="VersionRetentionForm.foreverRadio"
        />
        <span>{t("admin.overview.versionRetentionForever")}</span>
      </label>
      <label style={checkRow}>
        <input
          type="radio"
          name="mode"
          value="days"
          checked={!forever}
          onChange={() => setForever(false)}
          data-ui="VersionRetentionForm.daysRadio"
        />
        <span>{t("admin.overview.versionRetentionDeleteBefore")}</span>
        <input
          type="number"
          name="days"
          min={MIN_RETENTION_DAYS}
          max={MAX_RETENTION_DAYS}
          required={!forever}
          disabled={forever}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className={styles.field}
          style={{ width: "8em" }}
          aria-label={t("admin.overview.versionRetentionDays")}
          data-ui="VersionRetentionForm.daysInput"
        />
        <span>{t("admin.overview.versionRetentionDaysUnit")}</span>
      </label>
      <p className={styles.note}>{t("admin.overview.versionRetentionNote")}</p>
      <StatusRow
        message={state.error ?? (state.saved ? t("common.saved") : "")}
        className={state.error ? styles.error : styles.success}
        dataUi="VersionRetentionForm.status"
      >
        <button type="submit" disabled={pending} className={styles.button} data-ui="VersionRetentionForm.submitButton">
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </StatusRow>
    </form>
  );
}

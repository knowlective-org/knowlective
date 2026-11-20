"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { submitKeepingValues } from "@/lib/form-submit";
import { StatusRow } from "@/components/status-row";
import styles from "@/styles/ui.module.css";
import { MAX_SIDEBAR_CHILD_LIMIT } from "@/lib/sidebar-child-limit";
import { type SidebarState, saveSidebarSettings } from "./actions";

// The default number listed when folding is first turned on.
const DEFAULT_LIMIT = 5;

// Whether the sidebar folds a page's child pages past some number into a
// "N more" row (User.sidebarChildLimit), and how many it lists.
export function SidebarForm({ limit }: { limit: number | null }) {
  const [state, formAction, pending] = useActionState(saveSidebarSettings, {} as SidebarState);
  const t = useTranslations();
  const [fold, setFold] = useState(limit !== null);

  return (
    <form data-ui="SidebarForm" action={formAction} onSubmit={submitKeepingValues(formAction)} className={styles.form}>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" name="fold" checked={fold} onChange={(e) => setFold(e.target.checked)} data-ui="SidebarForm.foldCheckbox" />
        {t("account.sidebar.fold")}
      </label>
      <label>
        {t("account.sidebar.limit")}
        <input
          type="number"
          name="limit"
          min={1}
          max={MAX_SIDEBAR_CHILD_LIMIT}
          required={fold}
          disabled={!fold}
          defaultValue={limit ?? DEFAULT_LIMIT}
          className={styles.field}
          data-ui="SidebarForm.limitInput"
        />
        <span className={styles.note}>{t("account.sidebar.note")}</span>
      </label>
      <StatusRow message={state.error ?? (state.saved ? t("common.saved") : "")} className={state.error ? styles.error : styles.success} dataUi="SidebarForm.status">
        <button data-ui="SidebarForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </StatusRow>
    </form>
  );
}

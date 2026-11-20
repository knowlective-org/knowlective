"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { submitKeepingValues } from "@/lib/form-submit";
import styles from "@/styles/ui.module.css";
import { type UploadLimitState, saveUploadLimit } from "./actions";
import { StatusRow } from "@/components/status-row";

export function UploadLimitForm({ current, maxLimitMb }: { current: number; maxLimitMb: number }) {
  const [state, formAction, pending] = useActionState(saveUploadLimit, {} as UploadLimitState);
  const ta = useTranslations("admin");
  return (
    <form data-ui="UploadLimitForm" action={formAction} onSubmit={submitKeepingValues(formAction)} className={styles.form}>
      <label>
        {ta("uploadLimit.label", { max: maxLimitMb })}
        <input
          type="number"
          data-ui="UploadLimitForm.maxUploadSizeInput"
          name="maxUploadSizeMb"
          required
          min={1}
          max={maxLimitMb}
          defaultValue={current}
          className={styles.field}
        />
      </label>
      <StatusRow message={state.error ?? (state.saved ? ta("common.saved") : "")} className={state.error ? styles.error : styles.success} dataUi="UploadLimitForm.status">
        <button data-ui="UploadLimitForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? ta("common.saving") : ta("common.save")}
        </button>
      </StatusRow>
    </form>
  );
}

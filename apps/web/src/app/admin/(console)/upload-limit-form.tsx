"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type UploadLimitState, saveUploadLimit } from "./actions";

export function UploadLimitForm({ current, maxLimitMb }: { current: number; maxLimitMb: number }) {
  const [state, formAction, pending] = useActionState(saveUploadLimit, {} as UploadLimitState);
  const ta = useTranslations("admin");
  return (
    <form data-ui="UploadLimitForm" action={formAction} className={styles.form}>
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
      <p data-ui="UploadLimitForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <button data-ui="UploadLimitForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("common.saving") : ta("common.save")}
      </button>
    </form>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type PublicUrlState, savePublicUrl } from "./actions";

const initialState: PublicUrlState = {};

export function PublicUrlForm({ current, suggested }: { current: string | null; suggested: string }) {
  const [state, formAction, pending] = useActionState(savePublicUrl, initialState);
  const ta = useTranslations("admin");

  return (
    <form data-ui="PublicUrlForm" action={formAction} className={styles.form}>
      <label>
        {ta("publicUrl.label")}
        <input
          type="url"
          data-ui="PublicUrlForm.publicUrlInput"
          name="publicUrl"
          required
          defaultValue={current ?? suggested}
          placeholder="https://knowlective.example.com"
          spellCheck={false}
          className={styles.field}
        />
      </label>
      <p className={styles.note}>
        {ta("publicUrl.note")}
      </p>
      <p data-ui="PublicUrlForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <button data-ui="PublicUrlForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("common.saving") : ta("common.save")}
      </button>
    </form>
  );
}

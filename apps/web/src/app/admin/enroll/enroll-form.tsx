"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { confirmEnrollment, type EnrollState } from "./actions";

const initialState: EnrollState = {};

export function EnrollForm() {
  const [state, formAction, pending] = useActionState(confirmEnrollment, initialState);
  const t = useTranslations("admin");

  return (
    <form action={formAction} className={styles.form} data-ui="EnrollForm">
      <label>
        {t("enroll.code")}
        <input
          data-ui="EnrollForm.codeInput"
          type="text"
          name="code"
          required
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          autoComplete="one-time-code"
          className={styles.code}
        />
      </label>
      <p aria-live="polite" className={styles.error} data-ui="EnrollForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="EnrollForm.submitButton">
        {pending ? t("common.checking") : t("enroll.submit")}
      </button>
    </form>
  );
}

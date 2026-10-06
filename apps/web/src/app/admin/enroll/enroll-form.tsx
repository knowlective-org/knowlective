"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { confirmEnrollment, type EnrollState } from "./actions";

const initialState: EnrollState = {};

export function EnrollForm() {
  const [state, formAction, pending] = useActionState(confirmEnrollment, initialState);

  return (
    <form action={formAction} className={styles.form} data-ui="EnrollForm">
      <label>
        アプリに表示された認証コード（6桁）
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
        {pending ? "確認しています…" : "登録を完了する"}
      </button>
    </form>
  );
}

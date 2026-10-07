"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type ResetPasswordState, resetPassword } from "./actions";

export function ResetPasswordForm({ token, email, minLength }: { token: string; email: string; minLength: number }) {
  const [state, formAction, pending] = useActionState(resetPassword, {} as ResetPasswordState);

  return (
    <form data-ui="ResetPasswordForm" action={formAction} className={styles.form}>
      <input type="hidden" name="token" value={token} />
      <label>
        メールアドレス
        {/* Not submitted (the link decides the account); lets password managers save the new one. */}
        <input
          data-ui="ResetPasswordForm.emailInput"
          type="email"
          value={email}
          readOnly
          autoComplete="username"
          className={styles.field}
        />
      </label>
      <label>
        新しいパスワード（{minLength}文字以上）
        <input
          data-ui="ResetPasswordForm.passwordInput"
          type="password"
          name="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          className={styles.field}
        />
      </label>
      <label>
        新しいパスワード（確認）
        <input
          data-ui="ResetPasswordForm.confirmPasswordInput"
          type="password"
          name="confirm"
          required
          minLength={minLength}
          autoComplete="new-password"
          className={styles.field}
        />
      </label>
      <p data-ui="ResetPasswordForm.error" aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button data-ui="ResetPasswordForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "設定しています…" : "パスワードを設定する"}
      </button>
    </form>
  );
}

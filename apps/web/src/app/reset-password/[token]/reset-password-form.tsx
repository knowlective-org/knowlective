"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type ResetPasswordState, resetPassword } from "./actions";

export function ResetPasswordForm({ token, email, minLength }: { token: string; email: string; minLength: number }) {
  const [state, formAction, pending] = useActionState(resetPassword, {} as ResetPasswordState);
  const t = useTranslations();

  return (
    <form data-ui="ResetPasswordForm" action={formAction} className={styles.form}>
      <input type="hidden" name="token" value={token} />
      <label>
        {t("common.email")}
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
        {t("resetPassword.newPassword", { min: minLength })}
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
        {t("resetPassword.confirmNewPassword")}
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
        {pending ? t("resetPassword.submitting") : t("resetPassword.submit")}
      </button>
    </form>
  );
}

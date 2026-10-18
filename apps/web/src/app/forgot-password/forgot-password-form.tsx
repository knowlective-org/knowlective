"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { formatDuration } from "@/i18n/duration";
import styles from "@/styles/ui.module.css";
import { type ForgotPasswordState, requestPasswordReset } from "./actions";

export function ForgotPasswordForm({ ttlMinutes }: { ttlMinutes: number }) {
  const [state, formAction, pending] = useActionState(requestPasswordReset, {} as ForgotPasswordState);
  const t = useTranslations();
  const td = useTranslations("duration");

  if (state.sentTo) {
    return (
      <div data-ui="ForgotPasswordForm.sent">
        <p className={styles.lead}>
          {t("forgotPassword.sent", { email: state.sentTo, duration: formatDuration(td, ttlMinutes) })}
        </p>
        <p className={styles.note}>{t("forgotPassword.sentNote")}</p>
      </div>
    );
  }

  return (
    <form data-ui="ForgotPasswordForm" action={formAction} className={styles.form}>
      <label>
        {t("common.email")}
        <input
          data-ui="ForgotPasswordForm.emailInput"
          type="email"
          name="email"
          required
          autoComplete="username"
          maxLength={254}
          className={styles.field}
        />
      </label>
      <p data-ui="ForgotPasswordForm.error" aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button data-ui="ForgotPasswordForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? t("common.sending") : t("forgotPassword.submit")}
      </button>
    </form>
  );
}

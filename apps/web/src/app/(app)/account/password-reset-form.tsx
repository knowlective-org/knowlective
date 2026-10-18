"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { formatDuration } from "@/i18n/duration";
import styles from "@/styles/ui.module.css";
import { type OwnPasswordResetState, requestOwnPasswordReset } from "./actions";

export function OwnPasswordResetForm({ email, ttlMinutes }: { email: string; ttlMinutes: number }) {
  const [state, formAction, pending] = useActionState(requestOwnPasswordReset, {} as OwnPasswordResetState);
  const t = useTranslations();
  const td = useTranslations("duration");

  if (state.sentTo) {
    return (
      <div data-ui="OwnPasswordResetForm.status">
        <p className={styles.success}>
          {t("account.passwordReset.sent", { email: state.sentTo, duration: formatDuration(td, ttlMinutes) })}
        </p>
        <p className={styles.note}>{t("account.passwordReset.sentNote")}</p>
      </div>
    );
  }

  return (
    <form data-ui="OwnPasswordResetForm" action={formAction} className={styles.form}>
      <p className={styles.note}>{t("account.passwordReset.explain", { email })}</p>
      <p data-ui="OwnPasswordResetForm.error" aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button data-ui="OwnPasswordResetForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? t("common.sending") : t("account.passwordReset.submit")}
      </button>
    </form>
  );
}

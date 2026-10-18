"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { formatDuration } from "@/i18n/duration";
import styles from "@/styles/ui.module.css";
import { type SignupState, requestSignup } from "./actions";

export function SignupForm({ allowedDomains, ttlHours }: { allowedDomains: string[]; ttlHours: number }) {
  const [state, formAction, pending] = useActionState(requestSignup, {} as SignupState);
  const t = useTranslations();
  const td = useTranslations("duration");

  if (state.sentTo) {
    return (
      <div data-ui="SignupForm.sent">
        <p className={styles.lead}>
          {t("signup.sent", { email: state.sentTo, duration: formatDuration(td, ttlHours * 60) })}
        </p>
        <p className={styles.note}>{t("common.spamNote")}</p>
      </div>
    );
  }

  return (
    <form data-ui="SignupForm" action={formAction} className={styles.form}>
      <label>
        {t("common.email")}
        <input
          data-ui="SignupForm.emailInput"
          type="email"
          name="email"
          required
          autoComplete="email"
          maxLength={254}
          className={styles.field}
        />
      </label>
      {allowedDomains.length > 0 && (
        <p className={styles.note}>{t("signup.domains", { domains: allowedDomains.join(t("common.listSeparator")) })}</p>
      )}
      <p data-ui="SignupForm.error" aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button data-ui="SignupForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? t("common.sending") : t("signup.submit")}
      </button>
    </form>
  );
}

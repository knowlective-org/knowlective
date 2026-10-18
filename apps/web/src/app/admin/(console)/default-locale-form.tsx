"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type AppLocale, LOCALES, LOCALE_NAMES } from "@/i18n/locales";
import styles from "@/styles/ui.module.css";
import { type DefaultLocaleState, saveDefaultLocale } from "./actions";

// The site's default language (InstanceConfig.defaultLocale).
export function DefaultLocaleForm({ current }: { current: AppLocale }) {
  const [state, formAction, pending] = useActionState(saveDefaultLocale, {} as DefaultLocaleState);
  const t = useTranslations("admin");

  return (
    <form data-ui="DefaultLocaleForm" action={formAction} className={styles.form}>
      <label>
        {t("localeForm.label")}
        <select name="locale" defaultValue={current} className={styles.field} data-ui="DefaultLocaleForm.localeSelect">
          {LOCALES.map((l) => (
            <option key={l} value={l} lang={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      </label>
      <p data-ui="DefaultLocaleForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? t("common.saved") : "")}
      </p>
      <button data-ui="DefaultLocaleForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}

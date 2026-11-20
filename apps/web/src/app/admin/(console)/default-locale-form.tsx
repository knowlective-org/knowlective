"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { submitKeepingValues } from "@/lib/form-submit";
import { type AppLocale, LOCALES, LOCALE_NAMES } from "@/i18n/locales";
import styles from "@/styles/ui.module.css";
import { type DefaultLocaleState, saveDefaultLocale } from "./actions";
import { StatusRow } from "@/components/status-row";

// The site's default language (InstanceConfig.defaultLocale).
export function DefaultLocaleForm({ current }: { current: AppLocale }) {
  const [state, formAction, pending] = useActionState(saveDefaultLocale, {} as DefaultLocaleState);
  const t = useTranslations("admin");

  return (
    <form data-ui="DefaultLocaleForm" action={formAction} onSubmit={submitKeepingValues(formAction)} className={styles.form}>
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
      <StatusRow message={state.error ?? (state.saved ? t("common.saved") : "")} className={state.error ? styles.error : styles.success} dataUi="DefaultLocaleForm.status">
        <button data-ui="DefaultLocaleForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </StatusRow>
    </form>
  );
}

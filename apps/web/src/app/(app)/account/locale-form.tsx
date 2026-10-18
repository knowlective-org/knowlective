"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type AppLocale, LOCALES, LOCALE_NAMES } from "@/i18n/locales";
import styles from "@/styles/ui.module.css";
import { type LocaleState, saveLocale } from "./actions";

// The user's display language; "" follows the browser.
export function LocaleForm({ current }: { current: AppLocale | null }) {
  const [state, formAction, pending] = useActionState(saveLocale, {} as LocaleState);
  const t = useTranslations();

  return (
    <form data-ui="LocaleForm" action={formAction} className={styles.form}>
      <label>
        {t("account.language.label")}
        <select name="locale" defaultValue={current ?? ""} className={styles.field} data-ui="LocaleForm.localeSelect">
          <option value="">{t("account.language.browser")}</option>
          {LOCALES.map((l) => (
            // Each language in itself, so it can be found whatever is shown now.
            <option key={l} value={l} lang={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
        <span className={styles.note}>{t("account.language.note")}</span>
      </label>
      <p data-ui="LocaleForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? t("common.saved") : "")}
      </p>
      <button data-ui="LocaleForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}

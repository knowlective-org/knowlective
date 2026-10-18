"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type AppLocale, LOCALES, LOCALE_NAMES } from "@/i18n/locales";
import { completeSetup, type SetupState } from "./actions";

const initialState: SetupState = {};

const fieldStyle = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  marginTop: 4,
  fontSize: 16,
  border: "1px solid #999",
  borderRadius: 6,
} as const;

const noteStyle = { display: "block", fontSize: 14, opacity: 0.75, marginTop: 4 } as const;

export function SetupForm({
  minLength,
  suggestedUrl,
  suggestedLocale,
}: {
  minLength: number;
  suggestedUrl: string;
  // The language this screen is shown in.
  suggestedLocale: AppLocale;
}) {
  const [state, formAction, pending] = useActionState(completeSetup, initialState);
  const t = useTranslations("setup");

  return (
    <form action={formAction} style={{ display: "grid", gap: 16 }} data-ui="SetupForm">
      <label>
        {t("publicUrl")}
        <input
          data-ui="SetupForm.publicUrlInput"
          type="url"
          name="publicUrl"
          required
          defaultValue={suggestedUrl}
          placeholder="https://knowlective.example.com"
          spellCheck={false}
          style={fieldStyle}
        />
        <span style={noteStyle}>{t("publicUrlNote")}</span>
      </label>
      <label>
        {t("defaultLocale")}
        <select name="defaultLocale" defaultValue={suggestedLocale} style={fieldStyle} data-ui="SetupForm.defaultLocaleSelect">
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
        <span style={noteStyle}>{t("defaultLocaleNote")}</span>
      </label>
      <label>
        {t("masterPassword", { min: minLength })}
        <input
          data-ui="SetupForm.passwordInput"
          type="password"
          name="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          style={fieldStyle}
        />
      </label>
      <label>
        {t("confirmMasterPassword")}
        <input
          data-ui="SetupForm.confirmPasswordInput"
          type="password"
          name="confirm"
          required
          minLength={minLength}
          autoComplete="new-password"
          style={fieldStyle}
        />
      </label>
      <p aria-live="polite" style={{ color: "#d33", minHeight: "1.5em" }} data-ui="SetupForm.error">
        {state.error}
      </p>
      <button
        data-ui="SetupForm.submitButton"
        type="submit"
        disabled={pending}
        style={{ padding: "10px 16px", fontSize: 16, borderRadius: 6, cursor: "pointer" }}
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}

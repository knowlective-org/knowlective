"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type LoginState, loginWithAccount, loginWithMasterPassword, verifyAccountCode } from "./actions";

const initialState: LoginState = {};

function CodeField({ required, autoFocus }: { required: boolean; autoFocus?: boolean }) {
  const t = useTranslations("admin.login");
  return (
    <label data-ui="CodeField">
      {t("code")}
      <input
        data-ui="CodeField.input"
        type="text"
        name="code"
        required={required}
        autoFocus={autoFocus}
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        autoComplete="one-time-code"
        className={styles.code}
      />
    </label>
  );
}

export function AccountLoginForm() {
  const [state, formAction, pending] = useActionState(loginWithAccount, initialState);
  const t = useTranslations("admin");

  return (
    <form action={formAction} className={styles.form} data-ui="AccountLoginForm">
      <label>
        {t("login.email")}
        <input
          data-ui="AccountLoginForm.emailInput"
          type="email"
          name="email"
          required
          autoComplete="username"
          defaultValue={state.email}
          className={styles.field}
        />
      </label>
      <label>
        {t("login.password")}
        <input
          data-ui="AccountLoginForm.passwordInput"
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={styles.field}
        />
      </label>
      <p aria-live="polite" className={styles.error} data-ui="AccountLoginForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="AccountLoginForm.submitButton">
        {pending ? t("common.checking") : t("login.next")}
      </button>
    </form>
  );
}

// Second step of the account sign-in.
export function VerifyCodeForm() {
  const [state, formAction, pending] = useActionState(verifyAccountCode, initialState);
  const t = useTranslations("admin");

  return (
    <form action={formAction} className={styles.form} data-ui="VerifyCodeForm">
      <CodeField required autoFocus />
      <p aria-live="polite" className={styles.error} data-ui="VerifyCodeForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="VerifyCodeForm.submitButton">
        {pending ? t("common.checking") : t("login.submit")}
      </button>
    </form>
  );
}

export function MasterLoginForm({ needsCode }: { needsCode: boolean }) {
  const [state, formAction, pending] = useActionState(loginWithMasterPassword, initialState);
  const t = useTranslations("admin");

  return (
    <form action={formAction} className={styles.form} data-ui="MasterLoginForm">
      <label>
        {t("login.masterPassword")}
        <input
          data-ui="MasterLoginForm.passwordInput"
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={styles.field}
        />
      </label>
      {needsCode && <CodeField required />}
      <p aria-live="polite" className={styles.error} data-ui="MasterLoginForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="MasterLoginForm.submitButton">
        {pending ? t("common.checking") : t("login.submit")}
      </button>
    </form>
  );
}

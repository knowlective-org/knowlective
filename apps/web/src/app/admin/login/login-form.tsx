"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type LoginState, loginWithAccount, loginWithMasterPassword, verifyAccountCode } from "./actions";

const initialState: LoginState = {};

function CodeField({ required, autoFocus }: { required: boolean; autoFocus?: boolean }) {
  return (
    <label data-ui="CodeField">
      認証コード（6桁）
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

  return (
    <form action={formAction} className={styles.form} data-ui="AccountLoginForm">
      <label>
        メールアドレス
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
        パスワード
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
        {pending ? "確認しています…" : "次へ"}
      </button>
    </form>
  );
}

// Second step of the account sign-in.
export function VerifyCodeForm() {
  const [state, formAction, pending] = useActionState(verifyAccountCode, initialState);

  return (
    <form action={formAction} className={styles.form} data-ui="VerifyCodeForm">
      <CodeField required autoFocus />
      <p aria-live="polite" className={styles.error} data-ui="VerifyCodeForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="VerifyCodeForm.submitButton">
        {pending ? "確認しています…" : "ログイン"}
      </button>
    </form>
  );
}

export function MasterLoginForm({ needsCode }: { needsCode: boolean }) {
  const [state, formAction, pending] = useActionState(loginWithMasterPassword, initialState);

  return (
    <form action={formAction} className={styles.form} data-ui="MasterLoginForm">
      <label>
        マスターパスワード
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
        {pending ? "確認しています…" : "ログイン"}
      </button>
    </form>
  );
}

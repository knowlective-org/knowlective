"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type LoginState, loginWithAccount, loginWithMasterPassword } from "./actions";

const initialState: LoginState = {};

function CodeField({ required, hint }: { required: boolean; hint?: string }) {
  return (
    <label data-ui="CodeField">
      認証コード（6桁）{hint}
      <input
        data-ui="CodeField.input"
        type="text"
        name="code"
        required={required}
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
      {/* Not required: an account that hasn't enrolled yet has no code. */}
      <CodeField required={false} hint="※初回ログイン時は空欄" />
      <p aria-live="polite" className={styles.error} data-ui="AccountLoginForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="AccountLoginForm.submitButton">
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

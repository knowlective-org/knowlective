"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type LoginState, loginWithAccount, loginWithMasterPassword } from "./actions";

const initialState: LoginState = {};

function CodeField({ required, hint }: { required: boolean; hint?: string }) {
  return (
    <label>
      認証コード（6桁）{hint}
      <input
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
    <form action={formAction} className={styles.form}>
      <label>
        メールアドレス
        <input
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
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={styles.field}
        />
      </label>
      {/* Not required: an account that hasn't enrolled yet has no code. */}
      <CodeField required={false} hint="※初回ログイン時は空欄" />
      <p aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button}>
        {pending ? "確認しています…" : "ログイン"}
      </button>
    </form>
  );
}

export function MasterLoginForm({ needsCode }: { needsCode: boolean }) {
  const [state, formAction, pending] = useActionState(loginWithMasterPassword, initialState);

  return (
    <form action={formAction} className={styles.form}>
      <label>
        マスターパスワード
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={styles.field}
        />
      </label>
      {needsCode && <CodeField required />}
      <p aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button}>
        {pending ? "確認しています…" : "ログイン"}
      </button>
    </form>
  );
}

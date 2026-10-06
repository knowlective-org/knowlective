"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className={styles.form} data-ui="LoginForm">
      <input type="hidden" name="next" value={next} />
      <label>
        メールアドレス
        <input
          data-ui="LoginForm.emailInput"
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
          data-ui="LoginForm.passwordInput"
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={styles.field}
        />
      </label>
      <p aria-live="polite" className={styles.error} data-ui="LoginForm.error">
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="LoginForm.submitButton">
        {pending ? "確認しています…" : "ログイン"}
      </button>
    </form>
  );
}

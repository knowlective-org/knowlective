"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { accept, register, type InviteState } from "./actions";

const initialState: InviteState = {};

export function RegisterForm({
  token,
  email,
  minLength,
}: {
  token: string;
  email: string | null;
  minLength: number;
}) {
  const [state, formAction, pending] = useActionState(register, initialState);

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="token" value={token} />
      <label>
        メールアドレス
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          defaultValue={email ?? ""}
          readOnly={email !== null}
          className={styles.field}
        />
      </label>
      <label>
        表示名
        <input type="text" name="name" required autoComplete="name" className={styles.field} />
      </label>
      <label>
        パスワード（{minLength}文字以上）
        <input
          type="password"
          name="password"
          required
          minLength={minLength}
          autoComplete="new-password"
          className={styles.field}
        />
      </label>
      <label>
        パスワード（確認）
        <input
          type="password"
          name="confirm"
          required
          minLength={minLength}
          autoComplete="new-password"
          className={styles.field}
        />
      </label>
      <p aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button}>
        {pending ? "登録しています…" : "登録して参加する"}
      </button>
    </form>
  );
}

export function AcceptForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(accept, initialState);

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="token" value={token} />
      <p aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button type="submit" disabled={pending} className={styles.button}>
        {pending ? "参加しています…" : "参加する"}
      </button>
    </form>
  );
}

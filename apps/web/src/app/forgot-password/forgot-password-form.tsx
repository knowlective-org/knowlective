"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type ForgotPasswordState, requestPasswordReset } from "./actions";

export function ForgotPasswordForm({ ttlMinutes }: { ttlMinutes: number }) {
  const [state, formAction, pending] = useActionState(requestPasswordReset, {} as ForgotPasswordState);

  if (state.sentTo) {
    return (
      <div data-ui="ForgotPasswordForm.sent">
        <p className={styles.lead}>
          {state.sentTo} のアカウントがあれば、再設定用のリンクをメールで送信しました（{ttlMinutes}分間有効）。
        </p>
        <p className={styles.note}>
          メールが届かない場合は、迷惑メールのフォルダも確認してください。それでも届かない場合は、管理者に連絡してください。
        </p>
      </div>
    );
  }

  return (
    <form data-ui="ForgotPasswordForm" action={formAction} className={styles.form}>
      <label>
        メールアドレス
        <input
          data-ui="ForgotPasswordForm.emailInput"
          type="email"
          name="email"
          required
          autoComplete="username"
          maxLength={254}
          className={styles.field}
        />
      </label>
      <p data-ui="ForgotPasswordForm.error" aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button data-ui="ForgotPasswordForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "送信しています…" : "再設定用のリンクを送る"}
      </button>
    </form>
  );
}

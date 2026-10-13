"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type OwnPasswordResetState, requestOwnPasswordReset } from "./actions";

export function OwnPasswordResetForm({ email, ttlMinutes }: { email: string; ttlMinutes: number }) {
  const [state, formAction, pending] = useActionState(requestOwnPasswordReset, {} as OwnPasswordResetState);

  if (state.sentTo) {
    return (
      <div data-ui="OwnPasswordResetForm.status">
        <p className={styles.success}>
          {state.sentTo} に、再設定用のリンクをメールで送信しました（{ttlMinutes}分間有効）。
        </p>
        <p className={styles.note}>
          メールのリンクから新しいパスワードを設定すると、ログイン中の画面はすべてログアウトされます。新しいパスワードでログインし直してください。
        </p>
      </div>
    );
  }

  return (
    <form data-ui="OwnPasswordResetForm" action={formAction} className={styles.form}>
      <p className={styles.note}>
        {email} に、新しいパスワードを設定するためのリンクをメールで送ります。リンクを開くまで、今のパスワードは変わりません。
      </p>
      <p data-ui="OwnPasswordResetForm.error" aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button data-ui="OwnPasswordResetForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "送信しています…" : "再設定用のリンクを送る"}
      </button>
    </form>
  );
}

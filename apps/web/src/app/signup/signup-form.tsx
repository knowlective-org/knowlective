"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type SignupState, requestSignup } from "./actions";

export function SignupForm({ allowedDomains, ttlHours }: { allowedDomains: string[]; ttlHours: number }) {
  const [state, formAction, pending] = useActionState(requestSignup, {} as SignupState);

  if (state.sentTo) {
    return (
      <div data-ui="SignupForm.sent">
        <p className={styles.lead}>
          {state.sentTo} にメールを送信しました。メールのリンクを開いて、表示名とパスワードを設定してください（{ttlHours}時間有効）。
        </p>
        <p className={styles.note}>メールが届かない場合は、迷惑メールのフォルダも確認してください。</p>
      </div>
    );
  }

  return (
    <form data-ui="SignupForm" action={formAction} className={styles.form}>
      <label>
        メールアドレス
        <input
          data-ui="SignupForm.emailInput"
          type="email"
          name="email"
          required
          autoComplete="email"
          maxLength={254}
          className={styles.field}
        />
      </label>
      {allowedDomains.length > 0 && (
        <p className={styles.note}>登録できるのは、次のドメインのメールアドレスだけです: {allowedDomains.join("、")}</p>
      )}
      <p data-ui="SignupForm.error" aria-live="polite" className={styles.error}>
        {state.error}
      </p>
      <button data-ui="SignupForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "送信しています…" : "登録用のリンクを送る"}
      </button>
    </form>
  );
}

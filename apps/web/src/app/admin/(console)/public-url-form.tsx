"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type PublicUrlState, savePublicUrl } from "./actions";

const initialState: PublicUrlState = {};

export function PublicUrlForm({ current, suggested }: { current: string | null; suggested: string }) {
  const [state, formAction, pending] = useActionState(savePublicUrl, initialState);

  return (
    <form data-ui="PublicUrlForm" action={formAction} className={styles.form}>
      <label>
        サイトの公開 URL
        <input
          type="url"
          data-ui="PublicUrlForm.publicUrlInput"
          name="publicUrl"
          required
          defaultValue={current ?? suggested}
          placeholder="https://yosuga.example.com"
          spellCheck={false}
          className={styles.field}
        />
      </label>
      <p className={styles.note}>
        メールや招待リンクに使われます。利用者がブラウザで開く URL（https://〜）を、パスを付けずに入力してください。
      </p>
      <p data-ui="PublicUrlForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? "保存しました。" : "")}
      </p>
      <button data-ui="PublicUrlForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "保存しています…" : "保存"}
      </button>
    </form>
  );
}

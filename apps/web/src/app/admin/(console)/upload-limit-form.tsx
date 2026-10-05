"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { type UploadLimitState, saveUploadLimit } from "./actions";

export function UploadLimitForm({ current, maxLimitMb }: { current: number; maxLimitMb: number }) {
  const [state, formAction, pending] = useActionState(saveUploadLimit, {} as UploadLimitState);
  return (
    <form action={formAction} className={styles.form}>
      <label>
        1ファイルの最大サイズ（MB、1〜{maxLimitMb}）
        <input
          type="number"
          name="maxUploadSizeMb"
          required
          min={1}
          max={maxLimitMb}
          defaultValue={current}
          className={styles.field}
        />
      </label>
      <p aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? "保存しました。" : "")}
      </p>
      <button type="submit" disabled={pending} className={styles.button}>
        {pending ? "保存しています…" : "保存"}
      </button>
    </form>
  );
}

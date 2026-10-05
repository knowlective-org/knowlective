"use client";

import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { saveIpAllowlist, type AllowlistState } from "./actions";

const initialState: AllowlistState = {};

export function IpAllowlistForm({ current, clientIp }: { current: string[]; clientIp: string }) {
  const [state, formAction, pending] = useActionState(saveIpAllowlist, initialState);

  return (
    <form action={formAction} className={styles.form}>
      <label>
        許可する IP アドレス・CIDR（1行に1つ。空欄なら制限なし）
        <textarea
          name="allowlist"
          rows={5}
          defaultValue={current.join("\n")}
          placeholder={`例:\n203.0.113.0/24\n${clientIp}`}
          spellCheck={false}
          className={styles.code}
          style={{ letterSpacing: "normal" }}
        />
      </label>
      <p className={styles.note}>
        現在の接続元: <code>{clientIp}</code>
        。自分の接続元を含まない設定は保存できません。
      </p>
      <p aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? "保存しました。" : "")}
      </p>
      <button type="submit" disabled={pending} className={styles.button}>
        {pending ? "保存しています…" : "保存"}
      </button>
    </form>
  );
}

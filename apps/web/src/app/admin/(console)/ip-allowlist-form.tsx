"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import styles from "@/styles/ui.module.css";
import { saveIpAllowlist, type AllowlistState } from "./actions";

const initialState: AllowlistState = {};

export function IpAllowlistForm({ current, clientIp }: { current: string[]; clientIp: string }) {
  const [state, formAction, pending] = useActionState(saveIpAllowlist, initialState);
  const ta = useTranslations("admin");

  return (
    <form data-ui="IpAllowlistForm" action={formAction} className={styles.form}>
      <label>
        {ta("ipAllowlist.label")}
        <textarea
          data-ui="IpAllowlistForm.allowlistInput"
          name="allowlist"
          rows={5}
          defaultValue={current.join("\n")}
          placeholder={ta("ipAllowlist.placeholder", { ip: clientIp })}
          spellCheck={false}
          className={styles.code}
          style={{ letterSpacing: "normal" }}
        />
      </label>
      <p className={styles.note}>
        {ta.rich("ipAllowlist.current", { ip: clientIp, code: (chunks) => <code>{chunks}</code> })}
      </p>
      <p data-ui="IpAllowlistForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <button data-ui="IpAllowlistForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("common.saving") : ta("common.save")}
      </button>
    </form>
  );
}

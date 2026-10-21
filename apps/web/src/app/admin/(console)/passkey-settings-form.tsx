"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { showConfirm } from "@/components/dialog";
import styles from "@/styles/ui.module.css";
import { type PasskeySettingState, savePasskeySetting } from "./actions";

export function PasskeySettingsForm({ required, withoutPasskey }: { required: boolean; withoutPasskey: number }) {
  const [state, formAction, pending] = useActionState(savePasskeySetting, {} as PasskeySettingState);
  const ta = useTranslations("admin");
  const [checked, setChecked] = useState(required);

  return (
    // Submitted by hand (see LinkPreviewSettingsForm): an action form would
    // reset the checkbox.
    <form
      data-ui="PasskeySettingsForm"
      className={styles.form}
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        if (checked && !required) {
          const ok = await showConfirm(ta("passkeys.requireConfirm", { count: withoutPasskey }), {
            title: ta("passkeys.requireTitle"),
            confirmLabel: ta("passkeys.requireLabel"),
          });
          if (!ok) return;
        }
        startTransition(() => formAction(data));
      }}
    >
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input
          type="checkbox"
          name="required"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          data-ui="PasskeySettingsForm.requiredCheckbox"
        />
        <span>
          {ta("passkeys.require")}
          <span className={styles.note} style={{ display: "block" }}>
            {ta("passkeys.requireNote")}
          </span>
        </span>
      </label>
      <p className={styles.note} data-ui="PasskeySettingsForm.count">
        {ta("passkeys.withoutPasskey", { count: withoutPasskey })}
      </p>
      <p data-ui="PasskeySettingsForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <button data-ui="PasskeySettingsForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("common.saving") : ta("common.save")}
      </button>
    </form>
  );
}

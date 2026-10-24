"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import type { SiteRole } from "shared";
import { StatusRow } from "@/components/status-row";
import styles from "@/styles/ui.module.css";
import { type ApiSettingState, saveApiSettings } from "./actions";

const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

export function ApiSettingsForm({
  enabled,
  roles,
  roleLabels,
  keyCount,
}: {
  enabled: boolean;
  roles: SiteRole[];
  // From the server: lib/roles imports the database client.
  roleLabels: Record<SiteRole, string>;
  keyCount: number;
}) {
  const [state, formAction, pending] = useActionState(saveApiSettings, {} as ApiSettingState);
  const ta = useTranslations("admin");
  const [on, setOn] = useState(enabled);
  const [allowed, setAllowed] = useState<SiteRole[]>(roles);

  return (
    // Submitted by hand (see LinkPreviewSettingsForm): an action form would
    // reset the checkboxes.
    <form
      data-ui="ApiSettingsForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <label style={checkRow}>
        <input
          type="checkbox"
          name="enabled"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          data-ui="ApiSettingsForm.enabledCheckbox"
        />
        <span>
          {ta("api.enable")}
          <span className={styles.note} style={{ display: "block" }}>
            {ta("api.enableNote")}
          </span>
        </span>
      </label>
      <fieldset style={{ border: 0, padding: 0, display: "grid", gap: 6 }}>
        <legend style={{ marginBottom: 6 }}>{ta("api.roles")}</legend>
        {(Object.keys(roleLabels) as SiteRole[]).map((r) => (
          <label key={r} style={checkRow}>
            <input
              type="checkbox"
              name="roles"
              value={r}
              checked={allowed.includes(r)}
              onChange={(e) => setAllowed((a) => (e.target.checked ? [...a, r] : a.filter((x) => x !== r)))}
              data-ui="ApiSettingsForm.roleCheckbox"
              data-id={r}
            />
            <span>{roleLabels[r]}</span>
          </label>
        ))}
        <span className={styles.note}>{ta("api.rolesNote")}</span>
      </fieldset>
      <p className={styles.note} data-ui="ApiSettingsForm.count">
        {ta("api.keyCount", { count: keyCount })}
      </p>
      <StatusRow message={state.error ?? (state.saved ? ta("common.saved") : "")} className={state.error ? styles.error : styles.success} dataUi="ApiSettingsForm.status">
        <button data-ui="ApiSettingsForm.submitButton" type="submit" disabled={pending} className={styles.button}>
          {pending ? ta("common.saving") : ta("common.save")}
        </button>
      </StatusRow>
    </form>
  );
}

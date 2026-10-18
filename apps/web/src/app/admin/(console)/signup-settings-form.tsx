"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import styles from "@/styles/ui.module.css";
import { type SignupSettingsState, saveSignupSettings } from "./actions";

export function SignupSettingsForm({
  mode,
  allowedDomains,
  siteRole,
  roleLabels,
  mailConfigured,
}: {
  mode: "INVITE_ONLY" | "OPEN";
  allowedDomains: string[];
  siteRole: "USER" | "CONTENT_MANAGER";
  // From the server: lib/roles imports the database client, so it can't be
  // imported into this client component.
  roleLabels: Record<"USER" | "CONTENT_MANAGER", string>;
  mailConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveSignupSettings, {} as SignupSettingsState);
  const ta = useTranslations("admin");
  const [selected, setSelected] = useState(mode);
  const [role, setRole] = useState(siteRole);

  return (
    // Submitted by hand, not via `action`: React resets action forms after
    // they run, which put the radios and select back to their initial values.
    <form
      data-ui="SignupSettingsForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <fieldset style={{ border: 0, display: "grid", gap: 8 }}>
        <legend style={{ marginBottom: 8 }}>{ta("signup.mode")}</legend>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="radio"
            name="mode"
            value="INVITE_ONLY"
            checked={selected === "INVITE_ONLY"}
            onChange={() => setSelected("INVITE_ONLY")}
            data-ui="SignupSettingsForm.inviteOnly"
          />
          <span>
            {ta("signup.inviteOnly")}
            <span className={styles.note} style={{ display: "block" }}>
              {ta("signup.inviteOnlyNote")}
            </span>
          </span>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="radio"
            name="mode"
            value="OPEN"
            checked={selected === "OPEN"}
            onChange={() => setSelected("OPEN")}
            disabled={!mailConfigured && mode !== "OPEN"}
            data-ui="SignupSettingsForm.open"
          />
          <span>
            {ta("signup.open")}
            <span className={styles.note} style={{ display: "block" }}>
              {ta("signup.openNote")}
              {!mailConfigured && ta("signup.needsMail")}
            </span>
          </span>
        </label>
      </fieldset>

      {selected === "OPEN" && (
        <label>
          {ta("signup.role")}
          <select
            name="siteRole"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className={styles.field}
            data-ui="SignupSettingsForm.siteRole"
          >
            <option value="USER">
              {roleLabels.USER}
              {ta("common.defaultSuffix")}
            </option>
            <option value="CONTENT_MANAGER">{roleLabels.CONTENT_MANAGER}</option>
          </select>
          <span className={styles.note}>
            {ta("signup.roleNote")}
          </span>
        </label>
      )}

      {selected === "OPEN" && (
        <label>
          {ta("signup.domains")}
          <textarea
            name="domains"
            rows={3}
            defaultValue={allowedDomains.join("\n")}
            placeholder={"example.co.jp\nexample.com"}
            className={styles.field}
            spellCheck={false}
            data-ui="SignupSettingsForm.domains"
          />
          <span className={styles.note}>
            {ta("signup.domainsNote")}
          </span>
        </label>
      )}

      <p data-ui="SignupSettingsForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <button data-ui="SignupSettingsForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("common.saving") : ta("common.save")}
      </button>
    </form>
  );
}

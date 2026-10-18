"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useRef, useState } from "react";
import styles from "@/styles/ui.module.css";
import {
  type OidcFormState,
  saveOidcSettings,
  testOidcSettings,
} from "./actions";

type Values = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  buttonLabel: string;
  nameClaim: string;
  newUserRole: "USER" | "CONTENT_MANAGER";
  allowedDomains: string[];
  trustEmail: boolean;
  passwordLogin: "ALLOWED" | "SITE_ADMINS_ONLY";
};

export function OidcSettingsForm({
  values,
  callbackUrl,
  roleLabels,
}: {
  values: Values;
  // Redirect URI to register at the IdP.
  callbackUrl: string;
  // From the server: lib/roles can't be imported into a client component.
  roleLabels: Record<"USER" | "CONTENT_MANAGER", string>;
}) {
  const [state, formAction, saving] = useActionState(
    saveOidcSettings,
    {} as OidcFormState,
  );
  const [test, testAction, testing] = useActionState(
    testOidcSettings,
    {} as OidcFormState,
  );
  const [enabled, setEnabled] = useState(values.enabled);
  const ta = useTranslations("admin");
  const formRef = useRef<HTMLFormElement>(null);
  // Submitted by hand, not via `action`, so React doesn't reset the fields.
  const submit = (action: (data: FormData) => void) => {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    startTransition(() => action(data));
  };

  return (
    <form
      ref={formRef}
      data-ui="OidcSettingsForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit(formAction);
      }}
    >
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          data-ui="OidcSettingsForm.enabled"
        />
        {ta("oidc.enabled")}
      </label>

      {/* The rest only while enabled (hidden, not removed, so typed values
          survive toggling). Saving while off only turns it off. */}
      <div
        className={styles.form}
        // Not the `hidden` attribute: .form's display: grid would override it.
        style={enabled ? undefined : { display: "none" }}
        data-ui="OidcSettingsForm.details"
      >
        <div>
          <div>{ta("oidc.redirectUri")}</div>
          <code
            className={styles.secret}
            style={{ display: "block", marginTop: 4 }}
            data-ui="OidcSettingsForm.callbackUrl"
          >
            {callbackUrl}
          </code>
        </div>

        <label>
          Issuer URL
          <input
            name="issuer"
            defaultValue={values.issuer}
            placeholder="https://login.microsoftonline.com/<tenant-id>/v2.0"
            className={styles.field}
            spellCheck={false}
            data-ui="OidcSettingsForm.issuer"
          />
          <span className={styles.note}>
            {ta("oidc.issuerNote")}
          </span>
        </label>
        <label>
          {ta("oidc.clientId")}
          <input
            name="clientId"
            defaultValue={values.clientId}
            className={styles.field}
            spellCheck={false}
            data-ui="OidcSettingsForm.clientId"
          />
        </label>
        <label>
          {ta("oidc.clientSecret")}
          <input
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder={
              values.hasSecret ? ta("common.inputHint") : ""
            }
            className={styles.field}
            data-ui="OidcSettingsForm.clientSecret"
          />
          <span className={styles.note}>
            {ta("oidc.secretNote")}
          </span>
        </label>
        <label>
          {ta("oidc.buttonLabel")}
          <input
            name="buttonLabel"
            defaultValue={values.buttonLabel}
            maxLength={40}
            className={styles.field}
            data-ui="OidcSettingsForm.buttonLabel"
          />
          <span className={styles.note}>
            {ta("oidc.buttonLabelNote")}
            {ta("oidc.buttonLabelExample")}
          </span>
        </label>

        <label>
          {ta("oidc.nameClaim")}
          <input
            name="nameClaim"
            defaultValue={values.nameClaim}
            placeholder="name"
            maxLength={100}
            className={styles.field}
            spellCheck={false}
            data-ui="OidcSettingsForm.nameClaim"
          />
          <span className={styles.note}>
            {ta("oidc.nameClaimNote")}
          </span>
        </label>

        <label>
          {ta("oidc.newUserRole")}
          <select
            name="newUserRole"
            defaultValue={values.newUserRole}
            className={styles.field}
            data-ui="OidcSettingsForm.newUserRole"
          >
            <option value="USER">
              {roleLabels.USER}
              {ta("common.defaultSuffix")}
            </option>
            <option value="CONTENT_MANAGER">
              {roleLabels.CONTENT_MANAGER}
            </option>
          </select>
          <span className={styles.note}>
            {ta("oidc.newUserNote")}
          </span>
        </label>
        <label>
          {ta("oidc.domains")}
          <textarea
            name="allowedDomains"
            rows={2}
            defaultValue={values.allowedDomains.join("\n")}
            placeholder="example.co.jp"
            className={styles.field}
            spellCheck={false}
            data-ui="OidcSettingsForm.allowedDomains"
          />
          <span className={styles.note}>
            {ta("oidc.domainsNote")}
          </span>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            name="trustEmail"
            defaultChecked={values.trustEmail}
            data-ui="OidcSettingsForm.trustEmail"
          />
          <span>
            {ta("oidc.trustEmail")}
            <span className={styles.note} style={{ display: "block" }}>
              {ta("oidc.trustEmailNote")}
            </span>
          </span>
        </label>

        <fieldset style={{ border: 0, display: "grid", gap: 6 }}>
          <legend style={{ marginBottom: 6 }}>{ta("oidc.passwordLogin")}</legend>
          <label style={{ display: "flex", gap: 8 }}>
            <input
              type="radio"
              name="passwordLogin"
              value="ALLOWED"
              defaultChecked={values.passwordLogin === "ALLOWED"}
            />
            {ta("oidc.passwordAllowed")}
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input
              type="radio"
              name="passwordLogin"
              value="SITE_ADMINS_ONLY"
              defaultChecked={values.passwordLogin === "SITE_ADMINS_ONLY"}
              data-ui="OidcSettingsForm.ssoOnly"
            />
            <span>
              {ta("oidc.passwordSiteAdminsOnly")}
              <span className={styles.note} style={{ display: "block" }}>
                {ta("oidc.passwordSiteAdminsOnlyNote")}
              </span>
            </span>
          </label>
        </fieldset>
      </div>

      {test.message && enabled && (
        <p
          className={test.error ? styles.error : styles.success}
          data-ui="OidcSettingsForm.testResult"
        >
          {test.message}
        </p>
      )}
      <p
        data-ui="OidcSettingsForm.status"
        aria-live="polite"
        className={state.error ? styles.error : styles.success}
      >
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.buttonSecondary}
          style={enabled ? undefined : { display: "none" }}
          disabled={testing}
          onClick={() => submit(testAction)}
          data-ui="OidcSettingsForm.testButton"
        >
          {testing ? ta("common.checking") : ta("oidc.test")}
        </button>
        <button
          type="submit"
          className={styles.button}
          disabled={saving}
          data-ui="OidcSettingsForm.submitButton"
        >
          {saving ? ta("common.saving") : ta("common.save")}
        </button>
      </div>
    </form>
  );
}

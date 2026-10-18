"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import type { SmtpSecurity } from "shared";
import type { MailSettingsView } from "@/lib/mail";
import styles from "@/styles/ui.module.css";
import {
  type MailSettingsState,
  type TestMailState,
  saveMail,
  sendTestMail,
} from "./actions";

const DEFAULT_PORTS: Record<SmtpSecurity, string> = { NONE: "25", STARTTLS: "587", TLS: "465" };

export function MailSettingsForm({ current }: { current: MailSettingsView | null }) {
  const [state, formAction, pending] = useActionState(saveMail, {} as MailSettingsState);
  const ta = useTranslations("admin");
  const [security, setSecurity] = useState<SmtpSecurity>(current?.security ?? "STARTTLS");
  const [port, setPort] = useState(String(current?.port ?? DEFAULT_PORTS.STARTTLS));
  const [authEnabled, setAuthEnabled] = useState(current?.authEnabled ?? true);

  return (
    <form data-ui="MailSettingsForm" action={formAction} className={styles.form}>
      <label>
        {ta("mail.from")}
        <input
          type="email"
          data-ui="MailSettingsForm.fromAddressInput"
          name="fromAddress"
          required
          defaultValue={current?.fromAddress}
          placeholder="no-reply@example.com"
          className={styles.field}
        />
      </label>
      <label>
        {ta("mail.fromName")}
        <input
          type="text"
          data-ui="MailSettingsForm.fromNameInput"
          name="fromName"
          defaultValue={current?.fromName ?? "KNOWLECTIVE"}
          className={styles.field}
        />
      </label>
      <label>
        {ta("mail.host")}
        <input
          type="text"
          data-ui="MailSettingsForm.hostInput"
          name="host"
          required
          defaultValue={current?.host}
          placeholder="smtp.example.com"
          spellCheck={false}
          className={styles.field}
        />
      </label>
      <label>
        {ta("mail.security")}
        <select
          data-ui="MailSettingsForm.securitySelect"
          name="security"
          value={security}
          onChange={(e) => {
            const next = e.target.value as SmtpSecurity;
            // Follow the conventional port unless the admin typed a custom one.
            if (Object.values(DEFAULT_PORTS).includes(port)) setPort(DEFAULT_PORTS[next]);
            setSecurity(next);
          }}
          className={styles.field}
        >
          <option value="STARTTLS">{ta("mail.starttls")}</option>
          <option value="TLS">{ta("mail.tls")}</option>
          <option value="NONE">{ta("mail.none")}</option>
        </select>
      </label>
      <label>
        {ta("mail.port")}
        <input
          type="number"
          data-ui="MailSettingsForm.portInput"
          name="port"
          required
          min={1}
          max={65535}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          className={styles.field}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          data-ui="MailSettingsForm.authEnabledCheckbox"
          name="authEnabled"
          checked={authEnabled}
          onChange={(e) => setAuthEnabled(e.target.checked)}
        />
        {ta("mail.auth")}
      </label>
      {authEnabled && (
        <>
          {security === "NONE" && (
            <p data-ui="MailSettingsForm.insecureAuthError" className={styles.error}>
              {ta("mail.authNeedsTls")}
            </p>
          )}
          <label>
            {ta("mail.username")}
            <input
              type="text"
              data-ui="MailSettingsForm.usernameInput"
              name="username"
              required
              defaultValue={current?.username ?? ""}
              autoComplete="off"
              spellCheck={false}
              className={styles.field}
            />
          </label>
          <label>
            {ta("mail.password")}
            <input
              type="password"
              data-ui="MailSettingsForm.passwordInput"
              name="password"
              required={!current?.hasPassword}
              autoComplete="new-password"
              placeholder={current?.hasPassword ? ta("common.inputHint") : ""}
              className={styles.field}
            />
          </label>
        </>
      )}
      <p data-ui="MailSettingsForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? ta("common.saved") : "")}
      </p>
      <button data-ui="MailSettingsForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? ta("common.saving") : ta("common.save")}
      </button>
    </form>
  );
}

export function TestMailForm({ disabled }: { disabled: boolean }) {
  const [state, formAction, pending] = useActionState(sendTestMail, {} as TestMailState);
  const ta = useTranslations("admin");

  return (
    <form data-ui="TestMailForm" action={formAction} className={styles.form}>
      <label>
        {ta("mail.testTo")}
        <input data-ui="TestMailForm.toInput" type="email" name="to" required disabled={disabled} className={styles.field} />
      </label>
      <p data-ui="TestMailForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ??
          (state.sentTo ? ta("mail.testSent", { email: state.sentTo }) : "")}
        {disabled && !state.error && ta("mail.testDisabled")}
      </p>
      <button data-ui="TestMailForm.submitButton" type="submit" disabled={pending || disabled} className={styles.buttonSecondary}>
        {pending ? ta("mail.sending") : ta("mail.sendTest")}
      </button>
    </form>
  );
}

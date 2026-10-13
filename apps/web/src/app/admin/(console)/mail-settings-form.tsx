"use client";

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
  const [security, setSecurity] = useState<SmtpSecurity>(current?.security ?? "STARTTLS");
  const [port, setPort] = useState(String(current?.port ?? DEFAULT_PORTS.STARTTLS));
  const [authEnabled, setAuthEnabled] = useState(current?.authEnabled ?? true);

  return (
    <form data-ui="MailSettingsForm" action={formAction} className={styles.form}>
      <label>
        送信元メールアドレス
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
        送信者名（任意）
        <input
          type="text"
          data-ui="MailSettingsForm.fromNameInput"
          name="fromName"
          defaultValue={current?.fromName ?? "YOSUGA"}
          className={styles.field}
        />
      </label>
      <label>
        SMTP サーバー
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
        暗号化
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
          <option value="STARTTLS">STARTTLS（通常はポート 587）</option>
          <option value="TLS">SSL/TLS（通常はポート 465）</option>
          <option value="NONE">なし（社内の中継サーバー向け）</option>
        </select>
      </label>
      <label>
        SMTP サーバーポート
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
        SMTP AUTH を使う
      </label>
      {authEnabled && (
        <>
          {security === "NONE" && (
            <p data-ui="MailSettingsForm.insecureAuthError" className={styles.error}>
              暗号化なしでは SMTP AUTH は使えません（パスワードが平文で送られるため）。
            </p>
          )}
          <label>
            ユーザー名
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
            パスワード
            <input
              type="password"
              data-ui="MailSettingsForm.passwordInput"
              name="password"
              required={!current?.hasPassword}
              autoComplete="new-password"
              placeholder={current?.hasPassword ? "（保存済み。変更する場合のみ入力）" : ""}
              className={styles.field}
            />
          </label>
        </>
      )}
      <p data-ui="MailSettingsForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? "保存しました。" : "")}
      </p>
      <button data-ui="MailSettingsForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? "保存しています…" : "保存"}
      </button>
    </form>
  );
}

export function TestMailForm({ disabled }: { disabled: boolean }) {
  const [state, formAction, pending] = useActionState(sendTestMail, {} as TestMailState);

  return (
    <form data-ui="TestMailForm" action={formAction} className={styles.form}>
      <label>
        テストメールの送信先
        <input data-ui="TestMailForm.toInput" type="email" name="to" required disabled={disabled} className={styles.field} />
      </label>
      <p data-ui="TestMailForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ??
          (state.sentTo ? `${state.sentTo} に送信しました。届いているか確認してください。` : "")}
        {disabled && !state.error && "設定を保存すると、テストメールを送れます。"}
      </p>
      <button data-ui="TestMailForm.submitButton" type="submit" disabled={pending || disabled} className={styles.buttonSecondary}>
        {pending ? "送信しています…" : "テストメールを送信"}
      </button>
    </form>
  );
}

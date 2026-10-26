"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { isPasskeyPromptDismissed, useWebAuthnSupport } from "@/components/passkey-register-form";
import { StatusRow } from "@/components/status-row";
import styles from "@/styles/ui.module.css";
import {
  type NameState,
  beginEmailChangePasskeyCheck,
  requestEmailChange,
  saveName,
  sendEmailChangeCode,
} from "./profile-actions";

// The account's name and email address. The name is changed right away (if
// allowed: not for single sign-on accounts unless the admin console allows
// it); the address after confirming it's them (`method`) and opening a link
// mailed to the new address.
export function ProfileSection({
  name,
  email,
  rules,
  method,
  maxNameLength,
}: {
  name: string | null;
  email: string;
  rules: { name: "allowed" | "sso"; email: "allowed" | "mail" };
  // How this account confirms it's them (lib/auth/reauth.ts).
  method: "passkey" | "code" | null;
  maxNameLength: number;
}) {
  const t = useTranslations("account.profile");
  const tc = useTranslations("common");
  const [nameState, nameAction, namePending] = useActionState(saveName, {} as NameState);
  const [nameValue, setNameValue] = useState(name ?? "");

  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webAuthn = useWebAuthnSupport();

  function emailMissing(): boolean {
    if (newEmail.trim()) return false;
    setError(t("errors.emailRequired"));
    return true;
  }

  async function request(proof: { passkey?: Parameters<typeof requestEmailChange>[0]["passkey"]; code?: string }) {
    const result = await requestEmailChange({ newEmail, ...proof });
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setLinkSentTo(result.sentTo);
    setChanging(false);
    setNewEmail("");
    setCode("");
    setCodeSentTo(null);
  }

  async function withPending(job: () => Promise<void>) {
    setError(null);
    if (emailMissing()) return;
    setPending(true);
    try {
      await job();
    } finally {
      setPending(false);
    }
  }

  const confirmWithPasskey = () =>
    withPending(async () => {
      let response;
      try {
        response = await startAuthentication({ optionsJSON: await beginEmailChangePasskeyCheck() });
      } catch (err) {
        if (!isPasskeyPromptDismissed(err)) {
          console.error("[account] passkey check failed in the browser", err);
          setError(t("errors.notConfirmed"));
        }
        return;
      }
      await request({ passkey: response });
    });

  const sendCode = () =>
    withPending(async () => {
      const result = await sendEmailChangeCode();
      if ("error" in result) setError(result.error);
      else setCodeSentTo(result.sentTo);
    });

  const confirmWithCode = () => withPending(() => request({ code }));

  return (
    <div data-ui="ProfileSection" style={{ display: "grid", gap: 24 }}>
      {/* Name */}
      {rules.name === "allowed" ? (
        <form
          className={styles.form}
          data-ui="ProfileSection.nameForm"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            // The action revalidates the screens that show the name.
            startTransition(() => nameAction(data));
          }}
        >
          <label>
            {t("name")}
            <input
              name="name"
              className={styles.field}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              maxLength={maxNameLength}
              required
              autoComplete="name"
              data-ui="ProfileSection.nameInput"
            />
          </label>
          <StatusRow
            message={nameState.error ?? (nameState.saved ? tc("saved") : "")}
            className={nameState.error ? styles.error : styles.success}
            dataUi="ProfileSection.nameStatus"
          >
            <button type="submit" disabled={namePending} className={styles.button} data-ui="ProfileSection.nameSubmitButton">
              {namePending ? tc("saving") : tc("save")}
            </button>
          </StatusRow>
        </form>
      ) : (
        <div>
          <span className={styles.note}>{t("name")}</span>
          <p style={{ margin: "4px 0" }} data-ui="ProfileSection.name">
            {name ?? "—"}
          </p>
          <p className={styles.note} data-ui="ProfileSection.nameLocked">
            {t("nameSso")}
          </p>
        </div>
      )}

      {/* Email address */}
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <span className={styles.note}>{t("email")}</span>
          <p style={{ margin: "4px 0" }} data-ui="AccountPage.email">
            {email}
          </p>
        </div>
        {linkSentTo && (
          <p className={styles.success} data-ui="ProfileSection.linkStatus">
            {t("linkSent", { email: linkSentTo })}
          </p>
        )}
        {rules.email === "mail" ? (
          <p className={styles.note} data-ui="ProfileSection.emailUnavailable">
            {t("emailMail")}
          </p>
        ) : !changing ? (
          <div>
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={() => {
                setChanging(true);
                setLinkSentTo(null);
                setError(null);
              }}
              data-ui="ProfileSection.changeEmailButton"
            >
              {t("changeEmail")}
            </button>
          </div>
        ) : (
          <form
            className={styles.form}
            data-ui="ProfileSection.emailForm"
            onSubmit={(e) => {
              e.preventDefault();
              if (method === "code" && codeSentTo) void confirmWithCode();
            }}
          >
            <label>
              {t("newEmail")}
              <input
                type="email"
                className={styles.field}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoComplete="email"
                data-ui="ProfileSection.newEmailInput"
              />
              <span className={styles.note}>{t("newEmailNote")}</span>
            </label>

            {method === "passkey" && (
              <>
                <p className={styles.note}>{webAuthn === false ? t("passkeyUnsupported") : t("confirmWithPasskey")}</p>
                <StatusRow message={error} className={styles.error} dataUi="ProfileSection.emailError">
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    onClick={() => setChanging(false)}
                    data-ui="ProfileSection.cancelButton"
                  >
                    {tc("cancel")}
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={pending || webAuthn === false}
                    onClick={() => void confirmWithPasskey()}
                    data-ui="ProfileSection.passkeyButton"
                  >
                    {t("confirmPasskeyButton")}
                  </button>
                </StatusRow>
              </>
            )}

            {method === "code" && !codeSentTo && (
              <>
                <p className={styles.note}>{t("confirmWithCode", { email })}</p>
                <StatusRow message={error} className={styles.error} dataUi="ProfileSection.emailError">
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    onClick={() => setChanging(false)}
                    data-ui="ProfileSection.cancelButton"
                  >
                    {tc("cancel")}
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={pending}
                    onClick={() => void sendCode()}
                    data-ui="ProfileSection.sendCodeButton"
                  >
                    {t("sendCode")}
                  </button>
                </StatusRow>
              </>
            )}

            {method === "code" && codeSentTo && (
              <>
                <p className={styles.success} data-ui="ProfileSection.codeStatus">
                  {t("codeSent", { email: codeSentTo })}
                </p>
                <label>
                  {t("code")}
                  <input
                    className={styles.field}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    data-ui="ProfileSection.codeInput"
                  />
                </label>
                <StatusRow message={error} className={styles.error} dataUi="ProfileSection.emailError">
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    disabled={pending}
                    onClick={() => void sendCode()}
                    data-ui="ProfileSection.resendCodeButton"
                  >
                    {t("resendCode")}
                  </button>
                  <button type="submit" className={styles.button} disabled={pending} data-ui="ProfileSection.codeButton">
                    {t("confirmCodeButton")}
                  </button>
                </StatusRow>
              </>
            )}

            {method === null && (
              <p className={styles.note} data-ui="ProfileSection.cannotConfirm">
                {t("cannotConfirm")}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

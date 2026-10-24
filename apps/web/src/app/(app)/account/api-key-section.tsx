"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showConfirm, showCopyText } from "@/components/dialog";
import { isPasskeyPromptDismissed, useWebAuthnSupport } from "@/components/passkey-register-form";
import { StatusRow } from "@/components/status-row";
import styles from "@/styles/ui.module.css";
import { beginApiKeyPasskeyCheck, issueApiKey, revokeApiKey, sendApiKeyCode } from "./api-key-actions";

export type ApiKeyItem = {
  id: string;
  name: string;
  prefix: string;
  scope: "READ" | "WRITE";
  createdAt: string;
  expiresAt: string | null;
  // Decided on the server (the time of rendering).
  expired: boolean;
  lastUsedAt: string | null;
};

const EXPIRY_CHOICES = ["30", "90", "365", "none"] as const;
const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

// The account's API keys: listed, revoked, and issued after confirming who
// the person is: with their passkey if they have one, or else with a code
// mailed to them (`method`, lib/auth/reauth.ts).
export function ApiKeySection({
  keys,
  method,
  apiUrl,
  canIssue,
}: {
  keys: ApiKeyItem[];
  // How this account confirms it's them; null: it can't (no passkey, no mail).
  method: "passkey" | "code" | null;
  // The API's base URL, shown with the new key.
  apiUrl: string;
  // The API is on and this user's role may hold keys. Otherwise existing keys
  // are listed (they don't work) for revoking.
  canIssue: boolean;
}) {
  const t = useTranslations("account.apiKeys");
  const format = useFormatter();
  const router = useRouter();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"READ" | "WRITE">("READ");
  const [expiry, setExpiry] = useState<(typeof EXPIRY_CHOICES)[number]>("90");
  const [code, setCode] = useState("");
  // Where the code was mailed, once it has been.
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webAuthn = useWebAuthnSupport();
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });


  // The name is checked before confirming, so a passkey prompt or a mailed
  // code isn't wasted on a form that can't be sent.
  function nameMissing(): boolean {
    if (name.trim()) return false;
    setError(t("errors.nameRequired"));
    return true;
  }

  async function issue(proof: { passkey?: Parameters<typeof issueApiKey>[0]["passkey"]; code?: string }) {
    const result = await issueApiKey({ name, scope, expiresInDays: expiry === "none" ? null : Number(expiry), ...proof });
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setName("");
    setCode("");
    setCodeSentTo(null);
    await showCopyText(t("issued", { url: apiUrl }), result.key, { title: t("issuedTitle") });
    router.refresh();
  }

  async function issueWithPasskey() {
    setError(null);
    if (nameMissing()) return;
    setPending(true);
    try {
      let response;
      try {
        response = await startAuthentication({ optionsJSON: await beginApiKeyPasskeyCheck() });
      } catch (err) {
        if (!isPasskeyPromptDismissed(err)) {
          console.error("[api keys] passkey check failed in the browser", err);
          setError(t("errors.notConfirmed"));
        }
        return;
      }
      await issue({ passkey: response });
    } finally {
      setPending(false);
    }
  }

  async function sendCode() {
    setError(null);
    if (nameMissing()) return;
    setPending(true);
    try {
      const result = await sendApiKeyCode();
      if ("error" in result) setError(result.error);
      else setCodeSentTo(result.sentTo);
    } finally {
      setPending(false);
    }
  }

  async function issueWithCode() {
    setError(null);
    if (nameMissing()) return;
    setPending(true);
    try {
      await issue({ code });
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-ui="ApiKeySection" style={{ display: "grid", gap: 16 }}>
      <p className={styles.note}>{t("lead")}</p>
      {!canIssue && (
        <p className={styles.note} data-ui="ApiKeySection.unavailable">
          {t("unavailable")}
        </p>
      )}
      {keys.length === 0 ? (
        <p className={styles.note} data-ui="ApiKeySection.empty">
          {t("none")}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("name")}</th>
                <th>{t("scope")}</th>
                <th>{t("expires")}</th>
                <th>{t("lastUsedAt")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} data-ui="ApiKeySection.row" data-id={k.id}>
                  <td>
                    {k.name}
                    <span className={styles.note} style={{ display: "block" }}>
                      <code>{k.prefix}…</code>
                    </span>
                  </td>
                  <td>{t(`scopes.${k.scope}`)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {k.expiresAt ? (k.expired ? t("expired") : date(k.expiresAt)) : t("noExpiry")}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{k.lastUsedAt ? date(k.lastUsedAt) : "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={pending}
                      data-ui="ApiKeySection.revokeButton"
                      data-id={k.id}
                      onClick={async () => {
                        const ok = await showConfirm(t("revokeConfirm", { name: k.name }), {
                          title: t("revokeTitle"),
                          confirmLabel: t("revoke"),
                          danger: true,
                        });
                        if (!ok) return;
                        const result = await revokeApiKey(k.id);
                        if (result.error) setError(result.error);
                        router.refresh();
                      }}
                    >
                      {t("revoke")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canIssue && (
        <form
          className={styles.form}
          data-ui="ApiKeySection.issueForm"
          onSubmit={(e) => {
            e.preventDefault();
            // Enter in the code field.
            if (method === "code" && codeSentTo) void issueWithCode();
          }}
        >
          <h3 className={styles.sectionTitle} style={{ fontSize: 15 }}>
            {t("issueHeading")}
          </h3>
          <label>
            {t("name")}
            <input
              className={styles.field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder={t("namePlaceholder")}
              data-ui="ApiKeySection.nameInput"
            />
          </label>
          <fieldset style={{ border: 0, padding: 0, display: "grid", gap: 6 }}>
            <legend style={{ marginBottom: 6 }}>{t("scope")}</legend>
            {(["READ", "WRITE"] as const).map((s) => (
              <label key={s} style={checkRow}>
                <input
                  type="radio"
                  name="scope"
                  value={s}
                  checked={scope === s}
                  onChange={() => setScope(s)}
                  data-ui="ApiKeySection.scopeRadio"
                  data-id={s}
                />
                <span>
                  {t(`scopes.${s}`)}
                  <span className={styles.note} style={{ display: "block" }}>
                    {t(`scopeNotes.${s}`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <label>
            {t("expires")}
            <select
              className={styles.field}
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as (typeof EXPIRY_CHOICES)[number])}
              data-ui="ApiKeySection.expirySelect"
            >
              {EXPIRY_CHOICES.map((c) => (
                <option key={c} value={c}>
                  {c === "none" ? t("noExpiry") : t("days", { days: Number(c) })}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "grid", gap: 12 }} data-ui="ApiKeySection.confirm">
            {method === "passkey" && (
              <>
                <p className={styles.note}>
                  {webAuthn === false ? t("passkeyUnsupported") : t("confirmWithPasskey")}
                </p>
                <StatusRow message={error} className={styles.error} dataUi="ApiKeySection.error">
                  <button
                    type="button"
                    className={styles.button}
                    disabled={pending || webAuthn === false}
                    onClick={() => void issueWithPasskey()}
                    data-ui="ApiKeySection.passkeyButton"
                  >
                    {t("issueWithPasskey")}
                  </button>
                </StatusRow>
              </>
            )}

            {method === "code" && !codeSentTo && (
              <>
                <p className={styles.note}>{t("confirmWithCode")}</p>
                <StatusRow message={error} className={styles.error} dataUi="ApiKeySection.error">
                  <button
                    type="button"
                    className={styles.button}
                    disabled={pending}
                    onClick={() => void sendCode()}
                    data-ui="ApiKeySection.sendCodeButton"
                  >
                    {t("sendCode")}
                  </button>
                </StatusRow>
              </>
            )}

            {method === "code" && codeSentTo && (
              <>
                <p className={styles.success} data-ui="ApiKeySection.status">
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
                    data-ui="ApiKeySection.codeInput"
                  />
                </label>
                <StatusRow message={error} className={styles.error} dataUi="ApiKeySection.error">
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    disabled={pending}
                    onClick={() => void sendCode()}
                    data-ui="ApiKeySection.resendCodeButton"
                  >
                    {t("resendCode")}
                  </button>
                  <button type="submit" className={styles.button} disabled={pending} data-ui="ApiKeySection.codeButton">
                    {t("issueWithCode")}
                  </button>
                </StatusRow>
              </>
            )}

            {method === null && (
              <p className={styles.note} data-ui="ApiKeySection.cannotConfirm">
                {t("cannotConfirm")}
              </p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

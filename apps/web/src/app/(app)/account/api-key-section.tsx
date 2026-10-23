"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showConfirm, showCopyText } from "@/components/dialog";
import { isPasskeyPromptDismissed, useWebAuthnSupport } from "@/components/passkey-register-form";
import styles from "@/styles/ui.module.css";
import { type IssueApiKeyInput, beginApiKeyPasskeyCheck, issueApiKey, revokeApiKey } from "./api-key-actions";

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

type Methods = { passkey: boolean; password: boolean; sso: "fresh" | "again" | null };

const EXPIRY_CHOICES = ["30", "90", "365", "none"] as const;
const checkRow = { display: "flex", gap: 8, alignItems: "flex-start" } as const;

// The account's API keys: listed, revoked, and issued after confirming who
// the person is (a passkey, the password, or a recent single sign-on).
export function ApiKeySection({
  keys,
  methods,
  ssoAgainHref,
  apiUrl,
  canIssue,
}: {
  keys: ApiKeyItem[];
  // The API is on and this user's role may hold keys. Otherwise existing keys
  // are listed (they don't work) for revoking.
  canIssue: boolean;
  methods: Methods;
  // Signing in with SSO again, back to this screen.
  ssoAgainHref: string;
  // The API's base URL, shown with the new key.
  apiUrl: string;
}) {
  const t = useTranslations("account.apiKeys");
  const format = useFormatter();
  const router = useRouter();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"READ" | "WRITE">("READ");
  const [expiry, setExpiry] = useState<(typeof EXPIRY_CHOICES)[number]>("90");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webAuthn = useWebAuthnSupport();
  const passkeys = methods.passkey && webAuthn === true;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  async function issue(proof: Pick<IssueApiKeyInput, "password" | "passkey">) {
    setError(null);
    if (!name.trim()) {
      setError(t("errors.nameRequired"));
      return;
    }
    setPending(true);
    try {
      const result = await issueApiKey({
        name,
        scope,
        expiresInDays: expiry === "none" ? null : Number(expiry),
        ...proof,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setName("");
      setPassword("");
      await showCopyText(t("issued", { url: apiUrl }), result.key, { title: t("issuedTitle") });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function issueWithPasskey() {
    setError(null);
    if (!name.trim()) {
      setError(t("errors.nameRequired"));
      return;
    }
    setPending(true);
    let response;
    try {
      response = await startAuthentication({ optionsJSON: await beginApiKeyPasskeyCheck() });
    } catch (err) {
      if (!isPasskeyPromptDismissed(err)) {
        console.error("[api keys] passkey check failed in the browser", err);
        setError(t("errors.notConfirmed"));
      }
      setPending(false);
      return;
    }
    setPending(false);
    await issue({ passkey: response });
  }

  const canConfirm = passkeys || methods.password || methods.sso !== null;

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
              {keys.map((k) => {
                return (
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
                );
              })}
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
          // Enter in the password field: confirm with the password.
          if (methods.password) void issue({ password });
          else if (methods.sso === "fresh") void issue({});
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

        <div style={{ display: "grid", gap: 8 }} data-ui="ApiKeySection.confirm">
          <p className={styles.note}>{canConfirm ? t("confirmLead") : t("cannotConfirm")}</p>
          {passkeys && (
            <button
              type="button"
              className={styles.button}
              disabled={pending}
              onClick={() => void issueWithPasskey()}
              data-ui="ApiKeySection.passkeyButton"
            >
              {t("issueWithPasskey")}
            </button>
          )}
          {methods.password && (
            <>
              <label>
                {t("password")}
                <input
                  type="password"
                  className={styles.field}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  data-ui="ApiKeySection.passwordInput"
                />
              </label>
              <button type="submit" className={styles.button} disabled={pending} data-ui="ApiKeySection.passwordButton">
                {t("issueWithPassword")}
              </button>
            </>
          )}
          {methods.sso === "fresh" && (
            <button type="submit" className={styles.button} disabled={pending} data-ui="ApiKeySection.ssoButton">
              {t("issueAfterSso")}
            </button>
          )}
          {methods.sso === "again" && (
            // A plain link: the sign-in goes to the identity provider and back.
            <a href={ssoAgainHref} className={styles.buttonSecondary} data-ui="ApiKeySection.ssoAgainLink">
              {t("ssoAgain")}
            </a>
          )}
        </div>
        <p aria-live="polite" className={styles.error} data-ui="ApiKeySection.error">
          {error}
        </p>
      </form>
      )}
    </div>
  );
}

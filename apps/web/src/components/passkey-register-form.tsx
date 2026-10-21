"use client";

import { WebAuthnError, browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { beginPasskeyRegistration, finishPasskeyRegistration } from "@/app/(app)/account/passkey-actions";
import styles from "@/styles/ui.module.css";

const MAX_NAME_LENGTH = 60;

// The person closed the browser's passkey prompt, or it timed out: nothing
// went wrong. (SimpleWebAuthn passes NotAllowedError through as the cause.)
export function isPasskeyPromptDismissed(err: unknown): boolean {
  const names = [err, err instanceof Error ? err.cause : null].map((e) => (e instanceof Error ? e.name : ""));
  return names.includes("NotAllowedError") || names.includes("AbortError");
}

// Registers a passkey of this device (or a security key / phone the browser
// offers) under a name the user chooses. The account screen and
// /passkey-setup; `onRegistered` runs once it's stored.
export function PasskeyRegisterForm({ onRegistered }: { onRegistered: () => void }) {
  const t = useTranslations("account.passkeys");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Known only in the browser: null until checked (rendered as supported).
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  if (supported === false) {
    return (
      <p className={styles.error} data-ui="PasskeyRegisterForm.unsupported">
        {t("unsupported")}
      </p>
    );
  }

  return (
    <form
      className={styles.form}
      data-ui="PasskeyRegisterForm"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
          const begun = await beginPasskeyRegistration();
          if ("error" in begun) {
            setError(begun.error);
            return;
          }
          let response;
          try {
            response = await startRegistration({ optionsJSON: begun.options });
          } catch (err) {
            // Closed or timed out: nothing to say. A passkey this device
            // already has for the account: excluded by the options.
            if (err instanceof WebAuthnError && err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
              setError(t("errors.alreadyRegistered"));
            } else if (!isPasskeyPromptDismissed(err)) {
              console.error("[passkeys] registration failed in the browser", err);
              setError(t("errors.browser"));
            }
            return;
          }
          const result = await finishPasskeyRegistration(response, name);
          if (result.error) {
            setError(result.error);
            return;
          }
          setName("");
          onRegistered();
        } finally {
          setPending(false);
        }
      }}
    >
      <label>
        {t("name")}
        <input
          className={styles.field}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          placeholder={t("namePlaceholder")}
          data-ui="PasskeyRegisterForm.nameInput"
        />
      </label>
      <p aria-live="polite" className={styles.error} data-ui="PasskeyRegisterForm.error">
        {error}
      </p>
      <button type="submit" disabled={pending} className={styles.button} data-ui="PasskeyRegisterForm.submitButton">
        {pending ? t("registering") : t("register")}
      </button>
    </form>
  );
}

"use client";

import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { isPasskeyPromptDismissed } from "@/components/passkey-register-form";
import styles from "@/styles/ui.module.css";
import { beginPasskeyLogin, finishPasskeyLogin } from "./actions";

// "Log in with a passkey": no address asked, the browser offers the passkeys
// it has for this site. Hidden where the browser can't use passkeys.
export function PasskeyLoginButton({ next }: { next: string }) {
  const t = useTranslations("login");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);
  if (!supported) return null;

  return (
    <div data-ui="PasskeyLoginButton" style={{ display: "grid", gap: 8, marginBottom: 24 }}>
      <button
        type="button"
        className={styles.button}
        disabled={pending}
        data-ui="PasskeyLoginButton.button"
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const begun = await beginPasskeyLogin();
            if ("error" in begun) {
              setError(begun.error);
              return;
            }
            let response;
            try {
              response = await startAuthentication({ optionsJSON: begun.options });
            } catch (err) {
              if (!isPasskeyPromptDismissed(err)) {
                console.error("[passkeys] sign-in failed in the browser", err);
                setError(t("errors.passkeyFailed"));
              }
              return;
            }
            // Redirects on success (the promise then settles without a value).
            const result = await finishPasskeyLogin(response, next);
            if (result) setError(result.error);
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? t("submitting") : t("passkeyButton")}
      </button>
      <p aria-live="polite" className={styles.error} data-ui="PasskeyLoginButton.error">
        {error}
      </p>
    </div>
  );
}

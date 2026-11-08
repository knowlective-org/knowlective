"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import type { OutboundProxySettingsView } from "@/lib/outbound-proxy";
import styles from "@/styles/ui.module.css";
import { type OutboundProxyState, saveOutboundProxy } from "./actions";

// The proxy for the server's own connections to the outside (lib/outbound-proxy.ts).
export function OutboundProxyForm({ current }: { current: OutboundProxySettingsView }) {
  const [state, formAction, pending] = useActionState(saveOutboundProxy, {} as OutboundProxyState);
  const ta = useTranslations("admin.outboundProxy");
  const tc = useTranslations("admin.common");
  const [url, setUrl] = useState(current.url ?? "");

  return (
    // Submitted by hand, not via `action`: React resets action forms after
    // they run, which would put the fields back to their initial values.
    <form
      data-ui="OutboundProxyForm"
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <label>
        {ta("url")}
        <input
          type="url"
          name="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://proxy.example.co.jp:8080"
          spellCheck={false}
          autoComplete="off"
          className={styles.field}
          data-ui="OutboundProxyForm.urlInput"
        />
        <span className={styles.note}>{ta("urlNote")}</span>
      </label>

      {url.trim() !== "" && (
        <>
          <label>
            {ta("user")}
            <input
              type="text"
              name="username"
              defaultValue={current.username ?? ""}
              autoComplete="off"
              className={styles.field}
              data-ui="OutboundProxyForm.usernameInput"
            />
          </label>
          <label>
            {ta("password")}
            <input
              type="password"
              name="password"
              placeholder={current.hasPassword ? ta("passwordKeep") : ""}
              autoComplete="new-password"
              className={styles.field}
              data-ui="OutboundProxyForm.passwordInput"
            />
            <span className={styles.note}>{ta("passwordNote")}</span>
          </label>
          <label>
            {ta("bypass")}
            <textarea
              name="bypass"
              defaultValue={current.bypass.join("\n")}
              rows={4}
              spellCheck={false}
              placeholder={"mail.example.co.jp\n*.intra.example.co.jp\n10.0.0.0/8"}
              className={styles.field}
              data-ui="OutboundProxyForm.bypassInput"
            />
            <span className={styles.note}>{ta("bypassNote")}</span>
          </label>
        </>
      )}

      <p data-ui="OutboundProxyForm.status" aria-live="polite" className={state.error ? styles.error : styles.success}>
        {state.error ?? (state.saved ? tc("saved") : "")}
      </p>
      <button data-ui="OutboundProxyForm.submitButton" type="submit" disabled={pending} className={styles.button}>
        {pending ? tc("saving") : tc("save")}
      </button>
    </form>
  );
}

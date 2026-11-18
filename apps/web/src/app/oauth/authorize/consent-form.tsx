"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import styles from "@/styles/ui.module.css";
import { answerConsent } from "./actions";

// The consent screen's form (page.tsx). The request's own fields go back
// with the answer, and the Server Action checks them again. Going back to
// the app is done here: its address may be another site or an app's own
// scheme ("cursor://…"), which a Server Action's redirect doesn't handle.
export function ConsentForm({
  params,
  app,
  user,
  target,
  site,
  write,
}: {
  params: Record<string, string>;
  app: string;
  user: string;
  target: string;
  site: string | null;
  write: boolean;
}) {
  const t = useTranslations("oauth");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const answer = (decision: "allow" | "deny", form: HTMLFormElement) => {
    const data = new FormData(form);
    data.set("decision", decision);
    startTransition(async () => {
      const result = await answerConsent(data);
      if ("to" in result) {
        setLeaving(true);
        window.location.assign(result.to);
      } else {
        setError(t(`errors.${result.error}`));
      }
    });
  };

  return (
    <form
      className={styles.form}
      data-ui="ConsentForm"
      onSubmit={(e) => {
        e.preventDefault();
        answer("allow", e.currentTarget);
      }}
    >
      <h1 className={styles.title} data-ui="ConsentForm.heading">
        {t("heading", { app })}
      </h1>
      {Object.entries(params).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p>{t("intro", { app, user })}</p>
      <p className={styles.note} data-ui="ConsentForm.unverified">
        {t("unverified")}
      </p>
      <p data-ui="ConsentForm.target">{t("returnsTo", { target })}</p>
      {site && (
        <p className={styles.note} data-ui="ConsentForm.site">
          {t("clientSite", { site })}
        </p>
      )}
      <fieldset style={{ border: 0, padding: 0, display: "grid", gap: 6 }}>
        <legend style={{ marginBottom: 6 }}>{t("scope")}</legend>
        {write ? (
          <>
            <label style={{ display: "flex", gap: 8 }}>
              <input type="radio" name="allow" value="read" data-ui="ConsentForm.readRadio" />
              <span>{t("scopeRead")}</span>
            </label>
            <label style={{ display: "flex", gap: 8 }}>
              <input type="radio" name="allow" value="write" defaultChecked data-ui="ConsentForm.writeRadio" />
              <span>{t("scopeWrite")}</span>
            </label>
          </>
        ) : (
          <p data-ui="ConsentForm.readOnly">
            {t("scopeRead")} <span className={styles.note}>{t("readOnlyAsked")}</span>
          </p>
        )}
      </fieldset>
      <p className={styles.note}>{t("caution")}</p>
      <p aria-live="polite" className={styles.error} data-ui="ConsentForm.error">
        {error}
      </p>
      {leaving ? (
        <p className={styles.note} data-ui="ConsentForm.status">
          {t("sending")}
        </p>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={pending} className={styles.button} data-ui="ConsentForm.allowButton">
            {t("allowButton")}
          </button>
          <button
            type="button"
            disabled={pending}
            className={styles.buttonSecondary}
            data-ui="ConsentForm.denyButton"
            onClick={(e) => answer("deny", e.currentTarget.form!)}
          >
            {t("denyButton")}
          </button>
        </div>
      )}
      <p className={styles.note}>{t("manage")}</p>
    </form>
  );
}
